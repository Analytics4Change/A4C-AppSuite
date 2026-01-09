-- Migration: JWT hook access date validation
-- Purpose: Update custom_access_token_hook to enforce user-level and role-level access dates
-- If user is outside their access window, return minimal claims with access_blocked flag

CREATE OR REPLACE FUNCTION "public"."custom_access_token_hook"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid;
  v_user_record record;
  v_claims jsonb;
  v_org_id uuid;
  v_org_type text;
  v_user_role text;
  v_permissions text[];
  v_scope_path text;
  v_org_access_record record;
  v_access_blocked boolean := false;
  v_access_block_reason text;
BEGIN
  -- Extract user ID from event (Supabase Auth user UUID)
  v_user_id := (event->>'user_id')::uuid;

  -- Get user's current organization
  SELECT u.current_organization_id
  INTO v_org_id
  FROM public.users u
  WHERE u.id = v_user_id;

  -- =========================================================================
  -- ACCESS DATE VALIDATION (New in this migration)
  -- =========================================================================

  -- Check user-level access dates from user_organizations_projection
  IF v_org_id IS NOT NULL THEN
    SELECT
      uop.access_start_date,
      uop.access_expiration_date
    INTO v_org_access_record
    FROM public.user_organizations_projection uop
    WHERE uop.user_id = v_user_id
      AND uop.org_id = v_org_id;

    -- Check if access hasn't started yet
    IF v_org_access_record.access_start_date IS NOT NULL
       AND v_org_access_record.access_start_date > CURRENT_DATE THEN
      v_access_blocked := true;
      v_access_block_reason := 'access_not_started';
    END IF;

    -- Check if access has expired
    IF v_org_access_record.access_expiration_date IS NOT NULL
       AND v_org_access_record.access_expiration_date < CURRENT_DATE THEN
      v_access_blocked := true;
      v_access_block_reason := 'access_expired';
    END IF;
  END IF;

  -- If access is blocked, return minimal claims with blocked flag
  IF v_access_blocked THEN
    RETURN jsonb_build_object(
      'claims',
      COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
        'org_id', v_org_id,
        'org_type', NULL,
        'user_role', 'blocked',
        'permissions', '[]'::jsonb,
        'scope_path', NULL,
        'access_blocked', true,
        'access_block_reason', v_access_block_reason,
        'claims_version', 2
      )
    );
  END IF;

  -- =========================================================================
  -- EXISTING LOGIC (with role-level date filtering)
  -- =========================================================================

  -- Get user's role and scope, filtering by role-level access dates
  SELECT
    COALESCE(
      (SELECT r.name
       FROM public.user_roles_projection ur
       JOIN public.roles_projection r ON r.id = ur.role_id
       WHERE ur.user_id = v_user_id
         -- Filter by role-level access dates
         AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
         AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE)
       ORDER BY
         CASE
           WHEN r.name = 'super_admin' THEN 1
           WHEN r.name = 'provider_admin' THEN 2
           WHEN r.name = 'partner_admin' THEN 3
           ELSE 4
         END
       LIMIT 1
      ),
      'viewer'
    ) as role,
    COALESCE(
      (SELECT ur.scope_path::text
       FROM public.user_roles_projection ur
       JOIN public.roles_projection r ON r.id = ur.role_id
       WHERE ur.user_id = v_user_id
         -- Filter by role-level access dates
         AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
         AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE)
       ORDER BY
         CASE
           WHEN r.name = 'super_admin' THEN 1
           WHEN r.name = 'provider_admin' THEN 2
           WHEN r.name = 'partner_admin' THEN 3
           ELSE 4
         END
       LIMIT 1
      ),
      NULL
    ) as scope
  INTO v_user_role, v_scope_path;

  -- If no organization context, check for super_admin role
  IF v_org_id IS NULL THEN
    SELECT
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.user_roles_projection ur
          JOIN public.roles_projection r ON r.id = ur.role_id
          WHERE ur.user_id = v_user_id
            AND r.name = 'super_admin'
            AND ur.organization_id IS NULL
            -- Filter by role-level access dates
            AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
            AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE)
        ) THEN NULL  -- Super admin has NULL org_id (global scope)
        ELSE (
          SELECT o.id
          FROM public.organizations_projection o
          WHERE o.type = 'platform_owner'
          LIMIT 1
        )
      END
    INTO v_org_id;
  END IF;

  -- Get organization type for UI feature gating
  -- Super admins (NULL org_id) default to 'platform_owner' for consistency
  IF v_org_id IS NULL THEN
    v_org_type := 'platform_owner';
  ELSE
    SELECT o.type::text INTO v_org_type
    FROM public.organizations_projection o
    WHERE o.id = v_org_id;
  END IF;

  -- Get user's permissions for the organization
  -- Super admins get all permissions
  IF v_user_role = 'super_admin' THEN
    SELECT array_agg(p.name)
    INTO v_permissions
    FROM public.permissions_projection p;
  ELSE
    -- Get permissions via role grants, filtering by role-level access dates
    SELECT array_agg(DISTINCT p.name)
    INTO v_permissions
    FROM public.user_roles_projection ur
    JOIN public.role_permissions_projection rp ON rp.role_id = ur.role_id
    JOIN public.permissions_projection p ON p.id = rp.permission_id
    WHERE ur.user_id = v_user_id
      AND (ur.organization_id = v_org_id OR ur.organization_id IS NULL)
      -- Filter by role-level access dates
      AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
      AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE);
  END IF;

  -- Default to empty array if no permissions
  v_permissions := COALESCE(v_permissions, ARRAY[]::text[]);

  -- Build custom claims by merging with existing claims
  -- CRITICAL: Preserve all standard JWT fields (aud, exp, iat, sub, email, phone, role, aal, session_id, is_anonymous)
  -- and add our custom claims (org_id, org_type, user_role, permissions, scope_path, claims_version)
  v_claims := COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
    'org_id', v_org_id,
    'org_type', v_org_type,
    'user_role', v_user_role,
    'permissions', to_jsonb(v_permissions),
    'scope_path', v_scope_path,
    'access_blocked', false,
    'claims_version', 2  -- Bumped from 1 to 2 for access date support
  );

  -- Return the updated claims object
  -- Supabase Auth expects: { "claims": { ... all standard JWT fields + custom fields ... } }
  RETURN jsonb_build_object('claims', v_claims);

EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail authentication
    RAISE WARNING 'JWT hook error for user %: % %',
      v_user_id,
      SQLERRM,
      SQLSTATE;

    -- Return minimal claims on error, preserving standard JWT fields
    RETURN jsonb_build_object(
      'claims',
      COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
        'org_id', NULL,
        'org_type', NULL,
        'user_role', 'viewer',
        'permissions', '[]'::jsonb,
        'scope_path', NULL,
        'access_blocked', false,
        'claims_error', SQLERRM,
        'claims_version', 2
      )
    );
END;
$$;

COMMENT ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb")
    IS 'JWT custom claims hook with user-level and role-level access date validation (v2)';
