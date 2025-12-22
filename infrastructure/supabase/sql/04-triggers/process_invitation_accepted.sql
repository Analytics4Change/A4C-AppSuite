-- ========================================
-- Process InvitationAccepted Events
-- ========================================
-- DEPRECATED: Replaced by router-based processing
-- See: 001-main-event-router.sql → 013-process-invitation-events.sql
-- ========================================

-- Drop deprecated trigger and function
DROP TRIGGER IF EXISTS process_invitation_accepted_event ON domain_events;
DROP FUNCTION IF EXISTS process_invitation_accepted_event();
