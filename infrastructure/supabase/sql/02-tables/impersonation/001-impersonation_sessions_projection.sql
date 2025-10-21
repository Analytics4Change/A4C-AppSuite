-- Impersonation Sessions Projection Table
-- CQRS Projection for impersonation domain events
-- Source events: impersonation.started, impersonation.renewed, impersonation.ended
-- Stream type: 'impersonation'

CREATE TABLE IF NOT EXISTS impersonation_sessions_projection (
  -- Primary identifiers
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT UNIQUE NOT NULL,

  -- Super Admin (the impersonator)
  super_admin_user_id UUID NOT NULL,
  super_admin_email TEXT NOT NULL,
  super_admin_name TEXT NOT NULL,
  super_admin_org_id UUID,  -- NULL for platform super_admin, UUID for org-scoped admin

  -- Target (the impersonated user)
  target_user_id UUID NOT NULL,
  target_email TEXT NOT NULL,
  target_name TEXT NOT NULL,
  target_org_id UUID NOT NULL,  -- Internal UUID of target organization
  target_org_name TEXT NOT NULL,
  target_org_type TEXT NOT NULL CHECK (target_org_type IN ('provider', 'provider_partner')),

  -- Justification
  justification_reason TEXT NOT NULL CHECK (justification_reason IN ('support_ticket', 'emergency', 'audit', 'training')),
  justification_reference_id TEXT,
  justification_notes TEXT,

  -- Session lifecycle
  status TEXT NOT NULL CHECK (status IN ('active', 'ended', 'expired')),
  started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  ended_reason TEXT CHECK (ended_reason IN ('manual_logout', 'timeout', 'renewal_declined', 'forced_by_admin')),
  ended_by_user_id UUID,  -- User ID if forced by another admin

  -- Session metrics
  duration_ms INTEGER NOT NULL,  -- Initial duration in milliseconds
  total_duration_ms INTEGER NOT NULL,  -- Total duration including renewals
  renewal_count INTEGER NOT NULL DEFAULT 0,
  actions_performed INTEGER NOT NULL DEFAULT 0,

  -- Metadata
  ip_address TEXT,
  user_agent TEXT,

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX idx_impersonation_sessions_super_admin
  ON impersonation_sessions_projection(super_admin_user_id);

CREATE INDEX idx_impersonation_sessions_target_user
  ON impersonation_sessions_projection(target_user_id);

CREATE INDEX idx_impersonation_sessions_target_org
  ON impersonation_sessions_projection(target_org_id);

CREATE INDEX idx_impersonation_sessions_status
  ON impersonation_sessions_projection(status)
  WHERE status = 'active';  -- Partial index for active sessions only

CREATE INDEX idx_impersonation_sessions_started_at
  ON impersonation_sessions_projection(started_at DESC);

CREATE INDEX idx_impersonation_sessions_expires_at
  ON impersonation_sessions_projection(expires_at)
  WHERE status = 'active';  -- Partial index for session expiration checks

-- Session ID lookup (unique constraint provides implicit index)
-- Justification reason for compliance reports
CREATE INDEX idx_impersonation_sessions_justification
  ON impersonation_sessions_projection(justification_reason);

-- Composite index for org-scoped audit queries
CREATE INDEX idx_impersonation_sessions_org_started
  ON impersonation_sessions_projection(target_org_id, started_at DESC);

-- Comments
COMMENT ON TABLE impersonation_sessions_projection IS 'CQRS projection of impersonation sessions. Source: domain_events with stream_type=impersonation. Tracks Super Admin impersonation sessions with full audit trail.';
COMMENT ON COLUMN impersonation_sessions_projection.session_id IS 'Unique session identifier (from event_data.session_id)';
COMMENT ON COLUMN impersonation_sessions_projection.status IS 'Session status: active (currently running), ended (manually terminated or declined renewal), expired (timed out)';
COMMENT ON COLUMN impersonation_sessions_projection.justification_reason IS 'Category of justification: support_ticket, emergency, audit, training';
COMMENT ON COLUMN impersonation_sessions_projection.renewal_count IS 'Number of times session was renewed (incremented by impersonation.renewed events)';
COMMENT ON COLUMN impersonation_sessions_projection.actions_performed IS 'Count of events emitted during session (updated by impersonation.ended event)';
COMMENT ON COLUMN impersonation_sessions_projection.total_duration_ms IS 'Total session duration including all renewals (milliseconds)';
