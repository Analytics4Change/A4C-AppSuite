-- Migration: Event Processing Observability
-- Description: Add RPC functions for monitoring failed events and propagate critical event errors
-- Phase 1: api.get_failed_events(), api.retry_failed_event(), api.get_event_processing_stats()
-- Phase 2: Modify api.emit_domain_event() to check for processing errors on critical events

-- ============================================================================
-- PHASE 1: Failed Events Query RPC Functions
-- ============================================================================

-- Function: api.get_failed_events
-- Returns events that have processing errors, with optional filters
CREATE OR REPLACE FUNCTION api.get_failed_events(
  p_limit INT DEFAULT 50,
  p_event_type TEXT DEFAULT NULL,
  p_stream_type TEXT DEFAULT NULL,
  p_since TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  stream_id UUID,
  stream_type TEXT,
  stream_version INT,
  event_type TEXT,
  event_data JSONB,
  event_metadata JSONB,
  processing_error TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Platform-owner check: Only A4C super_admins can access
  IF NOT EXISTS (
    SELECT 1
    WHERE (current_setting('request.jwt.claims', true)::jsonb->>'user_role') = 'super_admin'
      AND (current_setting('request.jwt.claims', true)::jsonb->>'org_id') =
          (SELECT id::text FROM organizations_projection WHERE is_platform_owner = true LIMIT 1)
  ) THEN
    RAISE EXCEPTION 'Access denied: Platform owner access required';
  END IF;

  RETURN QUERY
  SELECT
    de.id,
    de.stream_id,
    de.stream_type,
    de.stream_version,
    de.event_type,
    de.event_data,
    de.event_metadata,
    de.processing_error,
    de.processed_at,
    de.created_at
  FROM domain_events de
  WHERE de.processing_error IS NOT NULL
    AND (p_event_type IS NULL OR de.event_type = p_event_type)
    AND (p_stream_type IS NULL OR de.stream_type = p_stream_type)
    AND (p_since IS NULL OR de.created_at >= p_since)
  ORDER BY de.created_at DESC
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION api.get_failed_events IS 'Query domain events with processing errors. Platform-owner access only.
Parameters:
  - p_limit: Maximum number of events to return (default 50)
  - p_event_type: Filter by event type (e.g., ''user.created'')
  - p_stream_type: Filter by stream/aggregate type (e.g., ''user'')
  - p_since: Only return events after this timestamp';


-- Function: api.retry_failed_event
-- Clears processing error and re-triggers event processing
CREATE OR REPLACE FUNCTION api.retry_failed_event(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event RECORD;
  v_result JSONB;
BEGIN
  -- Platform-owner check: Only A4C super_admins can access
  IF NOT EXISTS (
    SELECT 1
    WHERE (current_setting('request.jwt.claims', true)::jsonb->>'user_role') = 'super_admin'
      AND (current_setting('request.jwt.claims', true)::jsonb->>'org_id') =
          (SELECT id::text FROM organizations_projection WHERE is_platform_owner = true LIMIT 1)
  ) THEN
    RAISE EXCEPTION 'Access denied: Platform owner access required';
  END IF;

  -- Get the event
  SELECT * INTO v_event FROM domain_events WHERE id = p_event_id;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Event not found'
    );
  END IF;

  IF v_event.processing_error IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Event has no processing error to retry'
    );
  END IF;

  -- Clear error and processed_at to trigger reprocessing
  -- The BEFORE UPDATE trigger (process_domain_event) will reprocess
  UPDATE domain_events
  SET
    processing_error = NULL,
    processed_at = NULL
  WHERE id = p_event_id;

  -- Check if reprocessing succeeded
  SELECT processing_error INTO v_event.processing_error
  FROM domain_events WHERE id = p_event_id;

  IF v_event.processing_error IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Event reprocessed successfully'
    );
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reprocessing failed: ' || v_event.processing_error
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION api.retry_failed_event IS 'Retry processing a failed domain event. Clears the error and re-triggers the event processor. Platform-owner access only.';


