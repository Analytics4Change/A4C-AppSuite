-- Addresses Projection Table V2
-- Provider Onboarding Enhancement - Phase 1
-- CQRS projection maintained by address.* event processors
-- Source of truth: address.* events in domain_events table

-- Drop old table (no data to migrate - empty table)
DROP TABLE IF EXISTS addresses_projection CASCADE;

-- Create new addresses_projection with all required fields
CREATE TABLE addresses_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(id) ON DELETE CASCADE,

  -- Address Classification
  label TEXT NOT NULL,             -- User-defined label (e.g., 'Main Office', 'Billing Department')
  type address_type NOT NULL,      -- Structured type: physical, mailing, billing

  -- Address Information
  street1 TEXT NOT NULL,
  street2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,             -- State/Province code (e.g., 'CA', 'NY', 'ON')
  zip_code TEXT NOT NULL,          -- Postal/ZIP code
  country TEXT DEFAULT 'US',       -- ISO country code

  -- Status
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ  -- Soft delete support
);

-- Performance indexes
CREATE INDEX idx_addresses_organization
  ON addresses_projection(organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_addresses_type
  ON addresses_projection(type, organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_addresses_primary
  ON addresses_projection(organization_id, is_primary)
  WHERE is_primary = true AND deleted_at IS NULL;

CREATE INDEX idx_addresses_active
  ON addresses_projection(is_active, organization_id)
  WHERE is_active = true AND deleted_at IS NULL;

-- Index for zip code lookups (useful for geographic queries)
CREATE INDEX idx_addresses_zip
  ON addresses_projection(zip_code)
  WHERE deleted_at IS NULL;

-- Unique constraint: one primary address per organization
CREATE UNIQUE INDEX idx_addresses_one_primary_per_org
  ON addresses_projection(organization_id)
  WHERE is_primary = true AND deleted_at IS NULL;

-- Documentation
COMMENT ON TABLE addresses_projection IS 'CQRS projection of address.* events - addresses associated with organizations';
COMMENT ON COLUMN addresses_projection.organization_id IS 'Owning organization (org-scoped for RLS, future multi-org support via junction tables)';
COMMENT ON COLUMN addresses_projection.label IS 'User-defined address label for identification (e.g., "Main Office", "Billing Department")';
COMMENT ON COLUMN addresses_projection.type IS 'Structured address type: physical (business location), mailing, billing';
COMMENT ON COLUMN addresses_projection.is_primary IS 'Primary address for the organization (only one per org enforced by unique index)';
COMMENT ON COLUMN addresses_projection.is_active IS 'Address active status';
COMMENT ON COLUMN addresses_projection.deleted_at IS 'Soft delete timestamp (cascades from org deletion)';
