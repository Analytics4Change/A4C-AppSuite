-- Migration: Add Event Tracing Columns
-- Purpose: Enable end-to-end request tracing with correlation_id, session_id, and W3C-compatible trace context
-- Date: 2026-01-07
--
-- This migration:
-- 1. Adds tracing columns to domain_events (promoted from JSONB for query performance)
-- 2. Creates composite indexes for efficient time-range queries
-- 3. Creates RPC functions for trace queries
--
-- All patterns are idempotent (safe to re-run)

-- ============================================================================
-- PHASE 1: ADD TRACING COLUMNS TO domain_events
-- ============================================================================
-- Promoting trace fields to columns enables efficient composite indexes with time ranges.
-- JSONB extraction (event_metadata->>'correlation_id') prevents index usage in:
--   WHERE correlation_id = X AND created_at > Y

-- correlation_id: Business-level request correlation (UUID)
ALTER TABLE domain_events
  ADD COLUMN IF NOT EXISTS correlation_id UUID;

-- session_id: User's auth session from Supabase JWT (UUID)
ALTER TABLE domain_events
  ADD COLUMN IF NOT EXISTS session_id UUID;

-- trace_id: W3C Trace Context compatible trace ID (32 hex chars)
ALTER TABLE domain_events
  ADD COLUMN IF NOT EXISTS trace_id TEXT;

-- span_id: W3C Trace Context compatible span ID (16 hex chars)
ALTER TABLE domain_events
  ADD COLUMN IF NOT EXISTS span_id TEXT;

-- parent_span_id: Links to parent operation for causation chain tracking
ALTER TABLE domain_events
  ADD COLUMN IF NOT EXISTS parent_span_id TEXT;

-- Add comments for documentation
COMMENT ON COLUMN domain_events.correlation_id IS 'Business-level request correlation ID (UUID v4)';
COMMENT ON COLUMN domain_events.session_id IS 'User auth session ID from Supabase JWT';
COMMENT ON COLUMN domain_events.trace_id IS 'W3C Trace Context trace ID (32 hex chars)';
COMMENT ON COLUMN domain_events.span_id IS 'W3C Trace Context span ID (16 hex chars)';
COMMENT ON COLUMN domain_events.parent_span_id IS 'Parent span ID for causation chain tracking';

-- ============================================================================
-- PHASE 2: CREATE COMPOSITE INDEXES
-- ============================================================================
-- These indexes enable efficient queries combining trace IDs with time ranges.
-- Partial indexes (WHERE ... IS NOT NULL) reduce index size for events without tracing.

-- Index for correlation_id + time range queries
-- Use case: "Show all events for this request, most recent first"
CREATE INDEX IF NOT EXISTS idx_domain_events_correlation_time
  ON domain_events (correlation_id, created_at DESC)
  WHERE correlation_id IS NOT NULL;

-- Index for session_id + time range queries
-- Use case: "Show all events for this user session, most recent first"
CREATE INDEX IF NOT EXISTS idx_domain_events_session_time
  ON domain_events (session_id, created_at DESC)
  WHERE session_id IS NOT NULL;

-- Index for trace_id + time range queries
-- Use case: "Show all events in this trace, most recent first"
CREATE INDEX IF NOT EXISTS idx_domain_events_trace_time
  ON domain_events (trace_id, created_at DESC)
  WHERE trace_id IS NOT NULL;

-- Index for parent-child span lookups
-- Use case: "Find all child spans of this span"
CREATE INDEX IF NOT EXISTS idx_domain_events_parent_span
  ON domain_events (parent_span_id, created_at)
  WHERE parent_span_id IS NOT NULL;

-- ============================================================================
-- PHASE 3: RPC FUNCTIONS FOR TRACE QUERIES
-- ============================================================================

