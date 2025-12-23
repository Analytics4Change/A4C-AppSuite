-- Index on organization_id
CREATE INDEX IF NOT EXISTS idx_medications_organization ON medications(organization_id);