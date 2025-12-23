-- Addresses Projection Table
-- CQRS projection maintained by address.* event processors
-- Source of truth: address.* events in domain_events table

CREATE TABLE IF NOT EXISTS addresses_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(id) ON DELETE CASCADE,

  -- Address Label/Type
  label TEXT NOT NULL,  -- e.g., 'Billing Address', 'Shipping Address', 'Main Office', 'Branch Office'

  -- Address Components
  street1 TEXT NOT NULL,
  street2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,  -- US state abbreviation
  zip_code TEXT NOT NULL,

  -- Status
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_addresses_organization
  ON addresses_projection(organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_addresses_label
  ON addresses_projection(label, organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_addresses_primary
  ON addresses_projection(organization_id, is_primary)
  WHERE is_primary = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_addresses_active
  ON addresses_projection(is_active, organization_id)
  WHERE is_active = true AND deleted_at IS NULL;

-- Unique constraint: one primary address per organization
CREATE UNIQUE INDEX IF NOT EXISTS idx_addresses_one_primary_per_org
  ON addresses_projection(organization_id)
  WHERE is_primary = true AND deleted_at IS NULL;

-- Documentation
COMMENT ON TABLE addresses_projection IS 'CQRS projection of address.* events - physical addresses associated with organizations';
COMMENT ON COLUMN addresses_projection.label IS 'Address type/label: Billing Address, Shipping Address, Main Office, etc.';
COMMENT ON COLUMN addresses_projection.state IS 'US state abbreviation (2-letter code)';
COMMENT ON COLUMN addresses_projection.zip_code IS 'US zip code (5-digit or 9-digit format)';
COMMENT ON COLUMN addresses_projection.is_primary IS 'Primary address for the organization (only one per org)';
