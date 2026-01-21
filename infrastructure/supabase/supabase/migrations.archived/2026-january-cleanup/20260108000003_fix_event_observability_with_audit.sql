-- Migration: Fix Event Observability Functions with Platform Privilege Check and Audit Events
-- Description: Updates authorization to use has_platform_privilege() and emits audit events
--
-- Changes:
-- 1. Replace complex platform owner check with simple has_platform_privilege() call
-- 2. Add audit event emission for observability actions
-- 3. Ensure all column references are properly aliased

-- ============================================================================
-- Function: api.get_failed_events
-- ============================================================================

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
DECLARE
  v_user_id UUID;
  v_result_count INT;
BEGIN
  -- Authorization: Require platform.admin permission
  IF NOT has_platform_privilege() THEN
    RAISE EXCEPTION 'Access denied: platform.admin permission required';
  END IF;

  v_user_id := auth.uid();

  -- Emit audit event (use gen_random_uuid() for stream_id - each audit is standalone)
  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  )
  VALUES (
    gen_random_uuid(),
    'platform_admin',
    1,
    'platform.admin.failed_events_viewed',
    jsonb_build_object(
      'filters', jsonb_build_object(
        'limit', p_limit,
        'event_type', p_event_type,
        'stream_type', p_stream_type,
        'since', p_since
      )
    ),
    jsonb_build_object(
      'user_id', v_user_id,
      'reason', 'Platform admin viewed failed events for observability monitoring',
      'organization_id', (current_setting('request.jwt.claims', true)::jsonb->>'org_id')
    )
  );

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

COMMENT ON FUNCTION api.get_failed_events(INT, TEXT, TEXT, TIMESTAMPTZ) IS
'Returns failed domain events for platform observability.
Requires platform.admin permission.
Emits platform.admin.failed_events_viewed audit event.';

-- ============================================================================
-- Function: api.retry_failed_event
-- ============================================================================

CREATE OR REPLACE FUNCTION api.retry_failed_event(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_event RECORD;
  v_result JSONB;
  v_retry_success BOOLEAN;
BEGIN
  -- Authorization: Require platform.admin permission
  IF NOT has_platform_privilege() THEN
    RAISE EXCEPTION 'Access denied: platform.admin permission required';
  END IF;

  v_user_id := auth.uid();

  -- Get the event
  SELECT * INTO v_event FROM domain_events WHERE domain_events.id = p_event_id;

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
  WHERE domain_events.id = p_event_id;

  -- Check if reprocessing succeeded
  SELECT processing_error INTO v_event.processing_error
  FROM domain_events WHERE domain_events.id = p_event_id;

  v_retry_success := (v_event.processing_error IS NULL);

  -- Emit audit event (use gen_random_uuid() for stream_id - each audit is standalone)
  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  )
  VALUES (
    gen_random_uuid(),
    'platform_admin',
    1,
    'platform.admin.event_retry_attempted',
    jsonb_build_object(
      'target_event_id', p_event_id,
      'target_event_type', v_event.event_type,
      'target_stream_type', v_event.stream_type,
      'target_stream_id', v_event.stream_id,
      'original_error', v_event.processing_error,
      'retry_success', v_retry_success,
      'new_error', CASE WHEN v_retry_success THEN NULL ELSE v_event.processing_error END
    ),
    jsonb_build_object(
      'user_id', v_user_id,
      'reason', 'Platform admin attempted to retry failed event processing',
      'organization_id', (current_setting('request.jwt.claims', true)::jsonb->>'org_id')
    )
  );

  IF v_retry_success THEN
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

COMMENT ON FUNCTION api.retry_failed_event(UUID) IS
'Retries processing a failed domain event.
Requires platform.admin permission.
Emits platform.admin.event_retry_attempted audit event.';

-- ============================================================================
-- Function: api.get_event_processing_stats
-- ============================================================================

CREATE OR REPLACE FUNCTION api.get_event_processing_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_result JSONB;
BEGIN
  -- Authorization: Require platform.admin permission
  IF NOT has_platform_privilege() THEN
    RAISE EXCEPTION 'Access denied: platform.admin permission required';
  END IF;

  v_user_id := auth.uid();

  -- Emit audit event (use gen_random_uuid() for stream_id - each audit is standalone)
  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  )
  VALUES (
    gen_random_uuid(),
    'platform_admin',
    1,
    'platform.admin.processing_stats_viewed',
    jsonb_build_object(
      'timestamp', NOW()
    ),
    jsonb_build_object(
      'user_id', v_user_id,
      'reason', 'Platform admin viewed event processing statistics',
      'organization_id', (current_setting('request.jwt.claims', true)::jsonb->>'org_id')
    )
  );

  SELECT jsonb_build_object(
    'total_events', (SELECT COUNT(*) FROM domain_events),
    'failed_events', (SELECT COUNT(*) FROM domain_events WHERE processing_error IS NOT NULL),
    'failed_last_24h', (
      SELECT COUNT(*) FROM domain_events
      WHERE processing_error IS NOT NULL
        AND created_at >= NOW() - INTERVAL '24 hours'
    ),
    'failed_by_event_type', (
      SELECT COALESCE(jsonb_object_agg(de.event_type, cnt), '{}'::jsonb)
      FROM (
        SELECT event_type, COUNT(*) as cnt
        FROM domain_events
        WHERE processing_error IS NOT NULL
        GROUP BY event_type
        ORDER BY cnt DESC
        LIMIT 20
      ) de
    ),
    'failed_by_stream_type', (
      SELECT COALESCE(jsonb_object_agg(de.stream_type, cnt), '{}'::jsonb)
      FROM (
        SELECT stream_type, COUNT(*) as cnt
        FROM domain_events
        WHERE processing_error IS NOT NULL
        GROUP BY stream_type
        ORDER BY cnt DESC
      ) de
    ),
    'recent_failures', (
      SELECT COALESCE(jsonb_agg(row_to_json(de)), '[]'::jsonb)
      FROM (
        SELECT id, stream_type, event_type, processing_error, created_at
        FROM domain_events
        WHERE processing_error IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 10
      ) de
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION api.get_event_processing_stats() IS
'Returns event processing statistics for platform observability.
Requires platform.admin permission.
Emits platform.admin.processing_stats_viewed audit event.';
