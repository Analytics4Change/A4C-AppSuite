-- ============================================================================
-- Migration: Drop notification_preferences JSONB column
-- Purpose: Remove legacy JSONB column now that we use normalized table
-- ============================================================================

-- Drop from user_organizations_projection (the main read model)
-- Note: invitations_projection keeps its column for initial preference capture

ALTER TABLE public.user_organizations_projection
DROP COLUMN IF EXISTS notification_preferences;

COMMENT ON TABLE public.user_organizations_projection IS
  'User-organization membership projection. Notification preferences moved to user_notification_preferences_projection table.';

