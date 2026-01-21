-- Migration: Event Monitor RPC function enhancements
-- Description: Adds dismiss/undismiss functions, pagination, and sorting to failed events API
--
-- Functions modified:
--   api.get_failed_events - Add pagination, sorting, dismiss filter, return dismiss columns
--   api.get_event_processing_stats - Add dismissed counts
--
-- Functions created:
--   api.dismiss_failed_event - Mark event as dismissed with audit
--   api.undismiss_failed_event - Reverse dismissal with audit

-- ============================================================================
-- Function: api.get_failed_events (updated)
-- ============================================================================

CREATE OR REPLACE FUNCTION api.get_failed_events(
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0,
  p_event_type TEXT DEFAULT NULL,
  p_stream_type TEXT DEFAULT NULL,
  p_since TIMESTAMPTZ DEFAULT NULL,
  p_include_dismissed BOOLEAN DEFAULT false,
  p_sort_by TEXT DEFAULT 'created_at',
  p_sort_order TEXT DEFAULT 'desc'
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
  created_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  dismissed_by UUID,
  dismiss_reason TEXT,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_total_count BIGINT;
BEGIN
  -- Authorization: Require platform.admin permission
  IF NOT has_platform_privilege() THEN
    RAISE EXCEPTION 'Access denied: platform.admin permission required';
  END IF;

  -- Validate sort parameters
  IF p_sort_by NOT IN ('created_at', 'event_type') THEN
    RAISE EXCEPTION 'Invalid sort_by value. Must be created_at or event_type';
  END IF;
  IF p_sort_order NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'Invalid sort_order value. Must be asc or desc';
  END IF;

  v_user_id := auth.uid();

  -- Emit audit event
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
        'offset', p_offset,
        'event_type', p_event_type,
        'stream_type', p_stream_type,
        'since', p_since,
        'include_dismissed', p_include_dismissed,
        'sort_by', p_sort_by,
        'sort_order', p_sort_order
      )
    ),
    jsonb_build_object(
      'user_id', v_user_id,
      'reason', 'Platform admin viewed failed events for observability monitoring',
      'organization_id', (current_setting('request.jwt.claims', true)::jsonb->>'org_id')
    )
  );

  -- Get total count for pagination
  SELECT COUNT(*) INTO v_total_count
  FROM domain_events de
  WHERE de.processing_error IS NOT NULL
    AND (p_event_type IS NULL OR de.event_type = p_event_type)
    AND (p_stream_type IS NULL OR de.stream_type = p_stream_type)
    AND (p_since IS NULL OR de.created_at >= p_since)
    AND (p_include_dismissed OR de.dismissed_at IS NULL);

  -- Return results with dynamic sorting
  IF p_sort_by = 'created_at' AND p_sort_order = 'desc' THEN
    RETURN QUERY
    SELECT
      de.id, de.stream_id, de.stream_type, de.stream_version, de.event_type,
      de.event_data, de.event_metadata, de.processing_error, de.processed_at,
      de.created_at, de.dismissed_at, de.dismissed_by, de.dismiss_reason,
      v_total_count
    FROM domain_events de
    WHERE de.processing_error IS NOT NULL
      AND (p_event_type IS NULL OR de.event_type = p_event_type)
      AND (p_stream_type IS NULL OR de.stream_type = p_stream_type)
      AND (p_since IS NULL OR de.created_at >= p_since)
      AND (p_include_dismissed OR de.dismissed_at IS NULL)
    ORDER BY de.created_at DESC
    LIMIT p_limit OFFSET p_offset;
  ELSIF p_sort_by = 'created_at' AND p_sort_order = 'asc' THEN
    RETURN QUERY
    SELECT
      de.id, de.stream_id, de.stream_type, de.stream_version, de.event_type,
      de.event_data, de.event_metadata, de.processing_error, de.processed_at,
      de.created_at, de.dismissed_at, de.dismissed_by, de.dismiss_reason,
      v_total_count
    FROM domain_events de
    WHERE de.processing_error IS NOT NULL
      AND (p_event_type IS NULL OR de.event_type = p_event_type)
      AND (p_stream_type IS NULL OR de.stream_type = p_stream_type)
      AND (p_since IS NULL OR de.created_at >= p_since)
      AND (p_include_dismissed OR de.dismissed_at IS NULL)
    ORDER BY de.created_at ASC
    LIMIT p_limit OFFSET p_offset;
  ELSIF p_sort_by = 'event_type' AND p_sort_order = 'desc' THEN
    RETURN QUERY
    SELECT
      de.id, de.stream_id, de.stream_type, de.stream_version, de.event_type,
      de.event_data, de.event_metadata, de.processing_error, de.processed_at,
      de.created_at, de.dismissed_at, de.dismissed_by, de.dismiss_reason,
      v_total_count
    FROM domain_events de
    WHERE de.processing_error IS NOT NULL
      AND (p_event_type IS NULL OR de.event_type = p_event_type)
      AND (p_stream_type IS NULL OR de.stream_type = p_stream_type)
      AND (p_since IS NULL OR de.created_at >= p_since)
      AND (p_include_dismissed OR de.dismissed_at IS NULL)
    ORDER BY de.event_type DESC, de.created_at DESC
    LIMIT p_limit OFFSET p_offset;
  ELSE -- event_type ASC
    RETURN QUERY
    SELECT
      de.id, de.stream_id, de.stream_type, de.stream_version, de.event_type,
      de.event_data, de.event_metadata, de.processing_error, de.processed_at,
      de.created_at, de.dismissed_at, de.dismissed_by, de.dismiss_reason,
      v_total_count
    FROM domain_events de
    WHERE de.processing_error IS NOT NULL
      AND (p_event_type IS NULL OR de.event_type = p_event_type)
      AND (p_stream_type IS NULL OR de.stream_type = p_stream_type)
      AND (p_since IS NULL OR de.created_at >= p_since)
      AND (p_include_dismissed OR de.dismissed_at IS NULL)
    ORDER BY de.event_type ASC, de.created_at DESC
    LIMIT p_limit OFFSET p_offset;
  END IF;
