-- Supabase Auth JWT Custom Access Token Hook
-- Enriches JWT tokens with custom claims for RBAC and multi-tenant isolation
--
-- This hook is called by Supabase Auth when generating access tokens
-- It adds org_id, org_type, user_role, permissions, and scope_path to the JWT
--
-- Documentation: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook

-- ============================================================================
-- JWT Custom Claims Hook (Primary Entry Point)
-- ============================================================================
-- IMPORTANT: Hook MUST be in public schema for Supabase Auth to call it
-- See: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
BEGIN
  -- Extract user ID from event (Supabase Auth user UUID)
  v_user_id := (event->>'user_id')::uuid;

  -- Get user's current organization and role information
  SELECT
    u.current_organization_id,
    COALESCE(
      (SELECT r.name
       FROM public.user_roles_projection ur
       JOIN public.roles_projection r ON r.id = ur.role_id
       WHERE ur.user_id = u.id
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
       WHERE ur.user_id = u.id
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
  INTO v_org_id, v_user_role, v_scope_path
  FROM public.users u
  WHERE u.id = v_user_id;

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
            AND ur.org_id IS NULL
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
    -- Get permissions via role grants
    SELECT array_agg(DISTINCT p.name)
    INTO v_permissions
    FROM public.user_roles_projection ur
    JOIN public.role_permissions_projection rp ON rp.role_id = ur.role_id
    JOIN public.permissions_projection p ON p.id = rp.permission_id
    WHERE ur.user_id = v_user_id
      AND (ur.org_id = v_org_id OR ur.org_id IS NULL);
  END IF;

  -- Default to empty array if no permissions
  v_permissions := COALESCE(v_permissions, ARRAY[]::text[]);

  -- Build custom claims by merging with existing claims
  -- CRITICAL: Preserve all standard JWT fields (aud, exp, iat, sub, email, phone, role, aal, session_id, is_anonymous)
  -- and add our custom claims (org_id, user_role, permissions, scope_path, claims_version)
  v_claims := COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
    'org_id', v_org_id,
    'org_type', v_org_type,
    'user_role', v_user_role,
    'permissions', to_jsonb(v_permissions),
    'scope_path', v_scope_path,
    'claims_version', 1
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
        'claims_error', SQLERRM
      )
    );
END;
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION public.custom_access_token_hook IS
  'Enriches Supabase Auth JWTs with custom claims: org_id, org_type, user_role, permissions, scope_path. Called automatically on token generation.';


-- ============================================================================
-- Helper Function: Switch Organization Context
-- ============================================================================

CREATE OR REPLACE FUNCTION public.switch_organization(
  p_new_org_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_has_access boolean;
  v_result jsonb;
BEGIN
  -- Get current authenticated user from Supabase Auth
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if user has access to the requested organization
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles_projection ur
    WHERE ur.user_id = v_user_id
      AND (ur.org_id = p_new_org_id OR ur.org_id IS NULL)  -- NULL for super_admin
  ) INTO v_has_access;

  IF NOT v_has_access THEN
    RAISE EXCEPTION 'User does not have access to organization %', p_new_org_id;
  END IF;

  -- Update user's current organization
  UPDATE public.users
  SET current_organization_id = p_new_org_id,
      updated_at = NOW()
  WHERE id = v_user_id;

  -- Return new organization context (client should refresh JWT)
  RETURN jsonb_build_object(
    'success', true,
    'org_id', p_new_org_id,
    'message', 'Organization context updated. Please refresh your session to get updated JWT claims.'
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to switch organization: %', SQLERRM;
END;
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION public.switch_organization IS
  'Updates user current organization context. Client must refresh JWT to get new claims.';


-- ============================================================================
-- Helper Function: Get User JWT Claims Preview
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_claims_preview(
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_result jsonb;
BEGIN
  -- Use provided user_id or current authenticated user
  v_user_id := COALESCE(p_user_id, auth.uid());

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated and no user_id provided';
  END IF;

  -- Simulate what the JWT hook would return
  SELECT auth.custom_access_token_hook(
    jsonb_build_object(
      'user_id', v_user_id::text,
      'claims', '{}'::jsonb
    )
  )->>'claims' INTO v_result;

  RETURN v_result;
END;
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION public.get_user_claims_preview IS
  'Preview what JWT custom claims would be for a user (debugging/testing only)';


-- ============================================================================
-- Grant Permissions (Idempotent - GRANT statements can be run multiple times)
-- ============================================================================

-- Grant permissions for Supabase Auth to call the JWT hook
-- The supabase_auth_admin role is used by Supabase Auth to execute custom hooks
-- Note: These GRANT statements are idempotent and safe to run multiple times
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- Grant read access to tables the JWT hook needs to query
-- The hook must be able to read user roles, permissions, and organization data
GRANT SELECT ON TABLE public.users TO supabase_auth_admin;
GRANT SELECT ON TABLE public.user_roles_projection TO supabase_auth_admin;
GRANT SELECT ON TABLE public.roles_projection TO supabase_auth_admin;
GRANT SELECT ON TABLE public.organizations_projection TO supabase_auth_admin;
GRANT SELECT ON TABLE public.permissions_projection TO supabase_auth_admin;
GRANT SELECT ON TABLE public.role_permissions_projection TO supabase_auth_admin;

-- Revoke execute from public roles for security
-- Only supabase_auth_admin should call the JWT hook function
-- Note: REVOKE is idempotent - safe to run even if privilege doesn't exist
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

-- Grant execute on helper functions to authenticated users
-- These are utility functions for user session management
GRANT EXECUTE ON FUNCTION public.switch_organization TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_claims_preview TO authenticated;
