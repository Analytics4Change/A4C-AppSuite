-- Index on request_method, request_path
CREATE INDEX IF NOT EXISTS idx_api_audit_log_method_path ON api_audit_log(request_method, request_path);