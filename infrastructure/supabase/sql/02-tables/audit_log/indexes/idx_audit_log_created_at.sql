-- Index on created_at DESC
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);