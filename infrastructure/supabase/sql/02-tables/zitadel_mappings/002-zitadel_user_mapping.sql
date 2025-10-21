-- Zitadel User ID Mapping Table
-- Maps external Zitadel user IDs to internal UUID surrogate keys
-- This enables consistent UUID-based JOINs across all domain tables

CREATE TABLE IF NOT EXISTS zitadel_user_mapping (
  -- Internal surrogate key (used throughout our domain tables)
  internal_user_id UUID PRIMARY KEY,

  -- External Zitadel user ID (string format from Zitadel API)
  zitadel_user_id TEXT UNIQUE NOT NULL,

  -- Cached user email for convenience (synced from Zitadel)
  user_email TEXT,

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- Indexes for bi-directional lookups
CREATE INDEX IF NOT EXISTS idx_zitadel_user_mapping_zitadel_id
  ON zitadel_user_mapping(zitadel_user_id);

CREATE INDEX IF NOT EXISTS idx_zitadel_user_mapping_internal_id
  ON zitadel_user_mapping(internal_user_id);

CREATE INDEX IF NOT EXISTS idx_zitadel_user_mapping_email
  ON zitadel_user_mapping(user_email)
  WHERE user_email IS NOT NULL;

-- Comments
COMMENT ON TABLE zitadel_user_mapping IS
  'Maps external Zitadel user IDs (TEXT) to internal surrogate UUIDs for consistent domain model';
COMMENT ON COLUMN zitadel_user_mapping.internal_user_id IS
  'Internal UUID surrogate key used in all domain tables (users.id)';
COMMENT ON COLUMN zitadel_user_mapping.zitadel_user_id IS
  'External Zitadel user ID (string format from Zitadel API)';
COMMENT ON COLUMN zitadel_user_mapping.user_email IS
  'Cached user email from Zitadel for convenience (updated on sync)';
