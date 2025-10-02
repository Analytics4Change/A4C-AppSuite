-- Index on organization_id
CREATE INDEX IF NOT EXISTS idx_medication_history_organization ON medication_history(organization_id);