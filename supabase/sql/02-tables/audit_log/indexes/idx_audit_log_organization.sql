-- Index on organization_id
CREATE INDEX IF NOT EXISTS idx_audit_log_organization ON audit_log(organization_id);