END;
$$;

COMMENT ON FUNCTION api.get_failed_events(INT, INT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, TEXT) IS
'Returns failed domain events with pagination, sorting, and dismiss filtering.
Requires platform.admin permission.
Emits platform.admin.failed_events_viewed audit event.

Parameters:
  p_limit (default 25) - Max events per page
  p_offset (default 0) - Pagination offset
  p_event_type - Filter by event type
  p_stream_type - Filter by stream type
  p_since - Filter events created after timestamp
  p_include_dismissed (default false) - Include dismissed events
  p_sort_by (default created_at) - Sort column: created_at or event_type
  p_sort_order (default desc) - Sort direction: asc or desc';

-- ============================================================================
-- Function: api.dismiss_failed_event
-- ============================================================================

CREATE OR REPLACE FUNCTION api.dismiss_failed_event(
  p_event_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_event RECORD;
BEGIN
  -- Authorization: Require platform.admin permission
  IF NOT has_platform_privilege() THEN
    RAISE EXCEPTION 'Access denied: platform.admin permission required';
  END IF;

  v_user_id := auth.uid();

  -- Get the event
  SELECT id, event_type, stream_type, stream_id, processing_error, dismissed_at
  INTO v_event
  FROM domain_events
  WHERE id = p_event_id;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Event not found'
    );
  END IF;

  IF v_event.processing_error IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Event has no processing error - cannot dismiss'
    );
  END IF;

  IF v_event.dismissed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Event is already dismissed'
    );
  END IF;

  -- Dismiss the event
  UPDATE domain_events
  SET
    dismissed_at = NOW(),
    dismissed_by = v_user_id,
    dismiss_reason = p_reason
  WHERE id = p_event_id;

  -- Emit audit event
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
    'platform.admin.event_dismissed',
    jsonb_build_object(
      'target_event_id', p_event_id,
      'target_event_type', v_event.event_type,
      'target_stream_type', v_event.stream_type,
      'target_stream_id', v_event.stream_id,
      'reason', p_reason
    ),
    jsonb_build_object(
      'user_id', v_user_id,
      'reason', COALESCE('Platform admin dismissed failed event: ' || p_reason, 'Platform admin dismissed failed event'),
      'organization_id', (current_setting('request.jwt.claims', true)::jsonb->>'org_id')
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Event dismissed successfully'
  );
END;
$$;

COMMENT ON FUNCTION api.dismiss_failed_event(UUID, TEXT) IS
'Dismisses a failed domain event (marks as acknowledged).
Requires platform.admin permission.
Emits platform.admin.event_dismissed audit event.';

