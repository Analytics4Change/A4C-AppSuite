-- Main Event Router Function
-- Routes domain events to appropriate projection handlers
CREATE OR REPLACE FUNCTION process_domain_event()
RETURNS TRIGGER AS $$
DECLARE
  v_start_time TIMESTAMPTZ;
  v_error_msg TEXT;
  v_error_detail TEXT;
BEGIN
  v_start_time := clock_timestamp();

  -- Skip if already processed
  IF NEW.processed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- Route based on stream type
    CASE NEW.stream_type
      WHEN 'client' THEN
        PERFORM process_client_event(NEW);

      WHEN 'medication' THEN
        PERFORM process_medication_event(NEW);

      WHEN 'medication_history' THEN
        PERFORM process_medication_history_event(NEW);

      WHEN 'dosage' THEN
        PERFORM process_dosage_event(NEW);

      WHEN 'user' THEN
        PERFORM process_user_event(NEW);

      WHEN 'organization' THEN
        PERFORM process_organization_event(NEW);

      ELSE
        RAISE WARNING 'Unknown stream type: %', NEW.stream_type;
    END CASE;

    -- Mark as successfully processed
    NEW.processed_at = clock_timestamp();
    NEW.processing_error = NULL;

    -- Log processing time if it took too long (>100ms)
    IF (clock_timestamp() - v_start_time) > interval '100 milliseconds' THEN
      RAISE WARNING 'Event % took % to process',
        NEW.id,
        (clock_timestamp() - v_start_time);
    END IF;

  EXCEPTION
    WHEN OTHERS THEN
      -- Capture error details
      GET STACKED DIAGNOSTICS
        v_error_msg = MESSAGE_TEXT,
        v_error_detail = PG_EXCEPTION_DETAIL;

      -- Log error
      RAISE WARNING 'Failed to process event %: % - %',
        NEW.id,
        v_error_msg,
        v_error_detail;

      -- Update event with error info
      NEW.processing_error = format('Error: %s | Detail: %s', v_error_msg, v_error_detail);
      NEW.retry_count = COALESCE(NEW.retry_count, 0) + 1;

      -- Don't mark as processed so it can be retried
      NEW.processed_at = NULL;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Helper function to get current state version for an entity
CREATE OR REPLACE FUNCTION get_entity_version(
  p_stream_id UUID,
  p_stream_type TEXT
) RETURNS INTEGER AS $$
  SELECT COALESCE(MAX(stream_version), 0)
  FROM domain_events
  WHERE stream_id = p_stream_id
    AND stream_type = p_stream_type
    AND processed_at IS NOT NULL;
$$ LANGUAGE SQL STABLE;

-- Helper function to validate event sequence
CREATE OR REPLACE FUNCTION validate_event_sequence(
  p_event domain_events
) RETURNS BOOLEAN AS $$
DECLARE
  v_expected_version INTEGER;
BEGIN
  v_expected_version := get_entity_version(p_event.stream_id, p_event.stream_type) + 1;

  IF p_event.stream_version != v_expected_version THEN
    RAISE EXCEPTION 'Event version mismatch. Expected %, got %',
      v_expected_version,
      p_event.stream_version;
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Function to safely extract and cast JSONB fields
CREATE OR REPLACE FUNCTION safe_jsonb_extract_text(
  p_data JSONB,
  p_key TEXT,
  p_default TEXT DEFAULT NULL
) RETURNS TEXT AS $$
  SELECT COALESCE(p_data->>, p_key, p_default);
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION safe_jsonb_extract_uuid(
  p_data JSONB,
  p_key TEXT,
  p_default UUID DEFAULT NULL
) RETURNS UUID AS $$
  SELECT COALESCE((p_data->>p_key)::UUID, p_default);
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION safe_jsonb_extract_timestamp(
  p_data JSONB,
  p_key TEXT,
  p_default TIMESTAMPTZ DEFAULT NULL
) RETURNS TIMESTAMPTZ AS $$
  SELECT COALESCE((p_data->>p_key)::TIMESTAMPTZ, p_default);
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION safe_jsonb_extract_date(
  p_data JSONB,
  p_key TEXT,
  p_default DATE DEFAULT NULL
) RETURNS DATE AS $$
  SELECT COALESCE((p_data->>p_key)::DATE, p_default);
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION safe_jsonb_extract_boolean(
  p_data JSONB,
  p_key TEXT,
  p_default BOOLEAN DEFAULT FALSE
) RETURNS BOOLEAN AS $$
  SELECT COALESCE((p_data->>p_key)::BOOLEAN, p_default);
$$ LANGUAGE SQL IMMUTABLE;

-- Organization ID Resolution Functions
-- Supports both internal UUIDs and external Zitadel organization IDs
-- Also supports mock organization IDs during development

CREATE OR REPLACE FUNCTION get_organization_uuid_from_external_id(
  p_external_id TEXT
) RETURNS UUID AS $$
  SELECT id
  FROM organizations
  WHERE external_id = p_external_id
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION safe_jsonb_extract_organization_id(
  p_data JSONB,
  p_key TEXT DEFAULT 'organization_id'
) RETURNS UUID AS $$
DECLARE
  v_value TEXT;
  v_uuid UUID;
BEGIN
  v_value := p_data->>p_key;

  -- Handle NULL or empty
  IF v_value IS NULL OR v_value = '' THEN
    RETURN NULL;
  END IF;

  -- Try to cast as UUID first (handles internal UUID format)
  BEGIN
    v_uuid := v_value::UUID;
    RETURN v_uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    -- If cast fails, it's an external_id (Zitadel or mock), look it up
    RETURN get_organization_uuid_from_external_id(v_value);
  END;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION process_domain_event IS 'Main router that processes domain events and projects them to 3NF tables';
COMMENT ON FUNCTION get_entity_version IS 'Gets the current version number for an entity stream';
COMMENT ON FUNCTION validate_event_sequence IS 'Ensures events are processed in order';
COMMENT ON FUNCTION get_organization_uuid_from_external_id IS 'Resolve Zitadel/mock organization external_id to internal UUID';
COMMENT ON FUNCTION safe_jsonb_extract_organization_id IS 'Extract organization_id from event data, supporting UUID, Zitadel ID, and mock ID formats';