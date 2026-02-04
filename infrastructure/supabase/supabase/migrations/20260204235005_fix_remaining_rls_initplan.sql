-- =============================================================================
-- Migration: Fix Remaining RLS Initplan Policies
-- Purpose: Wrap current_setting() calls with (SELECT ...) for per-query
--          evaluation instead of per-row evaluation
-- Reference: Supabase advisor - "Auth RLS Initplan" warning
-- =============================================================================

-- =============================================================================
-- STEP 1: Fix impersonation_sessions_projection policies
-- =============================================================================

-- 1.1 impersonation_sessions_super_admin_select
DROP POLICY IF EXISTS "impersonation_sessions_super_admin_select" ON impersonation_sessions_projection;
CREATE POLICY "impersonation_sessions_super_admin_select" ON impersonation_sessions_projection
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = (SELECT current_setting('app.current_user', true))::uuid
      AND r.name = 'super_admin'
      AND ur.organization_id IS NULL
  )
);

-- 1.2 impersonation_sessions_provider_admin_select
DROP POLICY IF EXISTS "impersonation_sessions_provider_admin_select" ON impersonation_sessions_projection;
CREATE POLICY "impersonation_sessions_provider_admin_select" ON impersonation_sessions_projection
FOR SELECT USING (
  target_org_id = (SELECT current_setting('app.current_org', true))::uuid
  AND EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = (SELECT current_setting('app.current_user', true))::uuid
      AND r.name = 'provider_admin'
      AND ur.organization_id = impersonation_sessions_projection.target_org_id
  )
);

-- 1.3 impersonation_sessions_own_sessions_select
DROP POLICY IF EXISTS "impersonation_sessions_own_sessions_select" ON impersonation_sessions_projection;
CREATE POLICY "impersonation_sessions_own_sessions_select" ON impersonation_sessions_projection
FOR SELECT USING (
  super_admin_user_id = (SELECT current_setting('app.current_user', true))::uuid
  OR target_user_id = (SELECT current_setting('app.current_user', true))::uuid
);

-- =============================================================================
-- STEP 2: Fix invitations_projection policy
-- =============================================================================

DROP POLICY IF EXISTS "invitations_user_own_select" ON invitations_projection;
CREATE POLICY "invitations_user_own_select" ON invitations_projection
FOR SELECT USING (
  email = (SELECT (current_setting('request.jwt.claims', true))::json ->> 'email')
);

-- =============================================================================
-- STEP 3: Fix permission_implications policy
-- =============================================================================

DROP POLICY IF EXISTS "permission_implications_modify" ON permission_implications;
CREATE POLICY "permission_implications_modify" ON permission_implications
FOR ALL USING (
  (SELECT (current_setting('request.jwt.claims', true))::jsonb ->> 'user_role') = 'super_admin'
);

-- =============================================================================
-- STEP 4: Fix user_notification_preferences_projection policy
-- =============================================================================

DROP POLICY IF EXISTS "user_notification_prefs_service_role" ON user_notification_preferences_projection;
CREATE POLICY "user_notification_prefs_service_role" ON user_notification_preferences_projection
FOR ALL USING (
  (SELECT current_setting('role', true)) = 'service_role'
);

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
