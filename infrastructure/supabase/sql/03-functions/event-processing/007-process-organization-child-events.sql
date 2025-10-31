-- Organization Child Entity Event Processing Functions
-- Handles program, contact, address, and phone events for organizations
-- Source events: program.*, contact.*, address.*, phone.* events in domain_events table

-- Program Event Processor
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

-- Contact Event Processor
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

-- Address Event Processor
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

-- Phone Event Processor
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
