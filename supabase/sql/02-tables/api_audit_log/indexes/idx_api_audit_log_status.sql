-- Index on response_status_code
CREATE INDEX IF NOT EXISTS idx_api_audit_log_status ON api_audit_log(response_status_code);