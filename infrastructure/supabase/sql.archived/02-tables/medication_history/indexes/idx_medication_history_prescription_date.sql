-- Index on prescription_date
CREATE INDEX IF NOT EXISTS idx_medication_history_prescription_date ON medication_history(prescription_date);