-- Function: api.get_event_processing_stats
-- Returns summary statistics about event processing
CREATE OR REPLACE FUNCTION api.get_event_processing_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Platform-owner check: Only A4C super_admins can access
  IF NOT EXISTS (
    SELECT 1
    WHERE (current_setting('request.jwt.claims', true)::jsonb->>'user_role') = 'super_admin'
      AND (current_setting('request.jwt.claims', true)::jsonb->>'org_id') =
          (SELECT id::text FROM organizations_projection WHERE is_platform_owner = true LIMIT 1)
  ) THEN
    RAISE EXCEPTION 'Access denied: Platform owner access required';
  END IF;

  SELECT jsonb_build_object(
    'total_events', (SELECT COUNT(*) FROM domain_events),
    'failed_events', (SELECT COUNT(*) FROM domain_events WHERE processing_error IS NOT NULL),
    'failed_last_24h', (
      SELECT COUNT(*) FROM domain_events
      WHERE processing_error IS NOT NULL
        AND created_at >= NOW() - INTERVAL '24 hours'
    ),
    'failed_by_event_type', (
      SELECT COALESCE(jsonb_object_agg(event_type, cnt), '{}'::jsonb)
      FROM (
        SELECT event_type, COUNT(*) as cnt
        FROM domain_events
        WHERE processing_error IS NOT NULL
        GROUP BY event_type
        ORDER BY cnt DESC
        LIMIT 20
      ) sub
    ),
    'failed_by_stream_type', (
      SELECT COALESCE(jsonb_object_agg(stream_type, cnt), '{}'::jsonb)
      FROM (
        SELECT stream_type, COUNT(*) as cnt
        FROM domain_events
        WHERE processing_error IS NOT NULL
        GROUP BY stream_type
        ORDER BY cnt DESC
      ) sub
    ),
    'recent_failures', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)), '[]'::jsonb)
      FROM (
        SELECT id, stream_type, event_type, processing_error, created_at
        FROM domain_events
        WHERE processing_error IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 10
      ) sub
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION api.get_event_processing_stats IS 'Get summary statistics about event processing including failure counts and recent failures. Platform-owner access only.';


-- ============================================================================
-- PHASE 2: Propagate Critical Event Errors
-- ============================================================================

-- Define critical event types that should fail visibly
-- These are events where silent failures cause broken user-facing data
CREATE OR REPLACE FUNCTION api.emit_domain_event(
  p_stream_id UUID,
  p_stream_type TEXT,
  p_event_type TEXT,
  p_event_data JSONB,
  p_event_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id UUID;
  v_stream_version INT;
  v_processing_error TEXT;
  v_critical_event_types TEXT[] := ARRAY[
    'user.created',
    'user.role.assigned',
    'user.role.removed',
    'invitation.accepted',
    'invitation.created',
    'organization.created',
    'organization.bootstrap.completed'
  ];
BEGIN
  -- Calculate next stream version
  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_stream_id AND stream_type = p_stream_type;

  -- Insert the event (triggers process_domain_event via BEFORE INSERT trigger)
  INSERT INTO domain_events (
    stream_id, stream_type, stream_version, event_type, event_data, event_metadata, created_at
  ) VALUES (
    p_stream_id, p_stream_type, v_stream_version, p_event_type, p_event_data, p_event_metadata, NOW()
  ) RETURNING id INTO v_event_id;

  -- For critical events, check if processing failed and propagate the error
  IF p_event_type = ANY(v_critical_event_types) THEN
    SELECT processing_error INTO v_processing_error
    FROM domain_events WHERE id = v_event_id;

    IF v_processing_error IS NOT NULL THEN
      -- Propagate the error so caller can see it
      RAISE EXCEPTION 'Event processing failed for %: %', p_event_type, v_processing_error
        USING ERRCODE = 'P0001';  -- raise_exception
    END IF;
  END IF;

  RETURN v_event_id;
END;
$$;

COMMENT ON FUNCTION api.emit_domain_event IS 'Emit domain event with auto-calculated stream_version.
For critical events (user.created, invitation.accepted, etc.), processing errors are propagated
as exceptions so callers can handle them appropriately.

Parameters:
  - p_stream_id: UUID of the aggregate (role, user, etc.)
  - p_stream_type: Type of aggregate (role, user, organization)
  - p_event_type: The event type (e.g., ''user.created'')
  - p_event_data: Event payload as JSONB
  - p_event_metadata: Optional metadata (user_id, correlation_id, etc.)

Critical event types that propagate errors:
  - user.created, user.role.assigned, user.role.removed
  - invitation.accepted, invitation.created
  - organization.created, organization.bootstrap.completed';


-- ============================================================================
-- GRANTS
-- ============================================================================

-- Grant execute to authenticated role for all new functions
GRANT EXECUTE ON FUNCTION api.get_failed_events(INT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION api.retry_failed_event(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION api.get_event_processing_stats() TO authenticated;

-- Ensure emit_domain_event grants are maintained
GRANT EXECUTE ON FUNCTION api.emit_domain_event(UUID, TEXT, TEXT, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION api.emit_domain_event(UUID, TEXT, TEXT, JSONB, JSONB) TO service_role;
