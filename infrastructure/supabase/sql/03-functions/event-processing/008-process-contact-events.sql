-- Contact Event Processing Functions
-- Handles all contact lifecycle events with CQRS-compliant projections
-- Source events: contact.* events in domain_events table

-- Main contact event processor
CREATE OR REPLACE FUNCTION process_contact_event(
  p_event RECORD
) RETURNS VOID AS $$
BEGIN
  CASE p_event.event_type

    -- Handle contact creation
    -- Note: phone is a separate entity (phones_projection) linked via contact_phones junction table
    WHEN 'contact.created' THEN
      INSERT INTO contacts_projection (
        id, organization_id, type, label,
        first_name, last_name, email, title, department,
        metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::contact_type
          ELSE NULL
        END,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'first_name'),
        safe_jsonb_extract_text(p_event.event_data, 'last_name'),
        safe_jsonb_extract_text(p_event.event_data, 'email'),
        safe_jsonb_extract_text(p_event.event_data, 'title'),
        safe_jsonb_extract_text(p_event.event_data, 'department'),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;  -- Idempotent

    -- Handle contact updates
    -- Note: phone is a separate entity (phones_projection) linked via contact_phones junction table
    WHEN 'contact.updated' THEN
      UPDATE contacts_projection
      SET
        type = CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::contact_type
          ELSE type
        END,
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        first_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'first_name'), first_name),
        last_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'last_name'), last_name),
        email = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'email'), email),
        title = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'title'), title),
        department = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'department'), department),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle contact deletion (soft delete)
    WHEN 'contact.deleted' THEN
      -- Event-driven soft delete (no CASCADE - must emit events for linked entities first)
      UPDATE contacts_projection
      SET
        deleted_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown contact event type: %', p_event.event_type;
  END CASE;

END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION process_contact_event IS
  'Main contact event processor - handles creation, updates, and soft deletion with CQRS projections';
