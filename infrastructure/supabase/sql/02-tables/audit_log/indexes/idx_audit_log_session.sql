-- Index on session_id
CREATE INDEX IF NOT EXISTS idx_audit_log_session ON audit_log(session_id);