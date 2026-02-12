-- P2: PostgREST Pre-Request Hook for Automatic Tracing
--
-- Closes the HIPAA observability gap: all domain events emitted via api.* RPC
-- functions automatically get correlation_id, trace_id, span_id from HTTP headers
-- without changing any function signatures.
--
-- Three-layer approach:
-- 1. Frontend custom fetch injects X-Correlation-ID + traceparent headers
-- 2. This pre-request hook extracts headers into PostgreSQL session variables
-- 3. emit_domain_event falls back to session variables when metadata fields are NULL
--
-- NOTE: PostgREST supports only ONE db_pre_request function. If you need
-- additional pre-request logic, add it to this function body rather than
-- creating a second function.

--------------------------------------------------------------------------------
-- 1. Pre-request function (extracts HTTP headers into session variables)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.postgrest_pre_request()
RETURNS void
LANGUAGE plpgsql
-- SECURITY INVOKER (default) is sufficient — no table access needed.
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_headers jsonb;
  v_traceparent text;
  v_trace_parts text[];
BEGIN
  -- Read PostgREST request headers (NULL if not in PostgREST context)
  BEGIN
    v_headers := current_setting('request.headers', true)::jsonb;
  EXCEPTION WHEN OTHERS THEN
    -- Fail-open: if header parsing fails, continue without tracing
    v_headers := NULL;
  END;

  IF v_headers IS NULL THEN
    RETURN;
  END IF;

  -- Correlation ID: from header or auto-generate
  PERFORM set_config('app.correlation_id',
    COALESCE(v_headers->>'x-correlation-id', gen_random_uuid()::text),
    true);  -- true = local to current transaction

  -- W3C traceparent: 00-{trace_id}-{span_id}-{flags}
  v_traceparent := v_headers->>'traceparent';
  IF v_traceparent IS NOT NULL THEN
    v_trace_parts := string_to_array(v_traceparent, '-');
    IF array_length(v_trace_parts, 1) = 4 THEN
      PERFORM set_config('app.trace_id', v_trace_parts[2], true);
      PERFORM set_config('app.span_id', v_trace_parts[3], true);
    END IF;
  END IF;

  -- Session ID (empty string if not present; emit_domain_event treats '' as NULL)
  PERFORM set_config('app.session_id',
    COALESCE(v_headers->>'x-session-id', ''),
    true);

EXCEPTION WHEN OTHERS THEN
  -- Top-level fail-open: never crash PostgREST requests due to tracing
  RETURN;
END;
$$;

COMMENT ON FUNCTION public.postgrest_pre_request() IS
  'PostgREST pre-request hook: extracts tracing headers (X-Correlation-ID, traceparent, X-Session-ID) '
  'into app.* session variables for automatic event tracing. Fail-open: errors are silently ignored.';

--------------------------------------------------------------------------------
-- 2. Register the pre-request function with PostgREST
--------------------------------------------------------------------------------

-- NOTE: PostgREST supports only ONE db_pre_request function.
-- This ALTER ROLE SET is idempotent — running it multiple times simply overwrites
-- the same GUC value.
ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.postgrest_pre_request';

-- Tell PostgREST to reload its configuration
NOTIFY pgrst, 'reload config';

