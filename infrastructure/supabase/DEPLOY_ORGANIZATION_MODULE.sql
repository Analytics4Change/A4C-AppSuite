-- ============================================================================
-- ORGANIZATION MODULE DEPLOYMENT SCRIPT
-- ============================================================================
-- This script deploys all database components for the Organization Module
-- Run this in Supabase Studio SQL Editor
-- Date: 2025-10-30
-- Note: Validation constraints removed - business logic enforced at ViewModel layer
-- ============================================================================

-- ============================================================================
-- SECTION 1: PROJECTION TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Programs Projection Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS programs_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(id) ON DELETE CASCADE,

  -- Program Information
  name TEXT NOT NULL,
  type TEXT NOT NULL,  -- residential, outpatient, day_treatment, iop, php, sober_living, mat

  -- Program Details
  description TEXT,
  capacity INTEGER,
  current_occupancy INTEGER DEFAULT 0,

  -- Status
  is_active BOOLEAN DEFAULT true,
  activated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  deactivation_reason TEXT,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Performance indexes for programs_projection
CREATE INDEX IF NOT EXISTS idx_programs_organization
  ON programs_projection(organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_programs_type
  ON programs_projection(type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_programs_active
  ON programs_projection(is_active, organization_id)
  WHERE is_active = true AND deleted_at IS NULL;

-- Documentation
COMMENT ON TABLE programs_projection IS 'CQRS projection of program.* events - treatment programs offered by organizations';
COMMENT ON COLUMN programs_projection.type IS 'Program type: residential, outpatient, day_treatment, iop, php, sober_living, mat';
COMMENT ON COLUMN programs_projection.capacity IS 'Maximum number of clients this program can serve (NULL = unlimited)';
COMMENT ON COLUMN programs_projection.current_occupancy IS 'Current number of active clients in program';
COMMENT ON COLUMN programs_projection.is_active IS 'Program active status (affects client enrollment)';

-- ----------------------------------------------------------------------------
-- Contacts Projection Table
-- ----------------------------------------------------------------------------
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

-- Performance indexes for contacts_projection
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

-- ----------------------------------------------------------------------------
-- Addresses Projection Table
-- ----------------------------------------------------------------------------
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

-- Performance indexes for addresses_projection
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

-- ----------------------------------------------------------------------------
-- Phones Projection Table
-- ----------------------------------------------------------------------------
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

-- Performance indexes for phones_projection
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

-- ============================================================================
-- SECTION 2: EVENT PROCESSORS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Program Event Processor
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_program_event(
  p_event RECORD
) RETURNS VOID AS $$
BEGIN
  CASE p_event.event_type

    -- Handle program creation
    WHEN 'program.created' THEN
      INSERT INTO programs_projection (
        id, organization_id, name, type, description, capacity, current_occupancy,
        is_active, activated_at, metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_organization_id(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_text(p_event.event_data, 'name'),
        safe_jsonb_extract_text(p_event.event_data, 'type'),
        safe_jsonb_extract_text(p_event.event_data, 'description'),
        (p_event.event_data->>'capacity')::INTEGER,
        COALESCE((p_event.event_data->>'current_occupancy')::INTEGER, 0),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), true),
        CASE
          WHEN safe_jsonb_extract_boolean(p_event.event_data, 'is_active') THEN p_event.created_at
          ELSE NULL
        END,
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      );

    -- Handle program updates
    WHEN 'program.updated' THEN
      UPDATE programs_projection
      SET
        name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'name'), name),
        type = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'type'), type),
        description = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'description'), description),
        capacity = COALESCE((p_event.event_data->>'capacity')::INTEGER, capacity),
        current_occupancy = COALESCE((p_event.event_data->>'current_occupancy')::INTEGER, current_occupancy),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id AND deleted_at IS NULL;

    -- Handle program activation
    WHEN 'program.activated' THEN
      UPDATE programs_projection
      SET
        is_active = true,
        activated_at = p_event.created_at,
        deactivated_at = NULL,
        deactivation_reason = NULL,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id AND deleted_at IS NULL;

    -- Handle program deactivation
    WHEN 'program.deactivated' THEN
      UPDATE programs_projection
      SET
        is_active = false,
        deactivated_at = p_event.created_at,
        deactivation_reason = safe_jsonb_extract_text(p_event.event_data, 'reason'),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id AND deleted_at IS NULL;

    -- Handle program deletion (logical)
    WHEN 'program.deleted' THEN
      UPDATE programs_projection
      SET
        deleted_at = p_event.created_at,
        is_active = false,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown program event type: %', p_event.event_type;
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Contact Event Processor
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_contact_event(
  p_event RECORD
) RETURNS VOID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  CASE p_event.event_type

    -- Handle contact creation
    WHEN 'contact.created' THEN
      v_org_id := safe_jsonb_extract_organization_id(p_event.event_data, 'organization_id');

      -- If this contact is marked as primary, clear any existing primary flag
      IF safe_jsonb_extract_boolean(p_event.event_data, 'is_primary') THEN
        UPDATE contacts_projection
        SET is_primary = false, updated_at = p_event.created_at
        WHERE organization_id = v_org_id AND is_primary = true AND deleted_at IS NULL;
      END IF;

      INSERT INTO contacts_projection (
        id, organization_id, label, first_name, last_name, email, title, department,
        is_primary, is_active, metadata, created_at
      ) VALUES (
        p_event.stream_id,
        v_org_id,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'first_name'),
        safe_jsonb_extract_text(p_event.event_data, 'last_name'),
        safe_jsonb_extract_text(p_event.event_data, 'email'),
        safe_jsonb_extract_text(p_event.event_data, 'title'),
        safe_jsonb_extract_text(p_event.event_data, 'department'),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), false),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), true),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      );

    -- Handle contact updates
    WHEN 'contact.updated' THEN
      v_org_id := (SELECT organization_id FROM contacts_projection WHERE id = p_event.stream_id);

      -- If setting as primary, clear any existing primary flag
      IF safe_jsonb_extract_boolean(p_event.event_data, 'is_primary') THEN
        UPDATE contacts_projection
        SET is_primary = false, updated_at = p_event.created_at
        WHERE organization_id = v_org_id AND is_primary = true AND id != p_event.stream_id AND deleted_at IS NULL;
      END IF;

      UPDATE contacts_projection
      SET
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        first_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'first_name'), first_name),
        last_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'last_name'), last_name),
        email = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'email'), email),
        title = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'title'), title),
        department = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'department'), department),
        is_primary = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), is_primary),
        is_active = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), is_active),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id AND deleted_at IS NULL;

    -- Handle contact deletion (logical)
    WHEN 'contact.deleted' THEN
      UPDATE contacts_projection
      SET
        deleted_at = p_event.created_at,
        is_active = false,
        is_primary = false,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown contact event type: %', p_event.event_type;
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Address Event Processor
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_address_event(
  p_event RECORD
) RETURNS VOID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  CASE p_event.event_type

    -- Handle address creation
    WHEN 'address.created' THEN
      v_org_id := safe_jsonb_extract_organization_id(p_event.event_data, 'organization_id');

      -- If this address is marked as primary, clear any existing primary flag
      IF safe_jsonb_extract_boolean(p_event.event_data, 'is_primary') THEN
        UPDATE addresses_projection
        SET is_primary = false, updated_at = p_event.created_at
        WHERE organization_id = v_org_id AND is_primary = true AND deleted_at IS NULL;
      END IF;

      INSERT INTO addresses_projection (
        id, organization_id, label, street1, street2, city, state, zip_code,
        is_primary, is_active, metadata, created_at
      ) VALUES (
        p_event.stream_id,
        v_org_id,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'street1'),
        safe_jsonb_extract_text(p_event.event_data, 'street2'),
        safe_jsonb_extract_text(p_event.event_data, 'city'),
        safe_jsonb_extract_text(p_event.event_data, 'state'),
        safe_jsonb_extract_text(p_event.event_data, 'zip_code'),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), false),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), true),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      );

    -- Handle address updates
    WHEN 'address.updated' THEN
      v_org_id := (SELECT organization_id FROM addresses_projection WHERE id = p_event.stream_id);

      -- If setting as primary, clear any existing primary flag
      IF safe_jsonb_extract_boolean(p_event.event_data, 'is_primary') THEN
        UPDATE addresses_projection
        SET is_primary = false, updated_at = p_event.created_at
        WHERE organization_id = v_org_id AND is_primary = true AND id != p_event.stream_id AND deleted_at IS NULL;
      END IF;

      UPDATE addresses_projection
      SET
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        street1 = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'street1'), street1),
        street2 = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'street2'), street2),
        city = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'city'), city),
        state = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'state'), state),
        zip_code = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'zip_code'), zip_code),
        is_primary = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), is_primary),
        is_active = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), is_active),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id AND deleted_at IS NULL;

    -- Handle address deletion (logical)
    WHEN 'address.deleted' THEN
      UPDATE addresses_projection
      SET
        deleted_at = p_event.created_at,
        is_active = false,
        is_primary = false,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown address event type: %', p_event.event_type;
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Phone Event Processor
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_phone_event(
  p_event RECORD
) RETURNS VOID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  CASE p_event.event_type

    -- Handle phone creation
    WHEN 'phone.created' THEN
      v_org_id := safe_jsonb_extract_organization_id(p_event.event_data, 'organization_id');

      -- If this phone is marked as primary, clear any existing primary flag
      IF safe_jsonb_extract_boolean(p_event.event_data, 'is_primary') THEN
        UPDATE phones_projection
        SET is_primary = false, updated_at = p_event.created_at
        WHERE organization_id = v_org_id AND is_primary = true AND deleted_at IS NULL;
      END IF;

      INSERT INTO phones_projection (
        id, organization_id, label, number, extension, type,
        is_primary, is_active, metadata, created_at
      ) VALUES (
        p_event.stream_id,
        v_org_id,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'number'),
        safe_jsonb_extract_text(p_event.event_data, 'extension'),
        safe_jsonb_extract_text(p_event.event_data, 'type'),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), false),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), true),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      );

    -- Handle phone updates
    WHEN 'phone.updated' THEN
      v_org_id := (SELECT organization_id FROM phones_projection WHERE id = p_event.stream_id);

      -- If setting as primary, clear any existing primary flag
      IF safe_jsonb_extract_boolean(p_event.event_data, 'is_primary') THEN
        UPDATE phones_projection
        SET is_primary = false, updated_at = p_event.created_at
        WHERE organization_id = v_org_id AND is_primary = true AND id != p_event.stream_id AND deleted_at IS NULL;
      END IF;

      UPDATE phones_projection
      SET
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        number = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'number'), number),
        extension = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'extension'), extension),
        type = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'type'), type),
        is_primary = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), is_primary),
        is_active = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), is_active),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id AND deleted_at IS NULL;

    -- Handle phone deletion (logical)
    WHEN 'phone.deleted' THEN
      UPDATE phones_projection
      SET
        deleted_at = p_event.created_at,
        is_active = false,
        is_primary = false,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown phone event type: %', p_event.event_type;
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON FUNCTION process_program_event IS
  'Process program.* events and update programs_projection table';
