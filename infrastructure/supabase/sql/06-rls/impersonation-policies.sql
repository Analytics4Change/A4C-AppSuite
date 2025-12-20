-- Row-Level Security Policies for Impersonation Sessions
-- These policies must run AFTER RBAC tables (roles_projection, user_roles_projection) are created

-- Policy: Super admins can view all sessions
DROP POLICY IF EXISTS impersonation_sessions_super_admin_select ON impersonation_sessions_projection;
CREATE POLICY impersonation_sessions_super_admin_select
  ON impersonation_sessions_projection
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles_projection ur
      JOIN roles_projection r ON r.id = ur.role_id
      WHERE ur.user_id = current_setting('app.current_user')::UUID
        AND r.name = 'super_admin'
        AND ur.organization_id IS NULL
    )
  );

-- Policy: Provider admins can view sessions affecting their organization
DROP POLICY IF EXISTS impersonation_sessions_provider_admin_select ON impersonation_sessions_projection;
CREATE POLICY impersonation_sessions_provider_admin_select
  ON impersonation_sessions_projection
  FOR SELECT
  USING (
    target_org_id = current_setting('app.current_org')::UUID
    AND EXISTS (
      SELECT 1 FROM user_roles_projection ur
      JOIN roles_projection r ON r.id = ur.role_id
      WHERE ur.user_id = current_setting('app.current_user')::UUID
        AND r.name = 'provider_admin'
        AND ur.organization_id = target_org_id
    )
  );

-- Policy: Users can view their own impersonation sessions (as either super admin or target)
DROP POLICY IF EXISTS impersonation_sessions_own_sessions_select ON impersonation_sessions_projection;
CREATE POLICY impersonation_sessions_own_sessions_select
  ON impersonation_sessions_projection
  FOR SELECT
  USING (
    super_admin_user_id = current_setting('app.current_user')::UUID
    OR target_user_id = current_setting('app.current_user')::UUID
  );

COMMENT ON POLICY impersonation_sessions_super_admin_select ON impersonation_sessions_projection IS
  'Allows super admins to view all impersonation sessions across all organizations';
COMMENT ON POLICY impersonation_sessions_provider_admin_select ON impersonation_sessions_projection IS
  'Allows provider admins to view impersonation sessions that affected their organization';
COMMENT ON POLICY impersonation_sessions_own_sessions_select ON impersonation_sessions_projection IS
  'Allows users to view sessions where they were either the impersonator or the target';
