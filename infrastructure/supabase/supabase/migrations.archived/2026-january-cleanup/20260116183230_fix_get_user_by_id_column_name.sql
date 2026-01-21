-- Migration: Fix column name in api.get_user_by_id()
-- Purpose: Column name is 'last_login' not 'last_login_at' in users table
-- Related: 20260108212809_fix_list_users_column_name.sql made the same fix for list_users

-- ============================================================================
-- api.get_user_by_id() - Fix column name (last_login_at -> last_login)
-- ============================================================================

-- Must DROP first because we're changing the return type (last_login_at -> last_login)
DROP FUNCTION IF EXISTS api.get_user_by_id(UUID, UUID);

CREATE OR REPLACE FUNCTION api.get_user_by_id(
  p_user_id UUID,
  p_org_id UUID
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  name TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_login TIMESTAMPTZ,  -- Fixed: was 'last_login_at'
  current_organization_id UUID,
  roles JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, api
AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.first_name,
    u.last_name,
    u.name,
    u.is_active,
    u.created_at,
    u.updated_at,
    u.last_login,  -- Fixed: was 'last_login_at'
    u.current_organization_id,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'role_id', ur.role_id,
        'role_name', r.name,
        'role_description', r.description,
        'organization_id', ur.organization_id,
        'scope_path', ur.scope_path,
        'role_valid_from', ur.role_valid_from,
        'role_valid_until', ur.role_valid_until,
        'org_hierarchy_scope', r.org_hierarchy_scope,
        'is_active', r.is_active,
        'permission_count', COALESCE(r.permission_count, 0),
        'user_count', COALESCE(r.user_count, 0)
      ))
      FROM public.user_roles_projection ur
      JOIN public.roles_projection r ON r.id = ur.role_id
      WHERE ur.user_id = u.id
        AND ur.organization_id = p_org_id),
      '[]'::jsonb
    ) AS roles
  FROM public.users u
  WHERE u.id = p_user_id
    AND EXISTS (
      SELECT 1 FROM public.user_roles_projection ur
      WHERE ur.user_id = u.id AND ur.organization_id = p_org_id
    );
END;
$$;

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION api.get_user_by_id(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION api.get_user_by_id IS
'Get a single user with their roles for a given organization.
This RPC function follows the CQRS pattern - frontend should ALWAYS use this
instead of direct table queries with PostgREST embedding.

Parameters:
- p_user_id: User UUID (required)
- p_org_id: Organization UUID (required) - used to filter roles and verify membership

Returns:
- Single user record with roles as JSONB array (includes full role details)
- Empty result set if user not found or not a member of the organization';

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
