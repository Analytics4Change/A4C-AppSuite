-- Add subdomain provisioning columns to organizations_projection
-- Part of Phase 2: Database Schema for Subdomain Support
-- Full subdomain computed as: {slug}.{BASE_DOMAIN} (environment-aware)

ALTER TABLE organizations_projection
  ADD COLUMN subdomain_status subdomain_status DEFAULT 'pending',
  ADD COLUMN cloudflare_record_id TEXT,
  ADD COLUMN dns_verified_at TIMESTAMPTZ,
  ADD COLUMN subdomain_metadata JSONB DEFAULT '{}';

-- Index for querying organizations by provisioning status
-- Partial index excludes verified orgs (most common case) for efficiency
CREATE INDEX IF NOT EXISTS idx_organizations_subdomain_status
  ON organizations_projection(subdomain_status)
  WHERE subdomain_status != 'verified';

-- Index for finding failed provisioning attempts that need attention
CREATE INDEX IF NOT EXISTS idx_organizations_subdomain_failed
  ON organizations_projection(subdomain_status, updated_at)
  WHERE subdomain_status = 'failed';

-- Documentation
COMMENT ON COLUMN organizations_projection.subdomain_status
  IS 'Subdomain provisioning status - tracks DNS creation and verification lifecycle';

COMMENT ON COLUMN organizations_projection.cloudflare_record_id
  IS 'Cloudflare DNS record ID for {slug}.{BASE_DOMAIN} subdomain (from Cloudflare API response)';

COMMENT ON COLUMN organizations_projection.dns_verified_at
  IS 'Timestamp when DNS verification completed successfully (subdomain resolvable)';

COMMENT ON COLUMN organizations_projection.subdomain_metadata
  IS 'Additional subdomain provisioning metadata: dns_record details, verification attempts, errors';
