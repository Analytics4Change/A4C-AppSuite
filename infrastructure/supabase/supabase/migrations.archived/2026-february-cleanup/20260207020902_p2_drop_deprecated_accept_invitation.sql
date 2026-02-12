-- Migration 4a: Drop deprecated api.accept_invitation function
--
-- This function has been deprecated since 2025-12-22. Its body contains:
--   RAISE WARNING 'api.accept_invitation is deprecated...'
-- The invitation acceptance flow is handled by the accept-invitation Edge Function
-- which emits an invitation.accepted event, processed by process_invitation_event().
--
-- No active callers exist in frontend, workflows, or Edge Functions.

DROP FUNCTION IF EXISTS api.accept_invitation(uuid);
