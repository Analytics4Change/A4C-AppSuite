-- Index on last_name, first_name
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(last_name, first_name);