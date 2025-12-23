-- Index on organization_id
CREATE INDEX IF NOT EXISTS idx_clients_organization ON clients(organization_id);