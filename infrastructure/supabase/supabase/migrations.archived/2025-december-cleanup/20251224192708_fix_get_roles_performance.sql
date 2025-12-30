-- ============================================
-- Fix api.get_roles Performance Issue
-- ============================================
-- Problem: The original api.get_roles function used correlated subqueries
-- for permission_count and user_count, causing N+1 query execution pattern.
-- With RLS policy overhead, this caused statement timeouts.
--
-- Fix:
-- 1. Add missing index on role_permissions_projection.role_id
-- 2. Rewrite api.get_roles to use LEFT JOINs with pre-aggregated counts
--
-- Performance improvement: From 1 + 2N queries to just 3 queries total.
-- ============================================

-- 1. Add missing index on role_permissions_projection.role_id
-- This enables efficient lookups when counting permissions per role
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id
ON role_permissions_projection(role_id);

-- 2. Rewrite api.get_roles to use JOINs instead of correlated subqueries
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
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
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
    AND (p_status = 'all'
         OR (p_status = 'active' AND r.is_active = true)
         OR (p_status = 'inactive' AND r.is_active = false))
    AND (p_search_term IS NULL
         OR r.name ILIKE '%' || p_search_term || '%'
         OR r.description ILIKE '%' || p_search_term || '%')
  ORDER BY
    r.is_active DESC,
    r.name ASC;
END;
$$;

COMMENT ON FUNCTION api.get_roles IS 'List roles visible to current user (filtered by RLS). Supports status and search filtering. Optimized with JOIN-based counts.';
