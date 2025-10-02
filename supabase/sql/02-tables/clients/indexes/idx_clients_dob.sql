-- Index on date_of_birth
CREATE INDEX IF NOT EXISTS idx_clients_dob ON clients(date_of_birth);