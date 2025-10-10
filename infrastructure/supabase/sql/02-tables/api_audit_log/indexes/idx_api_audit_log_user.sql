-- Index on auth_user_id
CREATE INDEX IF NOT EXISTS idx_api_audit_log_user ON api_audit_log(auth_user_id);