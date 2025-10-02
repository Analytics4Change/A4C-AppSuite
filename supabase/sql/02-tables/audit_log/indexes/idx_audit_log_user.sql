-- Index on user_id
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);