-- =============================================================================
-- Migration: JWT Hook v3 (Effective Permissions)
-- Purpose: Update custom_access_token_hook to use effective_permissions structure
-- Part of: Multi-Role Authorization Phase 2C
-- =============================================================================

-- This replaces the existing JWT hook with v3 that:
-- 1. Uses compute_effective_permissions() for scoped permission array
-- 2. Outputs effective_permissions as [{p: "permission.name", s: "scope.path"}, ...]
-- 3. Keeps deprecated claims (user_role, scope_path, permissions) for transition
-- 4. Bumps claims_version to 3

CREATE OR REPLACE FUNCTION "public"."custom_access_token_hook"("event" "jsonb")
RETURNS "jsonb"
LANGUAGE "plpgsql" STABLE SECURITY DEFINER
SET "search_path" TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid;
  v_claims jsonb;
  v_org_id uuid;
  v_org_type text;
  v_user_role text;
  v_scope_path text;
  v_org_access_record record;
  v_access_blocked boolean := false;
  v_access_block_reason text;
  v_effective_permissions jsonb;
BEGIN
  -- Extract user ID from event (Supabase Auth user UUID)
  v_user_id := (event->>'user_id')::uuid;

  -- Get user's current organization
  SELECT u.current_organization_id
  INTO v_org_id
  FROM public.users u
  WHERE u.id = v_user_id;

  -- =========================================================================
  -- ACCESS DATE VALIDATION
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
        'effective_permissions', '[]'::jsonb,
        'access_blocked', true,
        'access_block_reason', v_access_block_reason,
        'claims_version', 3
      )
    );
  END IF;

  -- =========================================================================
  -- ORGANIZATION CONTEXT RESOLUTION
  -- =========================================================================

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
  IF v_org_id IS NULL THEN
    v_org_type := 'platform_owner';
  ELSE
    SELECT o.type::text INTO v_org_type
    FROM public.organizations_projection o
    WHERE o.id = v_org_id;
  END IF;

  -- =========================================================================
  -- PRIMARY ROLE (deprecated, for backward compatibility)
  -- =========================================================================

  -- Get user's primary role and scope (highest priority role)
  SELECT
    COALESCE(
      (SELECT r.name
       FROM public.user_roles_projection ur
       JOIN public.roles_projection r ON r.id = ur.role_id
       WHERE ur.user_id = v_user_id
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

  -- =========================================================================
  -- EFFECTIVE PERMISSIONS (new v3 structure)
  -- =========================================================================

  -- Build effective_permissions array using compute_effective_permissions()
  -- Format: [{"p": "permission.name", "s": "scope.path"}, ...]
  IF v_user_role = 'super_admin' THEN
    -- Super admins get all permissions at root scope (empty string = global)
    SELECT jsonb_agg(
      jsonb_build_object('p', p.name, 's', '')
    )
    INTO v_effective_permissions
    FROM public.permissions_projection p;
  ELSE
    -- Regular users get computed effective permissions with scopes
    SELECT jsonb_agg(
      jsonb_build_object('p', permission_name, 's', COALESCE(effective_scope::text, ''))
    )
    INTO v_effective_permissions
    FROM compute_effective_permissions(v_user_id, v_org_id);
  END IF;

  -- Default to empty array if no permissions
  v_effective_permissions := COALESCE(v_effective_permissions, '[]'::jsonb);

  -- =========================================================================
  -- BUILD CLAIMS
  -- =========================================================================

  -- Build custom claims with both new and deprecated fields
  v_claims := COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
    -- Core claims
    'org_id', v_org_id,
    'org_type', v_org_type,
    'access_blocked', false,
    'claims_version', 3,

    -- NEW: Effective permissions with per-permission scopes
    'effective_permissions', v_effective_permissions,

    -- DEPRECATED: Kept for backward compatibility during transition
    -- These will be removed in claims_version 4
    'user_role', v_user_role,
    'scope_path', v_scope_path,
    'permissions', (
      SELECT COALESCE(to_jsonb(array_agg(ep->>'p')), '[]'::jsonb)
      FROM jsonb_array_elements(v_effective_permissions) ep
    )
  );

  -- Return the updated claims object
  RETURN jsonb_build_object('claims', v_claims);

EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail authentication
    RAISE WARNING 'JWT hook error for user %: % %',
      v_user_id,
      SQLERRM,
      SQLSTATE;

    -- Return minimal claims on error
    RETURN jsonb_build_object(
      'claims',
      COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
        'org_id', NULL,
        'org_type', NULL,
        'user_role', 'viewer',
        'permissions', '[]'::jsonb,
        'scope_path', NULL,
        'effective_permissions', '[]'::jsonb,
        'access_blocked', false,
        'claims_error', SQLERRM,
        'claims_version', 3
      )
    );
END;
$$;

-- =============================================================================
-- Documentation
-- =============================================================================

COMMENT ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") IS
'JWT custom claims hook v3 with effective permissions.

NEW in v3:
- effective_permissions: Array of {p: permission_name, s: scope_path} objects
  Each permission is mapped to its widest applicable scope
  Includes implied permissions (e.g., update → view)

DEPRECATED (kept for backward compatibility):
- user_role: Single primary role (highest priority)
- scope_path: Single scope from primary role
- permissions: Flat array of permission names (no scopes)

These deprecated fields will be removed in claims_version 4.

Usage in RLS:
- Use has_effective_permission(permission, target_path) instead of:
  - get_current_permissions() @> ARRAY[permission]
  - get_current_scope_path() @> target_path';
