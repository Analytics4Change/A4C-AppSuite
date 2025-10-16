-- Organization Business Profiles Projection Table
-- CQRS projection maintained by organization business profile event processors
-- Source of truth: organization.business_profile.* events in domain_events table
-- Contains rich business data for top-level organizations only
CREATE TABLE IF NOT EXISTS organization_business_profiles_projection (
  organization_id UUID PRIMARY KEY REFERENCES organizations_projection(id) ON DELETE CASCADE,
  organization_type TEXT NOT NULL CHECK (organization_type IN ('provider', 'provider_partner')),
  
  -- Common address fields
  mailing_address JSONB,
  physical_address JSONB,
  
  -- Type-specific business profiles stored as JSONB for flexibility
  provider_profile JSONB,      -- Only populated when organization_type = 'provider'
  partner_profile JSONB,       -- Only populated when organization_type = 'provider_partner'
  
  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints to ensure data integrity
  CHECK (
    (organization_type = 'provider' AND provider_profile IS NOT NULL AND partner_profile IS NULL)
    OR
    (organization_type = 'provider_partner' AND partner_profile IS NOT NULL AND provider_profile IS NULL)
  ),
  
  -- Only allow business profiles for root-level organizations (depth = 2)
  CHECK (
    (SELECT nlevel(path) FROM organizations_projection WHERE id = organization_id) = 2
  )
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_org_business_profiles_type ON organization_business_profiles_projection(organization_type);

-- GIN indexes for JSONB profile searches
CREATE INDEX IF NOT EXISTS idx_org_business_profiles_provider_profile 
  ON organization_business_profiles_projection USING GIN (provider_profile)
  WHERE provider_profile IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_business_profiles_partner_profile 
  ON organization_business_profiles_projection USING GIN (partner_profile)
  WHERE partner_profile IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_business_profiles_mailing_address 
  ON organization_business_profiles_projection USING GIN (mailing_address)
  WHERE mailing_address IS NOT NULL;

-- Comments for documentation
COMMENT ON TABLE organization_business_profiles_projection IS 
  'CQRS projection of organization.business_profile.* events - rich business data for top-level organizations only';
COMMENT ON COLUMN organization_business_profiles_projection.organization_type IS 
  'Type of business profile: provider (healthcare orgs) or provider_partner (VARs, families, courts)';
COMMENT ON COLUMN organization_business_profiles_projection.provider_profile IS 
  'Provider-specific business data: billing info, admin contacts, program details, service types';
COMMENT ON COLUMN organization_business_profiles_projection.partner_profile IS 
  'Provider partner-specific business data: contact info, admin details, partner type';
COMMENT ON COLUMN organization_business_profiles_projection.mailing_address IS 
  'Mailing address JSONB: {street, city, state, zip_code, country}';
COMMENT ON COLUMN organization_business_profiles_projection.physical_address IS 
  'Physical location address JSONB: {street, city, state, zip_code, country}';