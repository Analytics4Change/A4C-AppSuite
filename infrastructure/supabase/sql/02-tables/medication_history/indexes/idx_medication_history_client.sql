-- Index on client_id
CREATE INDEX IF NOT EXISTS idx_medication_history_client ON medication_history(client_id);