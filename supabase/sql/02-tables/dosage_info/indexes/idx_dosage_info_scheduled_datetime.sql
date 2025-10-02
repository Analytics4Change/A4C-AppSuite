-- Index on scheduled_datetime
CREATE INDEX IF NOT EXISTS idx_dosage_info_scheduled_datetime ON dosage_info(scheduled_datetime);