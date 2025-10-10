-- Index on client_ip
CREATE INDEX IF NOT EXISTS idx_api_audit_log_client_ip ON api_audit_log(client_ip);