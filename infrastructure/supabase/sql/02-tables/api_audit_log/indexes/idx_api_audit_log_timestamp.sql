-- Index on request_timestamp DESC
CREATE INDEX IF NOT EXISTS idx_api_audit_log_timestamp ON api_audit_log(request_timestamp DESC);