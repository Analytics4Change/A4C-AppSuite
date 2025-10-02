-- Index on event_type
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log(event_type);