-- Address Event Processing Functions
-- Handles all address lifecycle events with CQRS-compliant projections
-- Source events: address.* events in domain_events table

-- Main address event processor
CREATE OR REPLACE FUNCTION process_address_event(
  p_event RECORD
) RETURNS VOID AS $$
BEGIN
  CASE p_event.event_type

    -- Handle address creation
    WHEN 'address.created' THEN
      INSERT INTO addresses_projection (
        id, organization_id, type, label,
        street1, street2, city, state, zip_code, country,
        metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::address_type
          ELSE NULL
        END,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'street1'),
        safe_jsonb_extract_text(p_event.event_data, 'street2'),
        safe_jsonb_extract_text(p_event.event_data, 'city'),
        safe_jsonb_extract_text(p_event.event_data, 'state'),
        safe_jsonb_extract_text(p_event.event_data, 'zip_code'),
        COALESCE(safe_jsonb_extract_text(p_event.event_data, 'country'), 'USA'),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;  -- Idempotent

    -- Handle address updates
    WHEN 'address.updated' THEN
      UPDATE addresses_projection
      SET
        type = CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::address_type
          ELSE type
        END,
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        street1 = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'street1'), street1),
        street2 = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'street2'), street2),
        city = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'city'), city),
        state = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'state'), state),
        zip_code = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'zip_code'), zip_code),
        country = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'country'), country),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle address deletion (soft delete)
    WHEN 'address.deleted' THEN
      -- Event-driven soft delete (no CASCADE - must emit events for linked entities first)
      UPDATE addresses_projection
      SET
        deleted_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown address event type: %', p_event.event_type;
  END CASE;

END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION process_address_event IS
  'Main address event processor - handles creation, updates, and soft deletion with CQRS projections';
