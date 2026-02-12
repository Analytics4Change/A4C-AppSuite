-- =============================================================================
-- Migration: Fix RLS Initplan Performance
-- Purpose: Replace auth.uid() with (select auth.uid()) in RLS policies
--          to enable PostgreSQL to evaluate auth functions once per query
--          instead of once per row (significant performance improvement)
-- Reference: Supabase advisor - "Auth RLS Initplan" warning
-- =============================================================================

-- =============================================================================
-- DOMAIN_EVENTS POLICIES
-- =============================================================================

-- domain_events_authenticated_insert
DROP POLICY IF EXISTS "domain_events_authenticated_insert" ON domain_events;
CREATE POLICY "domain_events_authenticated_insert" ON domain_events
FOR INSERT
WITH CHECK (
  (select auth.uid()) IS NOT NULL
  AND (
    has_platform_privilege()
    OR ((event_metadata ->> 'organization_id')::uuid = ((current_setting('request.jwt.claims', true))::jsonb ->> 'org_id')::uuid)
  )
  AND length(event_metadata ->> 'reason') >= 10
);

-- domain_events_org_select
DROP POLICY IF EXISTS "domain_events_org_select" ON domain_events;
CREATE POLICY "domain_events_org_select" ON domain_events
FOR SELECT USING (
  (select auth.uid()) IS NOT NULL
  AND (
    has_platform_privilege()
    OR ((event_metadata ->> 'organization_id')::uuid = ((current_setting('request.jwt.claims', true))::jsonb ->> 'org_id')::uuid)
  )
);

-- =============================================================================
-- ROLE_PERMISSION_TEMPLATES POLICIES
-- =============================================================================

-- role_permission_templates_write
DROP POLICY IF EXISTS "role_permission_templates_write" ON role_permission_templates;
CREATE POLICY "role_permission_templates_write" ON role_permission_templates
FOR ALL USING (
  EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = (select auth.uid())
      AND r.name = 'super_admin'
  )
);

-- =============================================================================
-- USER_NOTIFICATION_PREFERENCES_PROJECTION POLICIES
-- =============================================================================

-- user_notification_prefs_select_own
DROP POLICY IF EXISTS "user_notification_prefs_select_own" ON user_notification_preferences_projection;
CREATE POLICY "user_notification_prefs_select_own" ON user_notification_preferences_projection
FOR SELECT USING (
  user_id = (select auth.uid())
  OR (((select auth.jwt()) -> 'app_metadata' ->> 'org_id')::uuid = organization_id)
);

-- user_notification_prefs_update_own
DROP POLICY IF EXISTS "user_notification_prefs_update_own" ON user_notification_preferences_projection;
CREATE POLICY "user_notification_prefs_update_own" ON user_notification_preferences_projection
FOR UPDATE
USING (user_id = (select auth.uid()))
WITH CHECK (user_id = (select auth.uid()));

-- =============================================================================
-- USERS TABLE POLICIES
-- =============================================================================

-- users_select
DROP POLICY IF EXISTS "users_select" ON users;
CREATE POLICY "users_select" ON users
FOR SELECT USING (
  has_platform_privilege()
  OR id = (select auth.uid())
  OR current_organization_id = get_current_org_id()
);

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
