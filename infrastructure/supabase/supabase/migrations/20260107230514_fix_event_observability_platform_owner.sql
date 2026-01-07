-- Migration: Fix Event Observability Platform Owner Check
-- Description: Correct column reference from is_platform_owner to type = 'platform_owner'
-- The organizations_projection table uses type column with value 'platform_owner', not is_platform_owner boolean

-- ============================================================================
-- Function: api.get_failed_events (Fixed)
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
BEGIN
  -- Platform-owner check: Only A4C super_admins can access
  IF NOT EXISTS (
    SELECT 1
    WHERE (current_setting('request.jwt.claims', true)::jsonb->>'user_role') = 'super_admin'
      AND (current_setting('request.jwt.claims', true)::jsonb->>'org_id') =
          (SELECT id::text FROM organizations_projection WHERE type = 'platform_owner' LIMIT 1)
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

-- ============================================================================
-- Function: api.retry_failed_event (Fixed)
-- ============================================================================

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
          (SELECT id::text FROM organizations_projection WHERE type = 'platform_owner' LIMIT 1)
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

-- ============================================================================
-- Function: api.get_event_processing_stats (Fixed)
-- ============================================================================

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
          (SELECT id::text FROM organizations_projection WHERE type = 'platform_owner' LIMIT 1)
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
