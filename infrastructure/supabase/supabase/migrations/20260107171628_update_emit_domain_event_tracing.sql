-- Migration: Update emit_domain_event to populate tracing columns
-- Purpose: Extract tracing fields from metadata and store in dedicated columns
-- Date: 2026-01-07
--
-- This migration updates api.emit_domain_event() to:
-- 1. Extract tracing fields from p_event_metadata (if present)
-- 2. Populate the new tracing columns: correlation_id, session_id, trace_id, span_id, parent_span_id
-- 3. Maintain backward compatibility (old callers continue to work)
--
-- Tracing fields are extracted from metadata using these keys:
--   - correlation_id: UUID for business-level request correlation
--   - session_id: UUID for user's auth session
--   - trace_id: 32 hex chars for W3C trace context
--   - span_id: 16 hex chars for W3C span ID
--   - parent_span_id: 16 hex chars for parent span (causation chain)
--
-- All patterns are idempotent (safe to re-run)

CREATE OR REPLACE FUNCTION api.emit_domain_event(
  p_stream_id UUID,
  p_stream_type TEXT,
  p_event_type TEXT,
  p_event_data JSONB,
  p_event_metadata JSONB DEFAULT '{}'::JSONB
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
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
BEGIN
  -- Calculate next stream version
  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_stream_id AND stream_type = p_stream_type;

  -- Extract tracing fields from metadata (if present)
  -- UUID fields: use explicit cast with validation
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

  -- Text fields: direct extraction
  v_trace_id := p_event_metadata->>'trace_id';
  v_span_id := p_event_metadata->>'span_id';
  v_parent_span_id := p_event_metadata->>'parent_span_id';

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
    p_event_metadata,
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

-- Update comment to document tracing support
COMMENT ON FUNCTION api.emit_domain_event(UUID, TEXT, TEXT, JSONB, JSONB) IS
'Emit domain event with auto-calculated stream_version and tracing support.

Parameters:
  - p_stream_id: UUID of the aggregate (role, user, etc.)
  - p_stream_type: Type of aggregate (role, user, organization)
  - p_event_type: Event type following AsyncAPI contract
  - p_event_data: Event payload (business data)
  - p_event_metadata: Audit and tracing context (optional)

Tracing Fields (extracted from p_event_metadata if present):
  - correlation_id: UUID for business-level request correlation
  - session_id: UUID for user auth session
  - trace_id: W3C trace ID (32 hex chars)
  - span_id: W3C span ID (16 hex chars)
  - parent_span_id: Parent span for causation chain

Returns:
  UUID of the created event

Example with tracing:
  SELECT api.emit_domain_event(
    ''123e4567-e89b-12d3-a456-426614174000''::uuid,
    ''user'',
    ''user.created'',
    ''{"email": "test@example.com"}''::jsonb,
    ''{"user_id": "...", "correlation_id": "...", "trace_id": "..."}''::jsonb
  );

@see documentation/infrastructure/guides/event-observability.md
';
