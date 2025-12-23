-- ========================================
-- Process UserInvited Events
-- ========================================
-- DEPRECATED: Replaced by router-based processing
-- See: 001-main-event-router.sql → 002-process-organization-events.sql
-- ========================================

-- Drop deprecated trigger and function
DROP TRIGGER IF EXISTS process_user_invited_event ON domain_events;
DROP FUNCTION IF EXISTS process_user_invited_event();
