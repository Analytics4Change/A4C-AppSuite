-- Contacts Projection Table
-- CQRS projection maintained by contact.* event processors
-- Source of truth: contact.* events in domain_events table

CREATE TABLE IF NOT EXISTS contacts_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(id) ON DELETE CASCADE,

  -- Contact Label/Type
  label TEXT NOT NULL,  -- e.g., 'A4C Admin Contact', 'Billing Contact', 'Technical Contact'

  -- Contact Information
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,

  -- Optional fields
  title TEXT,           -- Job title
  department TEXT,

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
CREATE INDEX IF NOT EXISTS idx_contacts_organization
  ON contacts_projection(organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_email
  ON contacts_projection(email)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_primary
  ON contacts_projection(organization_id, is_primary)
  WHERE is_primary = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_active
  ON contacts_projection(is_active, organization_id)
  WHERE is_active = true AND deleted_at IS NULL;

-- Unique constraint: one primary contact per organization
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_one_primary_per_org
  ON contacts_projection(organization_id)
  WHERE is_primary = true AND deleted_at IS NULL;

-- Documentation
COMMENT ON TABLE contacts_projection IS 'CQRS projection of contact.* events - contact persons associated with organizations';
COMMENT ON COLUMN contacts_projection.label IS 'Contact type/label: A4C Admin Contact, Billing Contact, Technical Contact, etc.';
COMMENT ON COLUMN contacts_projection.is_primary IS 'Primary contact for the organization (only one per org)';
COMMENT ON COLUMN contacts_projection.is_active IS 'Contact active status';
