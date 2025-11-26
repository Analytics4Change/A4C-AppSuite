-- Organization Query RPC Functions for Frontend
-- These functions provide read access to organizations_projection via the 'api' schema
-- since PostgREST only exposes 'api' schema, not 'public' schema.
--
-- Matches frontend service: frontend/src/services/organization/SupabaseOrganizationQueryService.ts
-- Frontend calls: .schema('api').rpc('get_organizations', params)

-- 1. Get organizations with optional filters
-- Maps to: SupabaseOrganizationQueryService.getOrganizations()
-- Frontend usage: Referring partner dropdown, organization lists
CREATE OR REPLACE FUNCTION api.get_organizations(
  p_type TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL,
  p_partner_type TEXT DEFAULT NULL,
  p_search_term TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  display_name TEXT,
  type TEXT,
  domain TEXT,
  subdomain TEXT,
  time_zone TEXT,
  is_active BOOLEAN,
  parent_org_id UUID,
  path TEXT,
  partner_type TEXT,
  referring_partner_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.display_name,
    o.type::TEXT,
    o.domain,
    o.subdomain,
    o.time_zone,
    o.is_active,
    o.parent_org_id,
    o.path::TEXT,
    o.partner_type::TEXT,
    o.referring_partner_id,
    o.created_at,
    o.updated_at
  FROM organizations_projection o
  WHERE
    -- Filter by organization type (if provided and not 'all')
    (p_type IS NULL OR p_type = 'all' OR o.type::TEXT = p_type)
    -- Filter by active status (if provided and not 'all')
    AND (p_is_active IS NULL OR o.is_active = p_is_active)
    -- Filter by partner type (if provided)
    AND (p_partner_type IS NULL OR o.partner_type::TEXT = p_partner_type)
    -- Search by name or subdomain (if provided)
    AND (
      p_search_term IS NULL
      OR o.name ILIKE '%' || p_search_term || '%'
      OR o.subdomain ILIKE '%' || p_search_term || '%'
    )
  ORDER BY o.name ASC;
END;
$$;

-- Grant execute to authenticated users (RLS policies on organizations_projection still apply)
GRANT EXECUTE ON FUNCTION api.get_organizations TO authenticated, service_role;

-- 2. Get single organization by ID
-- Maps to: SupabaseOrganizationQueryService.getOrganizationById()
-- Frontend usage: Organization detail pages
CREATE OR REPLACE FUNCTION api.get_organization_by_id(p_org_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  display_name TEXT,
  type TEXT,
  domain TEXT,
  subdomain TEXT,
  time_zone TEXT,
  is_active BOOLEAN,
  parent_org_id UUID,
  path TEXT,
  partner_type TEXT,
  referring_partner_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.display_name,
    o.type::TEXT,
    o.domain,
    o.subdomain,
    o.time_zone,
    o.is_active,
    o.parent_org_id,
    o.path::TEXT,
    o.partner_type::TEXT,
    o.referring_partner_id,
    o.created_at,
    o.updated_at
  FROM organizations_projection o
  WHERE o.id = p_org_id
  LIMIT 1;
END;
$$;

-- Grant execute to authenticated users (RLS policies on organizations_projection still apply)
GRANT EXECUTE ON FUNCTION api.get_organization_by_id TO authenticated, service_role;

-- 3. Get child organizations by parent org ID
-- Maps to: SupabaseOrganizationQueryService.getChildOrganizations()
-- Frontend usage: Organization hierarchy displays
CREATE OR REPLACE FUNCTION api.get_child_organizations(p_parent_org_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  display_name TEXT,
  type TEXT,
  domain TEXT,
  subdomain TEXT,
  time_zone TEXT,
  is_active BOOLEAN,
  parent_org_id UUID,
  path TEXT,
  partner_type TEXT,
  referring_partner_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.display_name,
    o.type::TEXT,
    o.domain,
    o.subdomain,
    o.time_zone,
    o.is_active,
    o.parent_org_id,
    o.path::TEXT,
    o.partner_type::TEXT,
    o.referring_partner_id,
    o.created_at,
    o.updated_at
  FROM organizations_projection o
  WHERE o.parent_org_id = p_parent_org_id
  ORDER BY o.name ASC;
END;
$$;

-- Grant execute to authenticated users (RLS policies on organizations_projection still apply)
GRANT EXECUTE ON FUNCTION api.get_child_organizations TO authenticated, service_role;

-- Comment for documentation
COMMENT ON FUNCTION api.get_organizations IS 'Frontend RPC: Query organizations with optional filters (type, status, partner_type, search)';
COMMENT ON FUNCTION api.get_organization_by_id IS 'Frontend RPC: Get single organization by UUID';
COMMENT ON FUNCTION api.get_child_organizations IS 'Frontend RPC: Get child organizations by parent org UUID';