COMMENT ON FUNCTION process_contact_event IS
  'Process contact.* events and update contacts_projection table - enforces single primary contact per organization';
COMMENT ON FUNCTION process_address_event IS
  'Process address.* events and update addresses_projection table - enforces single primary address per organization';
COMMENT ON FUNCTION process_phone_event IS
  'Process phone.* events and update phones_projection table - enforces single primary phone per organization';

-- ============================================================================
-- DEPLOYMENT COMPLETE
-- ============================================================================

-- Verify tables were created
SELECT
  'programs_projection' as table_name,
  COUNT(*) as row_count
FROM programs_projection
UNION ALL
SELECT
  'contacts_projection' as table_name,
  COUNT(*) as row_count
FROM contacts_projection
UNION ALL
SELECT
  'addresses_projection' as table_name,
  COUNT(*) as row_count
FROM addresses_projection
UNION ALL
SELECT
  'phones_projection' as table_name,
  COUNT(*) as row_count
FROM phones_projection;

-- Display success message
DO $$
BEGIN
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'Organization Module Database Migration Complete!';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'Tables created:';
  RAISE NOTICE '  - programs_projection';
  RAISE NOTICE '  - contacts_projection';
  RAISE NOTICE '  - addresses_projection';
  RAISE NOTICE '  - phones_projection';
  RAISE NOTICE '';
  RAISE NOTICE 'Event processors created:';
  RAISE NOTICE '  - process_program_event()';
  RAISE NOTICE '  - process_contact_event()';
  RAISE NOTICE '  - process_address_event()';
  RAISE NOTICE '  - process_phone_event()';
  RAISE NOTICE '';
  RAISE NOTICE 'Note: Validation constraints removed - business logic enforced at ViewModel layer';
  RAISE NOTICE '';
  RAISE NOTICE 'Next step: Run UPDATE_EVENT_ROUTER.sql to connect to main event router';
  RAISE NOTICE '============================================================================';
END $$;
