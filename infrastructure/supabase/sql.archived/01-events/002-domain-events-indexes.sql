-- ============================================================================
-- Domain Events Additional Indexes
-- ============================================================================
-- Purpose: Performance indexes for domain_events table queries
-- Created: 2025-11-19
--
-- This file contains additional indexes beyond the core table definition.
-- All indexes use IF NOT EXISTS for idempotency.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- GIN Index for Tag-Based Queries
-- ----------------------------------------------------------------------------
-- Supports efficient cleanup of test/development data by metadata tags.
--
-- Tag Format Examples:
--   - 'development'           : Flag indicating dev environment
--   - 'mode:test'             : Workflow mode
--   - 'created:2025-11-19'    : Date created
--   - 'batch:phase4-verify'   : Batch ID for atomic cleanup
--
-- Query Pattern:
--   SELECT * FROM domain_events
--   WHERE event_metadata->'tags' ? 'development'
--     AND event_metadata->'tags' ? 'batch:xyz';
--
-- Cleanup Pattern:
--   DELETE FROM domain_events
--   WHERE event_metadata->'tags' ? 'development'
--     AND event_metadata->'tags' ? format('batch:%s', $1);
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_domain_events_tags
ON domain_events USING GIN ((event_metadata->'tags'))
WHERE event_metadata ? 'tags';

-- Note: Core indexes (stream, type, created, unprocessed, correlation, user)
-- are defined in 001-domain-events-table.sql
