-- ============================================
-- Fix Role API Performance with SECURITY DEFINER
-- ============================================
-- Problem: api.get_roles and api.get_user_permissions use SECURITY INVOKER,
-- which subjects them to RLS policies. The RLS policies on roles_projection,
-- user_roles_projection, and role_permissions_projection call expensive
-- helper functions (is_org_admin, is_super_admin) FOR EVERY ROW.
--
-- Root cause:
--   - is_org_admin() executes 2 JOINs per call
--   - is_super_admin() executes 2 JOINs per call
--   - Query returning N rows = N function calls = 2N extra JOINs
--   - Combined with 8s statement_timeout = TIMEOUT
--
-- Fix: Convert to SECURITY DEFINER to bypass RLS, while implementing
-- proper authorization logic INSIDE the function (checked once, not per row).
--
-- Performance improvement: From O(N) function calls to O(1) authorization check.
-- ============================================

-- 1. Rewrite api.get_user_permissions with SECURITY DEFINER
-- This function returns the permission IDs for the current user.
-- Since it already filters by v_user_id, it's already properly scoped.
CREATE OR REPLACE FUNCTION api.get_user_permissions()
RETURNS TABLE (permission_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER  -- Bypass RLS for performance
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := public.get_current_user_id();

  -- Return permissions for the current user only
  -- No RLS overhead since SECURITY DEFINER bypasses policies
  RETURN QUERY
  SELECT DISTINCT rp.permission_id
  FROM user_roles_projection ur
  JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
  WHERE ur.user_id = v_user_id;
END;
$$;

COMMENT ON FUNCTION api.get_user_permissions IS 'Get permission IDs the current user possesses. Uses SECURITY DEFINER for performance (bypasses RLS, filters by user_id internally).';

-- 2. Rewrite api.get_roles with SECURITY DEFINER
-- This function returns roles visible to the current user.
-- Authorization logic moved INTO the function to avoid per-row RLS overhead.
CREATE OR REPLACE FUNCTION api.get_roles(
  p_status TEXT DEFAULT 'all',
  p_search_term TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  organization_id UUID,
  org_hierarchy_scope TEXT,
  is_active BOOLEAN,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  permission_count BIGINT,
  user_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER  -- Bypass RLS for performance
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_is_super_admin BOOLEAN;
BEGIN
  -- Get current user context (called ONCE, not per row)
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();
  v_is_super_admin := public.is_super_admin(v_user_id);

  RETURN QUERY
  SELECT
    r.id,
    r.name,
    r.description,
    r.organization_id,
    r.org_hierarchy_scope::TEXT,
    r.is_active,
    r.deleted_at,
    r.created_at,
    r.updated_at,
    COALESCE(pc.cnt, 0)::BIGINT AS permission_count,
    COALESCE(uc.cnt, 0)::BIGINT AS user_count
  FROM roles_projection r
  LEFT JOIN (
    SELECT rp.role_id, COUNT(*) as cnt
    FROM role_permissions_projection rp
    GROUP BY rp.role_id
  ) pc ON pc.role_id = r.id
  LEFT JOIN (
    SELECT ur.role_id, COUNT(*) as cnt
    FROM user_roles_projection ur
    GROUP BY ur.role_id
  ) uc ON uc.role_id = r.id
  WHERE
    r.deleted_at IS NULL
    -- Authorization: replaces RLS policies with in-function check
    AND (
      r.organization_id IS NULL  -- Global roles visible to all authenticated users
      OR r.organization_id = v_org_id  -- User's organization roles
      OR v_is_super_admin  -- Super admin sees all roles
    )
    -- Status filter
    AND (p_status = 'all'
         OR (p_status = 'active' AND r.is_active = true)
         OR (p_status = 'inactive' AND r.is_active = false))
    -- Search filter
    AND (p_search_term IS NULL
         OR r.name ILIKE '%' || p_search_term || '%'
         OR r.description ILIKE '%' || p_search_term || '%')
  ORDER BY
    r.is_active DESC,
    r.name ASC;
END;
$$;

COMMENT ON FUNCTION api.get_roles IS 'List roles visible to current user. Uses SECURITY DEFINER for performance (bypasses RLS, implements authorization internally). Supports status and search filtering.';
