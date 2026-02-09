-- Migration 3b P2 cleanup: Drop deprecated organization status functions
--
-- These functions were used by the old activateOrganization/deactivateOrganization
-- Temporal activities which have been replaced by event-driven handlers:
--   - activateOrganization → emitBootstrapCompletedActivity (handler sets is_active = true)
--   - deactivateOrganization → emitBootstrapFailedActivity (handler sets is_active = false)
--
-- No remaining callers in frontend, workflows, or Edge Functions.

DROP FUNCTION IF EXISTS api.update_organization_status(uuid, boolean, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS api.get_organization_status(uuid);
