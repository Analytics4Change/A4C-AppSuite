-- =============================================================================
-- Migration: Strip Deprecated JWT Claims (v4)
-- Purpose: Remove user_role, scope_path, permissions from JWT output
-- Part of: Multi-Role Authorization - Remove backward compatibility
-- =============================================================================

-- JWT hook v4: REMOVES deprecated claims (user_role, scope_path, permissions).
-- Only effective_permissions[] is emitted. Frontend must use
-- effective_permissions.some(ep => ep.p === permission) instead of
-- permissions.includes(permission).

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
  v_org_access_record record;
  v_access_blocked boolean := false;
  v_access_block_reason text;
  v_effective_permissions jsonb;
  v_current_org_unit_id uuid;
  v_current_org_unit_path text;
BEGIN
  -- Extract user ID from event (Supabase Auth user UUID)
  v_user_id := (event->>'user_id')::uuid;

  -- Get user's current organization and org unit context
  SELECT u.current_organization_id, u.current_org_unit_id
  INTO v_org_id, v_current_org_unit_id
  FROM public.users u
  WHERE u.id = v_user_id;

  -- =========================================================================
  -- ACCESS DATE VALIDATION
  -- =========================================================================

  IF v_org_id IS NOT NULL THEN
    SELECT
      uop.access_start_date,
      uop.access_expiration_date
    INTO v_org_access_record
    FROM public.user_organizations_projection uop
    WHERE uop.user_id = v_user_id
      AND uop.org_id = v_org_id;

    IF v_org_access_record.access_start_date IS NOT NULL
       AND v_org_access_record.access_start_date > CURRENT_DATE THEN
      v_access_blocked := true;
      v_access_block_reason := 'access_not_started';
    END IF;

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
        'effective_permissions', '[]'::jsonb,
        'access_blocked', true,
        'access_block_reason', v_access_block_reason,
        'claims_version', 4
      )
    );
  END IF;

  -- =========================================================================
  -- ORGANIZATION CONTEXT RESOLUTION
  -- =========================================================================

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
        ) THEN NULL
        ELSE (
          SELECT o.id
          FROM public.organizations_projection o
          WHERE o.type = 'platform_owner'
          LIMIT 1
        )
      END
    INTO v_org_id;
  END IF;

  IF v_org_id IS NULL THEN
    v_org_type := 'platform_owner';
  ELSE
    SELECT o.type::text INTO v_org_type
    FROM public.organizations_projection o
    WHERE o.id = v_org_id;
  END IF;

  -- =========================================================================
  -- ORG UNIT CONTEXT (for user-centric workflows)
  -- =========================================================================

  IF v_current_org_unit_id IS NOT NULL THEN
    SELECT ou.path::text INTO v_current_org_unit_path
    FROM public.organization_units_projection ou
    WHERE ou.id = v_current_org_unit_id;
  END IF;

  -- =========================================================================
  -- EFFECTIVE PERMISSIONS (sole permission mechanism)
  -- =========================================================================

  -- Check if user is super_admin (any role named super_admin)
  IF EXISTS (
    SELECT 1
    FROM public.user_roles_projection ur
    JOIN public.roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = v_user_id
      AND r.name = 'super_admin'
      AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
      AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE)
  ) THEN
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

  v_effective_permissions := COALESCE(v_effective_permissions, '[]'::jsonb);

  -- =========================================================================
  -- BUILD CLAIMS (v4 - no deprecated fields)
  -- =========================================================================

  v_claims := COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
    'org_id', v_org_id,
    'org_type', v_org_type,
    'access_blocked', false,
    'claims_version', 4,
    'effective_permissions', v_effective_permissions,
    'current_org_unit_id', v_current_org_unit_id,
    'current_org_unit_path', v_current_org_unit_path
  );

  RETURN jsonb_build_object('claims', v_claims);

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'JWT hook error for user %: % %',
      v_user_id,
      SQLERRM,
      SQLSTATE;

    RETURN jsonb_build_object(
      'claims',
      COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
        'org_id', NULL,
        'org_type', NULL,
        'effective_permissions', '[]'::jsonb,
        'access_blocked', false,
        'claims_error', SQLERRM,
        'claims_version', 4
      )
    );
END;
$$;

COMMENT ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") IS
'JWT custom claims hook v4 - effective permissions only.

v4 changes (breaking):
- REMOVED: user_role, scope_path, permissions (deprecated since v3)
- ADDED: current_org_unit_id, current_org_unit_path
- Only effective_permissions [{p, s}] is emitted for authorization

Frontend must use effective_permissions.some(ep => ep.p === permission)
instead of permissions.includes(permission).

RLS must use has_effective_permission(permission, target_path) or
has_permission(permission).';
