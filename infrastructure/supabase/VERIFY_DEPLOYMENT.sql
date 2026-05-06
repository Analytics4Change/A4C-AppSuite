-- ============================================================================
-- DEPLOYMENT VERIFICATION QUERIES
-- ============================================================================
-- Execute these queries after running DEPLOY_TO_SUPABASE_STUDIO.sql
-- to verify the minimal bootstrap deployment was successful

-- ============================================================================
-- 1. Verify Organizations
-- ============================================================================

SELECT 'Organizations' as section, COUNT(*) as count FROM organizations_projection;
-- Expected: 1 (Analytics4Change)

SELECT
  id,
  name,
  slug,
  type,
  path,
  is_active,
  created_at
FROM organizations_projection
ORDER BY created_at;


-- ============================================================================
-- 2. Verify Roles
-- ============================================================================

SELECT 'Roles' as section, COUNT(*) as count FROM roles_projection;
-- Expected: 3 (super_admin, provider_admin, partner_admin)

SELECT
  id,
  name,
  description,
  organization_id,
  is_active,
  created_at
FROM roles_projection
ORDER BY name;


-- ============================================================================
-- 3. Verify Permissions
-- ============================================================================

SELECT 'Permissions' as section, COUNT(*) as count FROM permissions_projection;
-- Expected: 22

SELECT
  applet,
  COUNT(*) as permission_count
FROM permissions_projection
GROUP BY applet
ORDER BY applet;
-- Expected: organization (8), role (5), permission (3), user (6)

SELECT
  id,
  applet || '.' || action as permission_name,
  description,
  scope_type,
  requires_mfa
FROM permissions_projection
ORDER BY applet, action;


-- ============================================================================
-- 4. Verify Permission Grants to Super Admin
-- ============================================================================

SELECT 'Super Admin Permissions' as section, COUNT(*) as count
FROM role_permissions_projection
WHERE role_id = '11111111-1111-1111-1111-111111111111';
-- Expected: 22

SELECT
  p.applet || '.' || p.action as permission_name,
  p.description,
  rp.granted_at
FROM role_permissions_projection rp
JOIN permissions_projection p ON p.id = rp.permission_id
WHERE rp.role_id = '11111111-1111-1111-1111-111111111111'
ORDER BY p.applet, p.action;


-- ============================================================================
-- 5. Verify Users
-- ============================================================================

SELECT 'Users' as section, COUNT(*) as count FROM users;
-- Expected: 1 (Lars Tice)

SELECT
  u.id,
  u.email,
  u.name,
  u.is_active,
  u.created_at
FROM users u
ORDER BY u.created_at;


-- ============================================================================
-- 6. Verify User Role Assignments
-- ============================================================================

SELECT 'User Role Assignments' as section, COUNT(*) as count
FROM user_roles_projection;
-- Expected: 1 (Lars → super_admin)

SELECT
  u.email,
  u.name,
  r.name as role_name,
  o.name as organization_name,
  ur.assigned_at
FROM user_roles_projection ur
JOIN users u ON u.id = ur.user_id
JOIN roles_projection r ON r.id = ur.role_id
LEFT JOIN organizations_projection o ON o.id = ur.org_id
ORDER BY ur.assigned_at;


-- ============================================================================
-- 7. Verify Event Store
-- ============================================================================

SELECT 'Domain Events' as section, COUNT(*) as total_events
FROM domain_events;
-- Expected: ~50+ events (permissions, roles, org, user, grants)

SELECT
  stream_type,
  event_type,
  COUNT(*) as event_count
FROM domain_events
GROUP BY stream_type, event_type
ORDER BY stream_type, event_type;


-- ============================================================================
-- VERIFICATION SUMMARY
-- ============================================================================

SELECT
  'Deployment Verification Summary' as section,
  (SELECT COUNT(*) FROM organizations_projection) as organizations,
  (SELECT COUNT(*) FROM roles_projection) as roles,
  (SELECT COUNT(*) FROM permissions_projection) as permissions,
  (SELECT COUNT(*) FROM role_permissions_projection WHERE role_id = '11111111-1111-1111-1111-111111111111') as super_admin_permissions,
  (SELECT COUNT(*) FROM users) as users,
  (SELECT COUNT(*) FROM user_roles_projection) as user_role_assignments,
  (SELECT COUNT(*) FROM domain_events) as total_events;

-- Expected output:
-- organizations: 1
-- roles: 3
-- permissions: 22
-- super_admin_permissions: 22
-- users: 1
-- user_role_assignments: 1
-- total_events: 50+
