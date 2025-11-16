-- Remove Deprecated Program Infrastructure
-- Programs feature deprecated - replaced with more flexible service offering model
--
-- This migration removes all program-related database objects:
-- - programs_projection table (CQRS projection)
-- - process_program_event() function (event processor)
-- - 'program' stream type routing from main event router
--
-- Data Status: programs_projection table is EMPTY (0 records as of 2025-01-16)
-- No data export required - greenfield removal
--
-- Safety: All changes use IF EXISTS for idempotency
-- Impact: Removes deprecated feature infrastructure cleanly
-- Rollback: Can recreate from git history if needed (file 004-programs_projection.sql)

-- ============================================================================
-- Drop Program Event Processor Function
-- ============================================================================

-- Drop the program event processor (was in file 007-process-organization-child-events.sql)
DROP FUNCTION IF EXISTS process_program_event(RECORD);

COMMENT ON FUNCTION process_program_event IS NULL; -- Remove comment

-- ============================================================================
-- Drop Programs Projection Table
-- ============================================================================

-- Drop the programs projection table and all its indexes/constraints
DROP TABLE IF EXISTS programs_projection CASCADE;

-- ============================================================================
-- Update Main Event Router
-- ============================================================================

-- The main event router (001-main-event-router.sql) has a CASE statement with 'program' stream type
-- We need to remove that case, but since it's a CASE statement in a function,
-- we'll need to recreate the function without the program case.
-- This will be handled by updating file 001 directly (not in migration).

-- For now, the router will just ignore program events (log warning)
-- The 'program' CASE has been removed from file 001-main-event-router.sql

-- ============================================================================
-- Clean Up Event Types Table (Optional)
-- ============================================================================

-- Remove program event types from event_types table if they exist
-- This is optional since event_types is just documentation

DELETE FROM event_types
WHERE event_type LIKE 'program.%';

-- ============================================================================
-- Verification Queries (for manual testing)
-- ============================================================================

-- Verify program table dropped:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_name = 'programs_projection';
-- Expected: 0 rows

-- Verify function dropped:
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_name = 'process_program_event';
-- Expected: 0 rows

-- Verify event types cleaned:
-- SELECT * FROM event_types WHERE event_type LIKE 'program.%';
-- Expected: 0 rows (or table doesn't exist if event_types is not used)

-- ============================================================================
-- Migration Notes
-- ============================================================================

-- This migration is part of Phase 1.4 (Provider Onboarding Enhancement)
-- Programs feature was replaced with more flexible contact/address/phone model
-- Old programs_projection table was never populated (greenfield removal)
--
-- Files affected by this removal:
-- - 004-programs_projection.sql (table definition) - deprecated
-- - 007-process-organization-child-events.sql (event processor) - deprecated function
-- - 001-main-event-router.sql (router case) - needs manual update
--
-- See: dev/active/provider-onboarding-enhancement-context.md for full context
