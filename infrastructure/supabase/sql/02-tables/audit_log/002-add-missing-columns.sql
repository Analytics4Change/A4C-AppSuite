-- Add Missing Columns to audit_log Table
-- Migration: Fix schema drift between git and production
-- Issue: production audit_log has 15 columns, git defines 25+
-- Pattern: Same fix as session_id column (commit b1829c62)

-- Add event_name column
-- (Used by all event processors: process_client_event, process_medication_history_event, process_rbac_event)
ALTER TABLE audit_log
ADD COLUMN IF NOT EXISTS event_name TEXT;

-- Backfill existing rows with event_type value
-- (event_name typically duplicates event_type for audit trail searchability)
UPDATE audit_log SET event_name = event_type WHERE event_name IS NULL;

-- Add NOT NULL constraint after backfill
-- (Matches table.sql definition: event_name TEXT NOT NULL)
ALTER TABLE audit_log ALTER COLUMN event_name SET NOT NULL;

-- Add event_description column (nullable)
-- (Contains reason from event_metadata for audit context)
ALTER TABLE audit_log
ADD COLUMN IF NOT EXISTS event_description TEXT;

-- Add comment for documentation
COMMENT ON COLUMN audit_log.event_name IS 'Event name for audit trail (typically same as event_type)';
COMMENT ON COLUMN audit_log.event_description IS 'Description/reason from event metadata for audit context';
