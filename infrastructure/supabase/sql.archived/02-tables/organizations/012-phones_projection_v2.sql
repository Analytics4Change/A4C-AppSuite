-- Phones Projection Table V2
-- Provider Onboarding Enhancement - Phase 1
-- CQRS projection maintained by phone.* event processors
-- Source of truth: phone.* events in domain_events table

-- Drop old table (no data to migrate - empty table)


-- Create new phones_projection with all required fields
-- Note: No ON DELETE CASCADE - event-driven deletion required (emit phone.deleted events via workflow)
CREATE TABLE IF NOT EXISTS phones_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(id),

  -- Phone Classification
  label TEXT NOT NULL,            -- User-defined label (e.g., 'Main Office', 'Emergency Line')
  type phone_type NOT NULL,       -- Structured type: mobile, office, fax, emergency

  -- Phone Information
  number TEXT NOT NULL,           -- Phone number (formatted or raw, e.g., '+1-555-123-4567' or '5551234567')
  extension TEXT,                 -- Phone extension (optional)
  country_code TEXT DEFAULT '+1', -- Country calling code (e.g., '+1' for US/Canada)

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
CREATE INDEX IF NOT EXISTS idx_phones_organization
  ON phones_projection(organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_phones_type
  ON phones_projection(type, organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_phones_number
  ON phones_projection(number)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_phones_primary
  ON phones_projection(organization_id, is_primary)
  WHERE is_primary = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_phones_active
  ON phones_projection(is_active, organization_id)
  WHERE is_active = true AND deleted_at IS NULL;

-- Unique constraint: one primary phone per organization
CREATE UNIQUE INDEX IF NOT EXISTS idx_phones_one_primary_per_org
  ON phones_projection(organization_id)
  WHERE is_primary = true AND deleted_at IS NULL;

-- Documentation
COMMENT ON TABLE phones_projection IS 'CQRS projection of phone.* events - phone numbers associated with organizations';
COMMENT ON COLUMN phones_projection.organization_id IS 'Owning organization (org-scoped for RLS, future multi-org support via junction tables)';
COMMENT ON COLUMN phones_projection.label IS 'User-defined phone label for identification (e.g., "Main Office", "Emergency Hotline")';
COMMENT ON COLUMN phones_projection.type IS 'Structured phone type: mobile, office, fax, emergency';
COMMENT ON COLUMN phones_projection.number IS 'Phone number (raw or formatted, e.g., "+1-555-123-4567")';
COMMENT ON COLUMN phones_projection.extension IS 'Phone extension (optional, e.g., "x1234")';
COMMENT ON COLUMN phones_projection.is_primary IS 'Primary phone for the organization (only one per org enforced by unique index)';
COMMENT ON COLUMN phones_projection.is_active IS 'Phone active status';
COMMENT ON COLUMN phones_projection.deleted_at IS 'Soft delete timestamp (cascades from org deletion)';
