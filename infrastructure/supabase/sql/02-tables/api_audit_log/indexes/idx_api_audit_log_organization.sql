-- Index on organization_id
CREATE INDEX IF NOT EXISTS idx_api_audit_log_organization ON api_audit_log(organization_id);