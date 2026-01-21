-- Migration: Add dismiss columns to domain_events for Event Monitor enhancements
-- Description: Enables platform admins to dismiss failed events with audit trail
--
-- Columns added:
--   dismissed_at    - When the event was dismissed
--   dismissed_by    - User ID who dismissed
--   dismiss_reason  - Optional reason for dismissal
--
-- Indexes added:
--   idx_domain_events_dismissed - For filtering dismissed events
--   idx_domain_events_failed_created - For sorted pagination on non-dismissed failed events
--   idx_domain_events_failed_type - For sorting by event_type

-- ============================================================================
-- Add dismiss columns
-- ============================================================================

ALTER TABLE domain_events
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dismissed_by UUID,
  ADD COLUMN IF NOT EXISTS dismiss_reason TEXT;

COMMENT ON COLUMN domain_events.dismissed_at IS 'Timestamp when event was dismissed by platform admin';
COMMENT ON COLUMN domain_events.dismissed_by IS 'User ID of platform admin who dismissed the event';
COMMENT ON COLUMN domain_events.dismiss_reason IS 'Optional reason for dismissing the event';

-- ============================================================================
-- Add indexes for efficient querying
-- ============================================================================

-- Partial index for filtering dismissed events efficiently
CREATE INDEX IF NOT EXISTS idx_domain_events_dismissed
  ON domain_events (dismissed_at)
  WHERE processing_error IS NOT NULL;

-- Composite index for sorted pagination on failed events (default view: non-dismissed)
CREATE INDEX IF NOT EXISTS idx_domain_events_failed_created
  ON domain_events (created_at DESC)
  WHERE processing_error IS NOT NULL AND dismissed_at IS NULL;

-- Composite index for sorting by event_type (non-dismissed failed events)
CREATE INDEX IF NOT EXISTS idx_domain_events_failed_type
  ON domain_events (event_type, created_at DESC)
  WHERE processing_error IS NOT NULL AND dismissed_at IS NULL;

-- ============================================================================
-- Add index comments for documentation
-- ============================================================================

COMMENT ON INDEX idx_domain_events_dismissed IS 'Partial index for efficient dismiss status filtering on failed events';
COMMENT ON INDEX idx_domain_events_failed_created IS 'Composite index for paginated failed events sorted by created_at DESC';
COMMENT ON INDEX idx_domain_events_failed_type IS 'Composite index for paginated failed events sorted by event_type';
