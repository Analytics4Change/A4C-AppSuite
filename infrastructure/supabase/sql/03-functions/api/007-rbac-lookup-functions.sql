-- ==============================================================================
-- RBAC Lookup RPC Functions
-- Called by Temporal activities via PostgREST
-- ==============================================================================
--
-- These functions provide read access to RBAC projection tables for workflows.
-- Required because PostgREST only exposes the 'api' schema, but projection
-- tables are in 'public' schema.
--
-- Functions:
-- 1. api.get_role_by_name_and_org - Find role ID for idempotency check
-- 2. api.get_role_permission_names - Get granted permission names for a role
-- 3. api.get_permission_ids_by_names - Get permission IDs for granting

-- ==============================================================================
-- Function: api.get_role_by_name_and_org
-- ==============================================================================
-- Returns role ID if exists, NULL otherwise
-- Used by GrantProviderAdminPermissions for idempotency check
CREATE OR REPLACE FUNCTION api.get_role_by_name_and_org(
  p_role_name TEXT,
  p_organization_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_role_id UUID;
BEGIN
  SELECT id INTO v_role_id
  FROM public.roles_projection
  WHERE name = p_role_name
    AND organization_id = p_organization_id;

  RETURN v_role_id;  -- Returns NULL if not found
END;
$$;

GRANT EXECUTE ON FUNCTION api.get_role_by_name_and_org TO service_role;
COMMENT ON FUNCTION api.get_role_by_name_and_org IS
  'Get role ID by name and organization. Returns NULL if not found. Called by Temporal activities.';

-- ==============================================================================
-- Function: api.get_role_permission_names
-- ==============================================================================
-- Returns array of permission names already granted to a role
-- Used by GrantProviderAdminPermissions to skip already-granted permissions
CREATE OR REPLACE FUNCTION api.get_role_permission_names(p_role_id UUID)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_names TEXT[];
BEGIN
  SELECT ARRAY_AGG(p.name) INTO v_names
  FROM public.role_permissions_projection rp
  JOIN public.permissions_projection p ON p.id = rp.permission_id
  WHERE rp.role_id = p_role_id;

  RETURN COALESCE(v_names, ARRAY[]::TEXT[]);
END;
$$;

GRANT EXECUTE ON FUNCTION api.get_role_permission_names TO service_role;
COMMENT ON FUNCTION api.get_role_permission_names IS
  'Get array of permission names granted to a role. Returns empty array if none. Called by Temporal activities.';

-- ==============================================================================
-- Function: api.get_permission_ids_by_names
-- ==============================================================================
-- Returns table of permission IDs and names for the given permission names
-- Used by GrantProviderAdminPermissions to emit role.permission.granted events
CREATE OR REPLACE FUNCTION api.get_permission_ids_by_names(p_names TEXT[])
RETURNS TABLE (
  id UUID,
  name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.name
  FROM public.permissions_projection p
  WHERE p.name = ANY(p_names);
END;
$$;

GRANT EXECUTE ON FUNCTION api.get_permission_ids_by_names TO service_role;
COMMENT ON FUNCTION api.get_permission_ids_by_names IS
  'Get permission IDs by names array. Called by Temporal activities for role.permission.granted events.';

-- ==============================================================================
-- Notes
-- ==============================================================================
-- - SECURITY DEFINER: Allows service role to access public schema tables
-- - All functions return data, no side effects
-- - Used by GrantProviderAdminPermissions activity during organization bootstrap
-- - Required because PostgREST only exposes api schema, not public schema
