-- ============================================
-- Fix Global Roles Visibility
-- ============================================
-- Bug: The previous migration allowed ALL authenticated users to see
-- global roles (organization_id IS NULL), including super_admin.
--
-- Fix: Global roles should only be visible to platform_owner org type.
-- Provider and partner organizations should only see their own org roles.
--
-- Authorization matrix:
--   platform_owner users → global roles + their org roles
--   provider users → ONLY their org roles
--   provider_partner users → ONLY their org roles
--   super_admin → all roles (override)
-- ============================================

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
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_org_type TEXT;
  v_is_super_admin BOOLEAN;
BEGIN
  -- Get current user context (called ONCE, not per row)
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();
  v_org_type := (auth.jwt()->>'org_type')::text;
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
    -- Authorization: Replaces per-row RLS with single check
    AND (
      -- Global roles ONLY visible to platform_owner org type
      (r.organization_id IS NULL AND v_org_type = 'platform_owner')
      -- User's organization roles
      OR r.organization_id = v_org_id
      -- Super admin override: sees all roles
      OR v_is_super_admin
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

COMMENT ON FUNCTION api.get_roles IS 'List roles visible to current user. Global roles only visible to platform_owner. Uses SECURITY DEFINER for performance.';
