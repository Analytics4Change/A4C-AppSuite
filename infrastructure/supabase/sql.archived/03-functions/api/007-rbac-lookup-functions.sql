-- ==============================================================================
-- RBAC Lookup RPC Functions
-- Called by Temporal activities via PostgREST
-- ==============================================================================
--
-- These functions provide read access to RBAC projection tables for workflows.
-- Required because PostgREST only exposes the 'api' schema, but projection
-- tables are in 'public' schema.
--
-- Security Model (per architect review 2024-12-20):
-- - Functions use SECURITY INVOKER (runs with caller's permissions)
-- - service_role has SELECT policies on projection tables
-- - This approach maintains RLS enforcement while allowing worker access
--
-- Functions:
-- 1. api.get_role_by_name_and_org - Find role ID for idempotency check
-- 2. api.get_role_permission_names - Get granted permission names for a role
-- 3. api.get_permission_ids_by_names - Get permission IDs for granting
-- 4. api.get_role_permission_templates - Get canonical permissions for a role type
--
-- Prerequisites:
-- - service_role SELECT policies on: roles_projection, role_permissions_projection,
--   permissions_projection, role_permission_templates
-- - See: 05-policies/011-service-role-projection-access.sql

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
SECURITY INVOKER  -- Changed from DEFINER per architect review (2024-12-20)
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
SECURITY INVOKER  -- Changed from DEFINER per architect review (2024-12-20)
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
SECURITY INVOKER  -- Changed from DEFINER per architect review (2024-12-20)
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
-- Function: api.get_role_permission_templates
-- ==============================================================================
-- Returns canonical permission names for a role type (e.g., 'provider_admin')
-- Used by GrantProviderAdminPermissions to determine which permissions to grant
CREATE OR REPLACE FUNCTION api.get_role_permission_templates(p_role_name TEXT)
RETURNS TABLE (
  permission_name TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER  -- Per architect review (2024-12-20)
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT rpt.permission_name
  FROM public.role_permission_templates rpt
  WHERE rpt.role_name = p_role_name
    AND rpt.is_active = TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION api.get_role_permission_templates TO service_role;
COMMENT ON FUNCTION api.get_role_permission_templates IS
  'Get canonical permission names for a role type. Used during org bootstrap to grant permissions.';

-- ==============================================================================
-- Notes
-- ==============================================================================
-- - SECURITY INVOKER: Functions run with caller's permissions (service_role)
-- - service_role has SELECT policies on projection tables (see 05-policies/)
-- - This approach maintains RLS enforcement while allowing worker access
-- - All functions return data, no side effects
-- - Used by GrantProviderAdminPermissions activity during organization bootstrap
-- - Required because PostgREST only exposes api schema, not public schema
