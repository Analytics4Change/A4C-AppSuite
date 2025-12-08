-- Row-Level Security Policies for Core Projection Tables
-- Implements multi-tenant isolation with super_admin bypass

-- ============================================================================
-- Organizations Projection
-- ============================================================================

-- Super admins can view all organizations
DROP POLICY IF EXISTS organizations_super_admin_all ON organizations_projection;
CREATE POLICY organizations_super_admin_all
  ON organizations_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Provider/Partner admins can view their own organization
DROP POLICY IF EXISTS organizations_org_admin_select ON organizations_projection;
CREATE POLICY organizations_org_admin_select
  ON organizations_projection
  FOR SELECT
  USING (is_org_admin(get_current_user_id(), id));

COMMENT ON POLICY organizations_super_admin_all ON organizations_projection IS
  'Allows super admins full access to all organizations';
COMMENT ON POLICY organizations_org_admin_select ON organizations_projection IS
  'Allows organization admins to view their own organization details';


-- ============================================================================
-- Organization Business Profiles Projection
-- ============================================================================

-- Super admins can view all business profiles
DROP POLICY IF EXISTS business_profiles_super_admin_all ON organization_business_profiles_projection;
CREATE POLICY business_profiles_super_admin_all
  ON organization_business_profiles_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Provider/Partner admins can view their own organization's profile
DROP POLICY IF EXISTS business_profiles_org_admin_select ON organization_business_profiles_projection;
CREATE POLICY business_profiles_org_admin_select
  ON organization_business_profiles_projection
  FOR SELECT
  USING (is_org_admin(get_current_user_id(), organization_id));

COMMENT ON POLICY business_profiles_super_admin_all ON organization_business_profiles_projection IS
  'Allows super admins full access to all business profiles';
COMMENT ON POLICY business_profiles_org_admin_select ON organization_business_profiles_projection IS
  'Allows organization admins to view their own business profile';


-- ============================================================================
-- Users
-- ============================================================================

-- Super admins can view all users
DROP POLICY IF EXISTS users_super_admin_all ON users;
CREATE POLICY users_super_admin_all
  ON users
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view users in their organization
DROP POLICY IF EXISTS users_org_admin_select ON users;
CREATE POLICY users_org_admin_select
  ON users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM user_roles_projection ur
      WHERE ur.user_id = users.id
        AND is_org_admin(get_current_user_id(), ur.org_id)
    )
  );

-- Users can view their own profile
DROP POLICY IF EXISTS users_own_profile_select ON users;
CREATE POLICY users_own_profile_select
  ON users
  FOR SELECT
  USING (id = get_current_user_id());

COMMENT ON POLICY users_super_admin_all ON users IS
  'Allows super admins full access to all users';
COMMENT ON POLICY users_org_admin_select ON users IS
  'Allows organization admins to view users in their organization';
COMMENT ON POLICY users_own_profile_select ON users IS
  'Allows users to view their own profile';


-- ============================================================================
-- Permissions Projection
-- ============================================================================

-- Super admins can view all permissions
DROP POLICY IF EXISTS permissions_super_admin_all ON permissions_projection;
CREATE POLICY permissions_super_admin_all
  ON permissions_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- All authenticated users can view available permissions (read-only reference data)
DROP POLICY IF EXISTS permissions_authenticated_select ON permissions_projection;
CREATE POLICY permissions_authenticated_select
  ON permissions_projection
  FOR SELECT
  USING (get_current_user_id() IS NOT NULL);

COMMENT ON POLICY permissions_super_admin_all ON permissions_projection IS
  'Allows super admins full access to permission definitions';
COMMENT ON POLICY permissions_authenticated_select ON permissions_projection IS
  'Allows authenticated users to view available permissions';


-- ============================================================================
-- Roles Projection
-- ============================================================================

-- Super admins can view all roles
DROP POLICY IF EXISTS roles_super_admin_all ON roles_projection;
CREATE POLICY roles_super_admin_all
  ON roles_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view roles in their organization
DROP POLICY IF EXISTS roles_org_admin_select ON roles_projection;
CREATE POLICY roles_org_admin_select
  ON roles_projection
  FOR SELECT
  USING (
    organization_id IS NOT NULL
    AND is_org_admin(get_current_user_id(), organization_id)
  );

-- All authenticated users can view global roles (templates like provider_admin, partner_admin)
DROP POLICY IF EXISTS roles_global_select ON roles_projection;
CREATE POLICY roles_global_select
  ON roles_projection
  FOR SELECT
  USING (
    organization_id IS NULL
    AND get_current_user_id() IS NOT NULL
  );

