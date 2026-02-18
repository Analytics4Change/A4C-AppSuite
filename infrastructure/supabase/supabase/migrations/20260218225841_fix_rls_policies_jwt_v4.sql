-- Fix RLS policies that reference removed JWT v3 fields
-- Part of JWT v4 claims migration remediation (Phase 8)

-- Fix permission_implications_modify: user_role doesn't exist in JWT v4
-- Use has_platform_privilege() which correctly reads effective_permissions
DROP POLICY IF EXISTS permission_implications_modify ON permission_implications;
CREATE POLICY permission_implications_modify ON permission_implications
  FOR ALL
  USING (has_platform_privilege());

-- Fix user_notification_prefs_select_own: app_metadata.org_id doesn't exist in JWT v4
-- Use get_current_org_id() which reads org_id from top-level JWT claims
DROP POLICY IF EXISTS user_notification_prefs_select_own ON user_notification_preferences_projection;
CREATE POLICY user_notification_prefs_select_own ON user_notification_preferences_projection
  FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR organization_id = get_current_org_id()
  );
