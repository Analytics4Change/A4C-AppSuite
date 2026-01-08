-- Fix: Column name is 'last_login' not 'last_login_at' in users table
-- This caused 400 errors when calling api.list_users()

-- Must DROP first because return type changed (column name in RETURNS TABLE)
DROP FUNCTION IF EXISTS api.list_users(UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION api.list_users(
  p_org_id UUID,
  p_status TEXT DEFAULT NULL,
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
  last_login TIMESTAMPTZ,  -- Fixed: was 'last_login_at'
  roles JSONB,
  total_count BIGINT
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
    u.last_login,  -- Fixed: was 'last_login_at'
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

-- Grant remains unchanged (function signature same, just return column name fixed)
GRANT EXECUTE ON FUNCTION api.list_users(UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER) TO authenticated;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
