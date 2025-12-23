-- Contacts Projection Table V2
-- Provider Onboarding Enhancement - Phase 1
-- CQRS projection maintained by contact.* event processors
-- Source of truth: contact.* events in domain_events table

-- Create contacts_projection with all required fields (idempotent)
-- Note: No ON DELETE CASCADE - event-driven deletion required (emit contact.deleted events via workflow)
CREATE TABLE IF NOT EXISTS contacts_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(id),

  -- Contact Classification
  label TEXT NOT NULL,           -- User-defined label (e.g., 'John - Main Contact', 'Billing Department')
  type contact_type NOT NULL,    -- Structured type: a4c_admin, billing, technical, emergency, stakeholder

  -- Contact Information
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,

  -- Optional fields
  title TEXT,           -- Job title (e.g., 'Chief Financial Officer')
  department TEXT,      -- Department (e.g., 'Finance', 'IT')

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

-- Performance indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_contacts_organization
  ON contacts_projection(organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_email
  ON contacts_projection(email)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_type
  ON contacts_projection(type, organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_primary
  ON contacts_projection(organization_id, is_primary)
  WHERE is_primary = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_active
  ON contacts_projection(is_active, organization_id)
  WHERE is_active = true AND deleted_at IS NULL;

-- Unique constraint: one primary contact per organization (idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_contacts_one_primary_per_org') THEN
    CREATE UNIQUE INDEX idx_contacts_one_primary_per_org
      ON contacts_projection(organization_id)
      WHERE is_primary = true AND deleted_at IS NULL;
  END IF;
END $$;
-- Documentation
COMMENT ON TABLE contacts_projection IS 'CQRS projection of contact.* events - contact persons associated with organizations';
COMMENT ON COLUMN contacts_projection.organization_id IS 'Owning organization (org-scoped for RLS, future multi-org support via junction tables)';
COMMENT ON COLUMN contacts_projection.label IS 'User-defined contact label for identification (e.g., "John Smith - Billing Contact")';
COMMENT ON COLUMN contacts_projection.type IS 'Structured contact type: a4c_admin, billing, technical, emergency, stakeholder';
COMMENT ON COLUMN contacts_projection.is_primary IS 'Primary contact for the organization (only one per org enforced by unique index)';
COMMENT ON COLUMN contacts_projection.is_active IS 'Contact active status';
COMMENT ON COLUMN contacts_projection.deleted_at IS 'Soft delete timestamp (cascades from org deletion)';
