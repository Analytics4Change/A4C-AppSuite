-- Migration: Create api.list_users() RPC function
-- Purpose: Fix CQRS violation - queries should use RPC functions, not direct table queries
-- Related: SupabaseUserQueryService.ts was using PostgREST embedding which violates CQRS pattern

-- ============================================================================
-- api.list_users() - List users with roles for an organization
-- ============================================================================
-- Replaces direct table query: .from('users').select(`..., user_roles_projection!inner(...)`)
-- This function encapsulates the join logic in the database layer (correct CQRS pattern)

CREATE OR REPLACE FUNCTION api.list_users(
  p_org_id UUID,
  p_status TEXT DEFAULT NULL,        -- 'active', 'deactivated', or NULL for all
  p_search_term TEXT DEFAULT NULL,
  p_sort_by TEXT DEFAULT 'name',
  p_sort_desc BOOLEAN DEFAULT FALSE,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 20
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
  last_login_at TIMESTAMPTZ,
  roles JSONB,           -- [{role_id, role_name}, ...]
  total_count BIGINT     -- For pagination
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, api
AS $$
DECLARE
  v_total_count BIGINT;
BEGIN
  -- Calculate total count for pagination
  SELECT COUNT(DISTINCT u.id)
  INTO v_total_count
  FROM public.users u
  WHERE EXISTS (
    SELECT 1 FROM public.user_roles_projection ur
    WHERE ur.user_id = u.id AND ur.organization_id = p_org_id
  )
  AND (p_status IS NULL
       OR (p_status = 'active' AND u.is_active = TRUE)
       OR (p_status = 'deactivated' AND u.is_active = FALSE))
  AND (p_search_term IS NULL
       OR u.email ILIKE '%' || p_search_term || '%'
       OR u.name ILIKE '%' || p_search_term || '%');

  -- Return users with their roles
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
    u.last_login_at,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'role_id', ur.role_id,
        'role_name', r.name
      ))
      FROM public.user_roles_projection ur
      JOIN public.roles_projection r ON r.id = ur.role_id
      WHERE ur.user_id = u.id
        AND ur.organization_id = p_org_id),
      '[]'::jsonb
    ) AS roles,
    v_total_count AS total_count
  FROM public.users u
  WHERE EXISTS (
    SELECT 1 FROM public.user_roles_projection ur
    WHERE ur.user_id = u.id AND ur.organization_id = p_org_id
  )
  AND (p_status IS NULL
       OR (p_status = 'active' AND u.is_active = TRUE)
       OR (p_status = 'deactivated' AND u.is_active = FALSE))
  AND (p_search_term IS NULL
       OR u.email ILIKE '%' || p_search_term || '%'
       OR u.name ILIKE '%' || p_search_term || '%')
  ORDER BY
    CASE WHEN NOT p_sort_desc THEN
      CASE p_sort_by
        WHEN 'name' THEN u.name
        WHEN 'email' THEN u.email
        WHEN 'created_at' THEN u.created_at::TEXT
        ELSE u.name
      END
    END ASC NULLS LAST,
    CASE WHEN p_sort_desc THEN
      CASE p_sort_by
        WHEN 'name' THEN u.name
        WHEN 'email' THEN u.email
        WHEN 'created_at' THEN u.created_at::TEXT
        ELSE u.name
      END
    END DESC NULLS LAST
  LIMIT p_page_size
  OFFSET (p_page - 1) * p_page_size;
END;
$$;

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION api.list_users(UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER) TO authenticated;

COMMENT ON FUNCTION api.list_users IS
'List users with their roles for a given organization.
This RPC function follows the CQRS pattern - frontend should ALWAYS use this
instead of direct table queries with PostgREST embedding.

Parameters:
- p_org_id: Organization UUID (required)
- p_status: Filter by status (''active'', ''deactivated'', or NULL for all)
- p_search_term: Search in email and name
- p_sort_by: Sort column (''name'', ''email'', ''created_at'')
- p_sort_desc: Sort descending (default: false)
- p_page: Page number (default: 1)
- p_page_size: Items per page (default: 20)

Returns:
- User records with roles as JSONB array
- total_count for pagination';

-- ============================================================================
-- Notify PostgREST to reload schema cache
-- ============================================================================
NOTIFY pgrst, 'reload schema';
