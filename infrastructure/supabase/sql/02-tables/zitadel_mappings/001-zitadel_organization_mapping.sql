-- Zitadel Organization ID Mapping Table
-- Maps external Zitadel organization IDs to internal UUID surrogate keys
-- This enables consistent UUID-based JOINs across all domain tables

CREATE TABLE IF NOT EXISTS zitadel_organization_mapping (
  -- Internal surrogate key (used throughout our domain tables)
  internal_org_id UUID PRIMARY KEY,

  -- External Zitadel organization ID (string format from Zitadel API)
  zitadel_org_id TEXT UNIQUE NOT NULL,

  -- Cached organization name for convenience (synced from Zitadel)
  org_name TEXT,

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- Indexes for bi-directional lookups
CREATE INDEX IF NOT EXISTS idx_zitadel_org_mapping_zitadel_id
  ON zitadel_organization_mapping(zitadel_org_id);

CREATE INDEX IF NOT EXISTS idx_zitadel_org_mapping_internal_id
  ON zitadel_organization_mapping(internal_org_id);

-- Comments
COMMENT ON TABLE zitadel_organization_mapping IS
  'Maps external Zitadel organization IDs (TEXT) to internal surrogate UUIDs for consistent domain model';
COMMENT ON COLUMN zitadel_organization_mapping.internal_org_id IS
  'Internal UUID surrogate key used in all domain tables (organizations_projection.id)';
COMMENT ON COLUMN zitadel_organization_mapping.zitadel_org_id IS
  'External Zitadel organization ID (18-digit numeric string from Zitadel API)';
COMMENT ON COLUMN zitadel_organization_mapping.org_name IS
  'Cached organization name from Zitadel for convenience (updated on sync)';
