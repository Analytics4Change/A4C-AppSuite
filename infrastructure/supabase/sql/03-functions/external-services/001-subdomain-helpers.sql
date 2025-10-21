-- Subdomain Helper Functions
-- Part of Phase 2: Database Schema for Subdomain Support
-- Environment-aware subdomain computation based on BASE_DOMAIN

-- Get base domain from environment or default
-- NOTE: app.base_domain should be set via connection string or pooler config
-- Example: SET app.base_domain = 'firstovertheline.com';
CREATE OR REPLACE FUNCTION get_base_domain() RETURNS TEXT AS $$
BEGIN
  -- Attempt to read from app.base_domain setting
  -- Falls back to analytics4change.com (production default) if not set
  RETURN COALESCE(
    current_setting('app.base_domain', true),
    'analytics4change.com'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN 'analytics4change.com';
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_base_domain() IS
  'Returns environment-specific base domain. Dev: firstovertheline.com, Prod: analytics4change.com. Reads from app.base_domain setting or defaults to analytics4change.com';


-- Compute full subdomain from slug and base domain
CREATE OR REPLACE FUNCTION get_full_subdomain(p_slug TEXT) RETURNS TEXT AS $$
BEGIN
  IF p_slug IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN p_slug || '.' || get_base_domain();
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_full_subdomain(TEXT) IS
  'Computes full subdomain from slug and environment base domain. Example: get_full_subdomain(''acme'') returns ''acme.firstovertheline.com'' in dev environment';


-- Get full subdomain for an organization by ID
CREATE OR REPLACE FUNCTION get_organization_subdomain(p_org_id UUID) RETURNS TEXT AS $$
DECLARE
  v_slug TEXT;
BEGIN
  SELECT slug INTO v_slug
  FROM organizations_projection
  WHERE id = p_org_id;

  IF v_slug IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN get_full_subdomain(v_slug);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_organization_subdomain(UUID) IS
  'Gets full subdomain for organization by ID. Returns NULL if organization not found. Example: get_organization_subdomain(''...'') might return ''acme.analytics4change.com''';