--------------------------------------------------------------------------------
-- 3. Update emit_domain_event with session variable fallback + metadata enrichment
--
-- Key changes from current version:
-- - After extracting from p_event_metadata, falls back to app.* session variables
-- - Enriches event_metadata JSONB with tracing fields (queryable in one place)
-- - Auto-injects user_id from auth.uid() when not in metadata
-- - Signature unchanged — zero impact on callers
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.emit_domain_event(
  p_stream_id uuid,
  p_stream_type text,
  p_event_type text,
  p_event_data jsonb,
  p_event_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_event_id UUID;
  v_stream_version INT;
  v_correlation_id UUID;
  v_session_id UUID;
  v_trace_id TEXT;
  v_span_id TEXT;
  v_parent_span_id TEXT;
  v_enriched_metadata jsonb;
  v_app_val TEXT;
BEGIN
  -- Calculate next stream version
  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_stream_id AND stream_type = p_stream_type;

  -- Extract tracing from explicit metadata (takes precedence)
  BEGIN
    v_correlation_id := (p_event_metadata->>'correlation_id')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    v_correlation_id := NULL;
  END;

  BEGIN
    v_session_id := (p_event_metadata->>'session_id')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    v_session_id := NULL;
  END;

  v_trace_id := p_event_metadata->>'trace_id';
  v_span_id := p_event_metadata->>'span_id';
  v_parent_span_id := p_event_metadata->>'parent_span_id';

  -- Fallback to session variables from pre-request hook
  IF v_correlation_id IS NULL THEN
    v_app_val := current_setting('app.correlation_id', true);
    IF v_app_val IS NOT NULL AND v_app_val <> '' THEN
      BEGIN
        v_correlation_id := v_app_val::UUID;
      EXCEPTION WHEN invalid_text_representation THEN
        v_correlation_id := NULL;
      END;
    END IF;
  END IF;

  IF v_session_id IS NULL THEN
    v_app_val := current_setting('app.session_id', true);
    IF v_app_val IS NOT NULL AND v_app_val <> '' THEN
      BEGIN
        v_session_id := v_app_val::UUID;
      EXCEPTION WHEN invalid_text_representation THEN
        v_session_id := NULL;
      END;
    END IF;
  END IF;

  IF v_trace_id IS NULL THEN
    v_app_val := current_setting('app.trace_id', true);
    IF v_app_val IS NOT NULL AND v_app_val <> '' THEN
      v_trace_id := v_app_val;
    END IF;
  END IF;

  IF v_span_id IS NULL THEN
    v_app_val := current_setting('app.span_id', true);
    IF v_app_val IS NOT NULL AND v_app_val <> '' THEN
      v_span_id := v_app_val;
    END IF;
  END IF;

  -- Enrich metadata with tracing fields (so event_metadata JSONB is complete)
  v_enriched_metadata := p_event_metadata;

  IF v_correlation_id IS NOT NULL AND p_event_metadata->>'correlation_id' IS NULL THEN
    v_enriched_metadata := v_enriched_metadata || jsonb_build_object('correlation_id', v_correlation_id::text);
  END IF;

  IF v_session_id IS NOT NULL AND p_event_metadata->>'session_id' IS NULL THEN
    v_enriched_metadata := v_enriched_metadata || jsonb_build_object('session_id', v_session_id::text);
  END IF;

  IF v_trace_id IS NOT NULL AND p_event_metadata->>'trace_id' IS NULL THEN
    v_enriched_metadata := v_enriched_metadata || jsonb_build_object('trace_id', v_trace_id);
  END IF;

  IF v_span_id IS NOT NULL AND p_event_metadata->>'span_id' IS NULL THEN
    v_enriched_metadata := v_enriched_metadata || jsonb_build_object('span_id', v_span_id);
  END IF;

  -- Auto-inject user_id from auth.uid() if not already in metadata
  IF p_event_metadata->>'user_id' IS NULL AND auth.uid() IS NOT NULL THEN
    v_enriched_metadata := v_enriched_metadata || jsonb_build_object('user_id', auth.uid()::text);
  END IF;

  -- Insert event with tracing columns populated
  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata,
    correlation_id,
    session_id,
    trace_id,
    span_id,
    parent_span_id,
    created_at
  ) VALUES (
    p_stream_id,
    p_stream_type,
    v_stream_version,
    p_event_type,
    p_event_data,
    v_enriched_metadata,
    v_correlation_id,
    v_session_id,
    v_trace_id,
    v_span_id,
    v_parent_span_id,
    NOW()
  ) RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

COMMENT ON FUNCTION api.emit_domain_event(uuid, text, text, jsonb, jsonb) IS
  'Emit domain event with auto-calculated stream_version, tracing support, '
  'and automatic fallback to PostgREST pre-request hook session variables '
  'when metadata fields are NULL. Explicit metadata always takes precedence.';
