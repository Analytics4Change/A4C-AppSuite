-- Index on request_id
CREATE INDEX IF NOT EXISTS idx_api_audit_log_request_id ON api_audit_log(request_id);