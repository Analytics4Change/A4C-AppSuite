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
    org_id IS NOT NULL
    AND is_org_admin(get_current_user_id(), org_id)
  );

-- All authenticated users can view global roles (templates like provider_admin, partner_admin)
DROP POLICY IF EXISTS roles_global_select ON roles_projection;
CREATE POLICY roles_global_select
  ON roles_projection
  FOR SELECT
  USING (
    org_id IS NULL
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
        AND r.org_id IS NOT NULL
        AND is_org_admin(get_current_user_id(), r.org_id)
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
        AND r.org_id IS NULL
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
-- Zitadel User Mapping
-- ============================================================================

-- Super admins can view all user mappings
DROP POLICY IF EXISTS zitadel_user_mapping_super_admin_all ON zitadel_user_mapping;
CREATE POLICY zitadel_user_mapping_super_admin_all
  ON zitadel_user_mapping
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Users can view their own Zitadel mapping
DROP POLICY IF EXISTS zitadel_user_mapping_own_select ON zitadel_user_mapping;
CREATE POLICY zitadel_user_mapping_own_select
  ON zitadel_user_mapping
  FOR SELECT
  USING (internal_user_id = get_current_user_id());

COMMENT ON POLICY zitadel_user_mapping_super_admin_all ON zitadel_user_mapping IS
  'Allows super admins full access to all Zitadel user mappings';
COMMENT ON POLICY zitadel_user_mapping_own_select ON zitadel_user_mapping IS
  'Allows users to view their own Zitadel ID mapping';


-- ============================================================================
-- Zitadel Organization Mapping
-- ============================================================================

-- Super admins can view all organization mappings
DROP POLICY IF EXISTS zitadel_org_mapping_super_admin_all ON zitadel_organization_mapping;
CREATE POLICY zitadel_org_mapping_super_admin_all
  ON zitadel_organization_mapping
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view their own organization's Zitadel mapping
DROP POLICY IF EXISTS zitadel_org_mapping_org_admin_select ON zitadel_organization_mapping;
CREATE POLICY zitadel_org_mapping_org_admin_select
  ON zitadel_organization_mapping
  FOR SELECT
  USING (is_org_admin(get_current_user_id(), internal_org_id));

COMMENT ON POLICY zitadel_org_mapping_super_admin_all ON zitadel_organization_mapping IS
  'Allows super admins full access to all Zitadel organization mappings';
COMMENT ON POLICY zitadel_org_mapping_org_admin_select ON zitadel_organization_mapping IS
  'Allows organization admins to view their own Zitadel organization mapping';


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
