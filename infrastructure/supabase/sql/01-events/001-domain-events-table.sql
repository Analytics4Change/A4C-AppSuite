-- Domain Events Table
-- This is the single source of truth for all system changes
-- Events are immutable and append-only
CREATE TABLE IF NOT EXISTS domain_events (
  -- Event identification
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_number BIGSERIAL UNIQUE NOT NULL, -- Global ordering

  -- Stream identification (the aggregate/entity this event belongs to)
  stream_id UUID NOT NULL, -- The entity ID (client_id, medication_id, etc.)
  stream_type TEXT NOT NULL, -- Entity type ('client', 'medication', 'user', etc.)
  stream_version INTEGER NOT NULL, -- Version within this specific stream

  -- Event details
  event_type TEXT NOT NULL, -- 'client.admitted', 'medication.prescribed', etc.
  event_data JSONB NOT NULL, -- The actual event payload

  -- Event metadata (the "why" and context)
  event_metadata JSONB NOT NULL DEFAULT '{}', -- {
    -- user_id: who initiated this
    -- reason: why this happened
    -- correlation_id: trace related events
    -- causation_id: what caused this event
    -- ip_address: where from
    -- user_agent: what client
    -- approval_chain: who approved
    -- notes: additional context
  -- }

  -- Processing status
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  processed_at TIMESTAMPTZ, -- When successfully projected to 3NF
  processing_error TEXT, -- Error if projection failed
  retry_count INTEGER DEFAULT 0,

  -- Constraints
  CONSTRAINT unique_stream_version UNIQUE(stream_id, stream_type, stream_version),
  CONSTRAINT valid_event_type CHECK (event_type ~ '^[a-z_]+\.[a-z_]+$'), -- format: 'domain.action'
  CONSTRAINT event_data_not_empty CHECK (jsonb_typeof(event_data) = 'object')
);

-- Indexes for performance
CREATE INDEX idx_domain_events_stream ON domain_events(stream_id, stream_type);
CREATE INDEX idx_domain_events_type ON domain_events(event_type);
CREATE INDEX idx_domain_events_created ON domain_events(created_at DESC);
CREATE INDEX idx_domain_events_unprocessed ON domain_events(processed_at)
  WHERE processed_at IS NULL;
CREATE INDEX idx_domain_events_correlation ON domain_events((event_metadata->>'correlation_id'))
  WHERE event_metadata ? 'correlation_id';
CREATE INDEX idx_domain_events_user ON domain_events((event_metadata->>'user_id'))
  WHERE event_metadata ? 'user_id';

-- Comments for documentation
COMMENT ON TABLE domain_events IS 'Event store - single source of truth for all system changes';
COMMENT ON COLUMN domain_events.stream_id IS 'The aggregate/entity ID this event belongs to';
COMMENT ON COLUMN domain_events.stream_type IS 'The type of entity (client, medication, etc.)';
COMMENT ON COLUMN domain_events.stream_version IS 'Version number for this specific entity stream';
COMMENT ON COLUMN domain_events.event_type IS 'Event type in format: domain.action (e.g., client.admitted)';
COMMENT ON COLUMN domain_events.event_data IS 'The actual event payload with all data needed to project';
COMMENT ON COLUMN domain_events.event_metadata IS 'Context including user, reason, approvals - the WHY';