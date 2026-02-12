-- =============================================================================
-- Migration: Remove Duplicate Event Triggers
-- Purpose: Fix CQRS pattern violation where events were being processed twice:
--          1. By process_domain_event() → process_user_event(NEW) (correct)
--          2. By separate triggers calling no-parameter versions (duplicate)
-- Reference: documentation/infrastructure/patterns/event-handler-pattern.md
-- =============================================================================

-- =============================================================================
-- PROBLEM DESCRIPTION
-- =============================================================================
-- The correct CQRS event processing pattern is:
--
--   domain_events → process_domain_event() trigger (BEFORE INSERT)
--                           ↓
--           Routes by stream_type to routers:
--           ├── process_user_event(NEW)       ← record parameter version
--           ├── process_invitation_event(NEW) ← record parameter version
--           └── ...
--                           ↓
--           Each router dispatches to individual handlers:
--           ├── handle_user_created()
--           └── ...
--
-- However, LEGACY TRIGGERS also existed that called no-parameter versions:
--   - process_invitation_events_trigger → process_invitation_event()
--   - process_user_events_trigger → process_user_event()
--
-- This caused events to be processed TWICE, potentially causing:
--   - Duplicate database updates
--   - Incorrect projection state
--   - Performance overhead
--
-- This migration removes the duplicate triggers and their associated functions.
-- =============================================================================

-- =============================================================================
-- STEP 1: Remove duplicate triggers
-- =============================================================================

-- Remove the legacy user events trigger
-- (Events are already processed via process_domain_event → process_user_event(NEW))
DROP TRIGGER IF EXISTS process_user_events_trigger ON domain_events;

-- Remove the legacy invitation events trigger
-- (Events are already processed via process_domain_event → process_invitation_event(NEW))
DROP TRIGGER IF EXISTS process_invitation_events_trigger ON domain_events;

-- =============================================================================
-- STEP 2: Remove legacy no-parameter trigger functions
-- =============================================================================

-- Drop the no-parameter process_user_event() function
-- The record-parameter version process_user_event(record) is kept (called by router)
DROP FUNCTION IF EXISTS public.process_user_event();

-- Drop the no-parameter process_invitation_event() function
-- The record-parameter version process_invitation_event(record) is kept (called by router)
DROP FUNCTION IF EXISTS public.process_invitation_event();

-- =============================================================================
-- VERIFICATION QUERIES (for manual verification after migration)
-- =============================================================================
-- Run these queries to verify the cleanup:
--
-- 1. Check no duplicate triggers remain:
--    SELECT tgname, proname FROM pg_trigger t
--    JOIN pg_proc p ON t.tgfoid = p.oid
--    JOIN pg_class c ON t.tgrelid = c.oid
--    WHERE c.relname = 'domain_events' AND NOT t.tgisinternal
--    ORDER BY tgname;
--
-- 2. Check only record-parameter versions exist:
--    SELECT n.nspname, p.proname, pg_get_function_arguments(p.oid) as args
--    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
--    WHERE p.proname IN ('process_user_event', 'process_invitation_event')
--    ORDER BY p.proname;
--
-- Expected results after migration:
-- - No process_user_events_trigger or process_invitation_events_trigger
-- - Only process_user_event(record) and process_invitation_event(record) exist
-- =============================================================================

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