-- Function: api.get_events_by_correlation
-- Purpose: Query events by correlation_id (server-side, efficient)
CREATE OR REPLACE FUNCTION api.get_events_by_correlation(
  p_correlation_id UUID,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  event_type TEXT,
  stream_id UUID,
  stream_type TEXT,
  event_data JSONB,
  event_metadata JSONB,
  correlation_id UUID,
  session_id UUID,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    de.id,
    de.event_type,
    de.stream_id,
    de.stream_type,
    de.event_data,
    de.event_metadata,
    de.correlation_id,
    de.session_id,
    de.trace_id,
    de.span_id,
    de.parent_span_id,
    de.created_at
  FROM domain_events de
  WHERE de.correlation_id = p_correlation_id
  ORDER BY de.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Function: api.get_events_by_session
-- Purpose: Query events by session_id (server-side, efficient)
CREATE OR REPLACE FUNCTION api.get_events_by_session(
  p_session_id UUID,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  event_type TEXT,
  stream_id UUID,
  stream_type TEXT,
  event_data JSONB,
  event_metadata JSONB,
  correlation_id UUID,
  session_id UUID,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    de.id,
    de.event_type,
    de.stream_id,
    de.stream_type,
    de.event_data,
    de.event_metadata,
    de.correlation_id,
    de.session_id,
    de.trace_id,
    de.span_id,
    de.parent_span_id,
    de.created_at
  FROM domain_events de
  WHERE de.session_id = p_session_id
  ORDER BY de.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Function: api.get_trace_timeline
-- Purpose: Reconstruct full trace with parent-child relationships
-- Returns spans ordered by hierarchy (root first, then children by depth)
CREATE OR REPLACE FUNCTION api.get_trace_timeline(
  p_trace_id TEXT
)
RETURNS TABLE (
  id UUID,
  event_type TEXT,
  stream_id UUID,
  stream_type TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  service_name TEXT,
  operation_name TEXT,
  duration_ms INTEGER,
  status TEXT,
  created_at TIMESTAMPTZ,
  depth INTEGER
) AS $$
WITH RECURSIVE trace_tree AS (
  -- Root spans (no parent within this trace)
  SELECT
    de.id,
    de.event_type,
    de.stream_id,
    de.stream_type,
    de.span_id,
    de.parent_span_id,
    de.event_metadata->>'service_name' as service_name,
    de.event_metadata->>'operation_name' as operation_name,
    (de.event_metadata->>'duration_ms')::int as duration_ms,
    COALESCE(de.event_metadata->>'status', 'ok') as status,
    de.created_at,
    0 as depth
  FROM domain_events de
  WHERE de.trace_id = p_trace_id
    AND (de.parent_span_id IS NULL
         OR de.parent_span_id NOT IN (
           SELECT d2.span_id FROM domain_events d2
           WHERE d2.trace_id = p_trace_id AND d2.span_id IS NOT NULL
         ))

  UNION ALL

  -- Child spans (recursive)
  SELECT
    de.id,
    de.event_type,
    de.stream_id,
    de.stream_type,
    de.span_id,
    de.parent_span_id,
    de.event_metadata->>'service_name',
    de.event_metadata->>'operation_name',
    (de.event_metadata->>'duration_ms')::int,
    COALESCE(de.event_metadata->>'status', 'ok'),
    de.created_at,
    t.depth + 1
  FROM domain_events de
  INNER JOIN trace_tree t ON de.parent_span_id = t.span_id
  WHERE de.trace_id = p_trace_id
)
SELECT * FROM trace_tree
ORDER BY depth, created_at;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================================
-- PHASE 4: GRANT PERMISSIONS
-- ============================================================================

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION api.get_events_by_correlation(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION api.get_events_by_session(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION api.get_trace_timeline(TEXT) TO authenticated;

-- Grant to service_role for Temporal workers
GRANT EXECUTE ON FUNCTION api.get_events_by_correlation(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION api.get_events_by_session(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION api.get_trace_timeline(TEXT) TO service_role;

-- ============================================================================
-- SUMMARY OF OBJECTS CREATED
-- ============================================================================
-- Columns added to domain_events:
--   - correlation_id (UUID)
--   - session_id (UUID)
--   - trace_id (TEXT)
--   - span_id (TEXT)
--   - parent_span_id (TEXT)
--
-- Indexes created:
--   - idx_domain_events_correlation_time (correlation_id, created_at DESC)
--   - idx_domain_events_session_time (session_id, created_at DESC)
--   - idx_domain_events_trace_time (trace_id, created_at DESC)
--   - idx_domain_events_parent_span (parent_span_id, created_at)
--
-- Functions created:
--   - api.get_events_by_correlation(UUID, INTEGER)
--   - api.get_events_by_session(UUID, INTEGER)
--   - api.get_trace_timeline(TEXT)