-- ============================================================================
-- Function: api.undismiss_failed_event
-- ============================================================================

CREATE OR REPLACE FUNCTION api.undismiss_failed_event(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_event RECORD;
BEGIN
  -- Authorization: Require platform.admin permission
  IF NOT has_platform_privilege() THEN
    RAISE EXCEPTION 'Access denied: platform.admin permission required';
  END IF;

  v_user_id := auth.uid();

  -- Get the event
  SELECT id, event_type, stream_type, stream_id, dismissed_at, dismissed_by, dismiss_reason
  INTO v_event
  FROM domain_events
  WHERE id = p_event_id;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Event not found'
    );
  END IF;

  IF v_event.dismissed_at IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Event is not dismissed'
    );
  END IF;

  -- Undismiss the event
  UPDATE domain_events
  SET
    dismissed_at = NULL,
    dismissed_by = NULL,
    dismiss_reason = NULL
  WHERE id = p_event_id;

  -- Emit audit event
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
    'platform.admin.event_undismissed',
    jsonb_build_object(
      'target_event_id', p_event_id,
      'target_event_type', v_event.event_type,
      'target_stream_type', v_event.stream_type,
      'target_stream_id', v_event.stream_id,
      'previous_dismissed_by', v_event.dismissed_by,
      'previous_dismiss_reason', v_event.dismiss_reason
    ),
    jsonb_build_object(
      'user_id', v_user_id,
      'reason', 'Platform admin reversed dismissal of failed event',
      'organization_id', (current_setting('request.jwt.claims', true)::jsonb->>'org_id')
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Event undismissed successfully'
  );
END;
$$;

COMMENT ON FUNCTION api.undismiss_failed_event(UUID) IS
'Reverses dismissal of a failed domain event.
Requires platform.admin permission.
Emits platform.admin.event_undismissed audit event.';

-- ============================================================================
-- Function: api.get_event_processing_stats (updated)
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

  -- Emit audit event
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
    jsonb_build_object('timestamp', NOW()),
    jsonb_build_object(
      'user_id', v_user_id,
      'reason', 'Platform admin viewed event processing statistics',
      'organization_id', (current_setting('request.jwt.claims', true)::jsonb->>'org_id')
    )
  );

  SELECT jsonb_build_object(
    'total_events', (SELECT COUNT(*) FROM domain_events),
    'failed_events', (SELECT COUNT(*) FROM domain_events WHERE processing_error IS NOT NULL AND dismissed_at IS NULL),
    'failed_last_24h', (
      SELECT COUNT(*) FROM domain_events
      WHERE processing_error IS NOT NULL AND dismissed_at IS NULL
        AND created_at >= NOW() - INTERVAL '24 hours'
    ),
    'dismissed_count', (SELECT COUNT(*) FROM domain_events WHERE dismissed_at IS NOT NULL),
    'dismissed_last_24h', (
      SELECT COUNT(*) FROM domain_events
      WHERE dismissed_at IS NOT NULL
        AND dismissed_at >= NOW() - INTERVAL '24 hours'
    ),
    'failed_by_event_type', (
      SELECT COALESCE(jsonb_object_agg(de.event_type, cnt), '{}'::jsonb)
      FROM (
        SELECT event_type, COUNT(*) as cnt
        FROM domain_events
        WHERE processing_error IS NOT NULL AND dismissed_at IS NULL
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
        WHERE processing_error IS NOT NULL AND dismissed_at IS NULL
        GROUP BY stream_type
        ORDER BY cnt DESC
      ) de
    ),
    'recent_failures', (
      SELECT COALESCE(jsonb_agg(row_to_json(de)), '[]'::jsonb)
      FROM (
        SELECT id, stream_type, event_type, processing_error, created_at
        FROM domain_events
        WHERE processing_error IS NOT NULL AND dismissed_at IS NULL
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
Emits platform.admin.processing_stats_viewed audit event.

Returns:
  total_events - Total events in system
  failed_events - Failed events not dismissed
  failed_last_24h - Failed events in last 24 hours (not dismissed)
  dismissed_count - Total dismissed events
  dismissed_last_24h - Events dismissed in last 24 hours
  failed_by_event_type - Breakdown by event type
  failed_by_stream_type - Breakdown by stream type
  recent_failures - 10 most recent failures';