COMMENT ON POLICY roles_super_admin_all ON roles_projection IS
  'Allows super admins full access to all roles';
COMMENT ON POLICY roles_org_admin_select ON roles_projection IS
  'Allows organization admins to view roles in their organization';
COMMENT ON POLICY roles_global_select ON roles_projection IS
  'Allows authenticated users to view global role templates';


-- ============================================================================
-- Role Permissions Projection
-- ============================================================================

-- Super admins can view all role permissions
DROP POLICY IF EXISTS role_permissions_super_admin_all ON role_permissions_projection;
CREATE POLICY role_permissions_super_admin_all
  ON role_permissions_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view permissions for roles in their organization
DROP POLICY IF EXISTS role_permissions_org_admin_select ON role_permissions_projection;
CREATE POLICY role_permissions_org_admin_select
  ON role_permissions_projection
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM roles_projection r
      WHERE r.id = role_permissions_projection.role_id
        AND r.organization_id IS NOT NULL
        AND is_org_admin(get_current_user_id(), r.organization_id)
    )
  );

-- All authenticated users can view permissions for global roles
DROP POLICY IF EXISTS role_permissions_global_select ON role_permissions_projection;
CREATE POLICY role_permissions_global_select
  ON role_permissions_projection
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM roles_projection r
      WHERE r.id = role_permissions_projection.role_id
        AND r.organization_id IS NULL
    )
    AND get_current_user_id() IS NOT NULL
  );

COMMENT ON POLICY role_permissions_super_admin_all ON role_permissions_projection IS
  'Allows super admins full access to all role-permission grants';
COMMENT ON POLICY role_permissions_org_admin_select ON role_permissions_projection IS
  'Allows organization admins to view permissions for roles in their organization';
COMMENT ON POLICY role_permissions_global_select ON role_permissions_projection IS
  'Allows authenticated users to view permissions for global roles';


-- ============================================================================
-- User Roles Projection
-- ============================================================================

-- Super admins can view all user-role assignments
DROP POLICY IF EXISTS user_roles_super_admin_all ON user_roles_projection;
CREATE POLICY user_roles_super_admin_all
  ON user_roles_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view user-role assignments in their organization
DROP POLICY IF EXISTS user_roles_org_admin_select ON user_roles_projection;
CREATE POLICY user_roles_org_admin_select
  ON user_roles_projection
  FOR SELECT
  USING (
    org_id IS NOT NULL
    AND is_org_admin(get_current_user_id(), org_id)
  );

-- Users can view their own role assignments
DROP POLICY IF EXISTS user_roles_own_select ON user_roles_projection;
CREATE POLICY user_roles_own_select
  ON user_roles_projection
  FOR SELECT
  USING (user_id = get_current_user_id());

COMMENT ON POLICY user_roles_super_admin_all ON user_roles_projection IS
  'Allows super admins full access to all user-role assignments';
COMMENT ON POLICY user_roles_org_admin_select ON user_roles_projection IS
  'Allows organization admins to view role assignments in their organization';
COMMENT ON POLICY user_roles_own_select ON user_roles_projection IS
  'Allows users to view their own role assignments';


-- ============================================================================
-- Domain Events
-- ============================================================================

