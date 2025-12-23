-- Index on status
CREATE INDEX IF NOT EXISTS idx_medication_history_status ON medication_history(status);