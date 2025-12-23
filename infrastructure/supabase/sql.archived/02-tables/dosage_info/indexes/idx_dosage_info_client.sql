-- Index on client_id
CREATE INDEX IF NOT EXISTS idx_dosage_info_client ON dosage_info(client_id);