-- Super admins can view all domain events (audit trail)
DROP POLICY IF EXISTS domain_events_super_admin_all ON domain_events;
CREATE POLICY domain_events_super_admin_all
  ON domain_events
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view events for their organization
-- (This requires event_metadata to contain org_id - we'll implement this later)
-- For now, restrict to super_admin only for security

COMMENT ON POLICY domain_events_super_admin_all ON domain_events IS
  'Allows super admins full access to domain events for auditing';


-- ============================================================================
-- Event Types
-- ============================================================================

-- Super admins can manage event type definitions
DROP POLICY IF EXISTS event_types_super_admin_all ON event_types;
CREATE POLICY event_types_super_admin_all
  ON event_types
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- All authenticated users can view event type definitions (reference data)
DROP POLICY IF EXISTS event_types_authenticated_select ON event_types;
CREATE POLICY event_types_authenticated_select
  ON event_types
  FOR SELECT
  USING (get_current_user_id() IS NOT NULL);

COMMENT ON POLICY event_types_super_admin_all ON event_types IS
  'Allows super admins full access to event type definitions';
COMMENT ON POLICY event_types_authenticated_select ON event_types IS
  'Allows authenticated users to view event type definitions';


-- ============================================================================
-- Phase 1: Enable RLS on Tables with Existing Policies
-- ============================================================================
-- These tables have policies defined but RLS was not enabled, meaning
-- the policies were not being enforced. This fixes security advisor issue 0007.

ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_business_profiles_projection ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- Invitations Projection
-- ============================================================================

-- Super admins can view all invitations
DROP POLICY IF EXISTS invitations_super_admin_all ON invitations_projection;
CREATE POLICY invitations_super_admin_all
  ON invitations_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view their organization's invitations
DROP POLICY IF EXISTS invitations_org_admin_select ON invitations_projection;
CREATE POLICY invitations_org_admin_select
  ON invitations_projection
  FOR SELECT
  USING (is_org_admin(get_current_user_id(), organization_id));

-- Users can view their own invitation by email
DROP POLICY IF EXISTS invitations_user_own_select ON invitations_projection;
CREATE POLICY invitations_user_own_select
  ON invitations_projection
  FOR SELECT
  USING (email = (current_setting('request.jwt.claims', true)::json->>'email'));

COMMENT ON POLICY invitations_super_admin_all ON invitations_projection IS
  'Allows super admins full access to all invitations';
COMMENT ON POLICY invitations_org_admin_select ON invitations_projection IS
  'Allows organization admins to view invitations for their organization';
COMMENT ON POLICY invitations_user_own_select ON invitations_projection IS
  'Allows users to view their own invitation by email address';


-- ============================================================================
-- Audit Log
-- ============================================================================

-- Super admins can view all audit log entries
DROP POLICY IF EXISTS audit_log_super_admin_all ON audit_log;
CREATE POLICY audit_log_super_admin_all
  ON audit_log
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view their organization's audit entries
DROP POLICY IF EXISTS audit_log_org_admin_select ON audit_log;
CREATE POLICY audit_log_org_admin_select
  ON audit_log
  FOR SELECT
  USING (
    organization_id IS NOT NULL
    AND is_org_admin(get_current_user_id(), organization_id)
  );

COMMENT ON POLICY audit_log_super_admin_all ON audit_log IS
  'Allows super admins full access to all audit log entries';
COMMENT ON POLICY audit_log_org_admin_select ON audit_log IS
  'Allows organization admins to view audit entries for their organization';


-- ============================================================================
-- API Audit Log
-- ============================================================================

-- Super admins can view all API audit log entries
DROP POLICY IF EXISTS api_audit_log_super_admin_all ON api_audit_log;
CREATE POLICY api_audit_log_super_admin_all
  ON api_audit_log
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view their organization's API audit entries
DROP POLICY IF EXISTS api_audit_log_org_admin_select ON api_audit_log;
CREATE POLICY api_audit_log_org_admin_select
  ON api_audit_log
  FOR SELECT
  USING (
    organization_id IS NOT NULL
    AND is_org_admin(get_current_user_id(), organization_id)
  );

COMMENT ON POLICY api_audit_log_super_admin_all ON api_audit_log IS
  'Allows super admins full access to all API audit log entries';
COMMENT ON POLICY api_audit_log_org_admin_select ON api_audit_log IS
  'Allows organization admins to view API audit entries for their organization';


-- ============================================================================
-- Cross-Tenant Access Grants Projection
-- ============================================================================

-- Super admins can view all cross-tenant access grants
DROP POLICY IF EXISTS cross_tenant_grants_super_admin_all ON cross_tenant_access_grants_projection;
CREATE POLICY cross_tenant_grants_super_admin_all
  ON cross_tenant_access_grants_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view grants where their org is either the consultant or provider
DROP POLICY IF EXISTS cross_tenant_grants_org_admin_select ON cross_tenant_access_grants_projection;
CREATE POLICY cross_tenant_grants_org_admin_select
  ON cross_tenant_access_grants_projection
  FOR SELECT
  USING (
    is_org_admin(get_current_user_id(), consultant_org_id)
    OR is_org_admin(get_current_user_id(), provider_org_id)
  );

COMMENT ON POLICY cross_tenant_grants_super_admin_all ON cross_tenant_access_grants_projection IS
  'Allows super admins full access to all cross-tenant access grants';
COMMENT ON POLICY cross_tenant_grants_org_admin_select ON cross_tenant_access_grants_projection IS
  'Allows organization admins to view grants where their organization is consultant or provider';
