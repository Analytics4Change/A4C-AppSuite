-- Phones Projection Table
-- CQRS projection maintained by phone.* event processors
-- Source of truth: phone.* events in audit_log/domain_events table

CREATE TABLE IF NOT EXISTS phones_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(id) ON DELETE CASCADE,

  -- Phone Label/Type
  label TEXT NOT NULL,  -- e.g., 'Billing Phone', 'Main Office', 'Emergency Contact', 'Fax'

  -- Phone Information
  number TEXT NOT NULL,  -- Formatted phone number (e.g., '(555) 123-4567')
  extension TEXT,        -- Optional phone extension
  type TEXT,  -- mobile, office, fax, emergency, other

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
CREATE INDEX IF NOT EXISTS idx_phones_organization
  ON phones_projection(organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_phones_label
  ON phones_projection(label, organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_phones_primary
  ON phones_projection(organization_id, is_primary)
  WHERE is_primary = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_phones_active
  ON phones_projection(is_active, organization_id)
  WHERE is_active = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_phones_type
  ON phones_projection(type, organization_id)
  WHERE deleted_at IS NULL;

-- Unique constraint: one primary phone per organization
CREATE UNIQUE INDEX IF NOT EXISTS idx_phones_one_primary_per_org
  ON phones_projection(organization_id)
  WHERE is_primary = true AND deleted_at IS NULL;

-- Documentation
COMMENT ON TABLE phones_projection IS 'CQRS projection of phone.* events - phone numbers associated with organizations';
COMMENT ON COLUMN phones_projection.label IS 'Phone type/label: Billing Phone, Main Office, Emergency Contact, Fax, etc.';
COMMENT ON COLUMN phones_projection.number IS 'US phone number in formatted display format';
COMMENT ON COLUMN phones_projection.extension IS 'Phone extension for office numbers (optional)';
COMMENT ON COLUMN phones_projection.type IS 'Phone type: mobile, office, fax, emergency, other';
COMMENT ON COLUMN phones_projection.is_primary IS 'Primary phone for the organization (only one per org)';
