-- ============================================================================
-- JWT Custom Access Token Hook - Complete Verification Script
-- ============================================================================
-- Purpose: Diagnose OAuth "No session found" errors by verifying JWT hook
--          configuration, user data, and permissions
--
-- Usage:
--   1. Run via Supabase SQL Editor or psql
--   2. Review each result set sequentially
--   3. Look for ❌ indicators showing issues
--   4. All checks should show ✅ for hook to work properly
--
-- Expected: 10 result sets, all showing healthy configuration
-- ============================================================================

\echo '===================================================================================='
\echo 'PHASE 1: JWT HOOK SCHEMA AND REGISTRATION VERIFICATION'
\echo '===================================================================================='

-- Check 1: Verify JWT hook function exists and which schema it's in
\echo ''
\echo '✓ Check 1: JWT Hook Function Schema Location'
\echo '   Expected: Should be in PUBLIC schema (not auth schema)'
\echo '   Critical: Supabase Auth can only call hooks in public schema'
\echo ''

SELECT
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  CASE
    WHEN n.nspname = 'public' THEN '✅ CORRECT - Function in public schema'
    WHEN n.nspname = 'auth' THEN '❌ WRONG - Function in auth schema (Supabase Auth cannot call this!)'
    ELSE '❌ WRONG - Function in unexpected schema'
  END as status
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'custom_access_token_hook'
ORDER BY n.nspname;

-- Check 2: Verify supabase_auth_admin has EXECUTE permission on the hook
\echo ''
\echo '✓ Check 2: supabase_auth_admin EXECUTE Permission'
\echo '   Expected: true'
\echo '   Critical: Without this permission, hook cannot be called during OAuth'
\echo ''

SELECT
  has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'EXECUTE') as has_execute_permission,
  CASE
    WHEN has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'EXECUTE')
    THEN '✅ Permission granted'
    ELSE '❌ Permission missing - run GRANT EXECUTE statement'
  END as status;

\echo ''
\echo '===================================================================================='
\echo 'PHASE 2: USER DATA VERIFICATION'
\echo '===================================================================================='

-- Check 3: Verify user exists in auth.users (Supabase Auth)
\echo ''
\echo '✓ Check 3: User Exists in auth.users (Supabase Auth)'
\echo '   Expected: 1 row with your OAuth user'
\echo '   Critical: This is created automatically during OAuth login'
\echo ''

SELECT
  id,
  email,
  created_at,
  last_sign_in_at,
  '✅ User exists in auth.users' as status
FROM auth.users
WHERE email = 'lars.tice@gmail.com'
LIMIT 1;

-- Check 4: Verify user exists in public.users (Application Database)
\echo ''
\echo '✓ Check 4: User Exists in public.users (Application Database)'
\echo '   Expected: 1 row matching auth.users id'
\echo '   Critical: JWT hook queries this table - if missing, hook fails'
\echo ''

SELECT
  u.id,
  u.email,
  u.current_organization_id as org_id,
  CASE
    WHEN u.current_organization_id IS NOT NULL THEN '✅ User has organization assigned'
    ELSE '❌ User missing organization_id (may cause RLS issues)'
  END as org_status,
  '✅ User exists in public.users' as status
FROM users u
WHERE u.email = 'lars.tice@gmail.com'
LIMIT 1;

-- Check 5: Verify user role assignments
\echo ''
\echo '✓ Check 5: User Role Assignments'
\echo '   Expected: At least 1 role (preferably super_admin for testing)'
\echo '   Critical: Hook uses this to populate user_role claim'
\echo ''

SELECT
  ur.user_id,
  r.name as role_name,
  ur.org_id,
  ur.assigned_at,
  CASE
    WHEN r.name = 'super_admin' THEN '✅ Super admin role assigned'
    WHEN r.name IN ('provider_admin', 'partner_admin') THEN '✅ Admin role assigned'
    ELSE '⚠️  Non-admin role (may have limited permissions)'
  END as status
FROM user_roles_projection ur
JOIN roles_projection r ON r.id = ur.role_id
WHERE ur.user_id = (SELECT id FROM auth.users WHERE email = 'lars.tice@gmail.com')
ORDER BY
  CASE
    WHEN r.name = 'super_admin' THEN 1
    WHEN r.name = 'provider_admin' THEN 2
    ELSE 3
  END;

\echo ''
\echo '===================================================================================='
\echo 'PHASE 3: PERMISSION VERIFICATION FOR JWT HOOK'
\echo '===================================================================================='

-- Check 6: Verify supabase_auth_admin has SELECT on all required tables
\echo ''
\echo '✓ Check 6: Table Permissions for supabase_auth_admin'
\echo '   Expected: All tables show "true"'
\echo '   Critical: Hook needs to read these tables to build JWT claims'
\echo ''

SELECT
  'users' as table_name,
  has_table_privilege('supabase_auth_admin', 'public.users', 'SELECT') as has_select,
  CASE
    WHEN has_table_privilege('supabase_auth_admin', 'public.users', 'SELECT')
    THEN '✅ Permission granted'
    ELSE '❌ Permission missing'
  END as status
UNION ALL
SELECT
  'user_roles_projection',
  has_table_privilege('supabase_auth_admin', 'public.user_roles_projection', 'SELECT'),
  CASE
    WHEN has_table_privilege('supabase_auth_admin', 'public.user_roles_projection', 'SELECT')
    THEN '✅ Permission granted'
    ELSE '❌ Permission missing'
  END
UNION ALL
SELECT
  'roles_projection',
  has_table_privilege('supabase_auth_admin', 'public.roles_projection', 'SELECT'),
  CASE
    WHEN has_table_privilege('supabase_auth_admin', 'public.roles_projection', 'SELECT')
    THEN '✅ Permission granted'
    ELSE '❌ Permission missing'
  END
UNION ALL
SELECT
  'organizations_projection',
  has_table_privilege('supabase_auth_admin', 'public.organizations_projection', 'SELECT'),
  CASE
    WHEN has_table_privilege('supabase_auth_admin', 'public.organizations_projection', 'SELECT')
    THEN '✅ Permission granted'
    ELSE '❌ Permission missing'
  END
UNION ALL
SELECT
  'permissions_projection',
  has_table_privilege('supabase_auth_admin', 'public.permissions_projection', 'SELECT'),
  CASE
    WHEN has_table_privilege('supabase_auth_admin', 'public.permissions_projection', 'SELECT')
    THEN '✅ Permission granted'
    ELSE '❌ Permission missing'
  END
UNION ALL
SELECT
  'role_permissions_projection',
  has_table_privilege('supabase_auth_admin', 'public.role_permissions_projection', 'SELECT'),
  CASE
    WHEN has_table_privilege('supabase_auth_admin', 'public.role_permissions_projection', 'SELECT')
    THEN '✅ Permission granted'
    ELSE '❌ Permission missing'
  END;

\echo ''
\echo '===================================================================================='
\echo 'PHASE 4: JWT CLAIMS SIMULATION (Manual Test of Hook Logic)'
\echo '===================================================================================='

-- Check 7: Simulate what JWT claims the hook would generate
\echo ''
\echo '✓ Check 7: Simulated JWT Claims Output'
\echo '   Expected: Complete claims structure with org_id, user_role, permissions'
\echo '   Critical: This shows what the hook SHOULD return if working correctly'
\echo ''

SELECT
  u.id as user_id,
  u.email,
  u.current_organization_id as org_id,
  COALESCE(
    (SELECT r.name
     FROM user_roles_projection ur
     JOIN roles_projection r ON r.id = ur.role_id
     WHERE ur.user_id = u.id
     ORDER BY
       CASE
         WHEN r.name = 'super_admin' THEN 1
         WHEN r.name = 'provider_admin' THEN 2
         WHEN r.name = 'partner_admin' THEN 3
         WHEN r.name = 'clinician' THEN 4
         ELSE 5
       END
     LIMIT 1),
    'viewer'
  ) as user_role,
  (SELECT array_agg(DISTINCT p.name)
   FROM user_roles_projection ur
   JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
   JOIN permissions_projection p ON p.id = rp.permission_id
   WHERE ur.user_id = u.id
  ) as permissions,
  (SELECT o.scope_path::text
   FROM organizations_projection o
   WHERE o.org_id = u.current_organization_id
  ) as scope_path,
  1 as claims_version,
  '✅ JWT claims structure complete' as status
FROM users u
WHERE u.email = 'lars.tice@gmail.com';

\echo ''
\echo '===================================================================================='
\echo 'PHASE 5: ORGANIZATION DATA VERIFICATION'
\echo '===================================================================================='

-- Check 8: Verify organization exists and has scope_path
\echo ''
\echo '✓ Check 8: Organization Configuration'
\echo '   Expected: Organization with valid scope_path (ltree)'
\echo '   Note: scope_path used for hierarchical access control'
\echo ''

SELECT
  o.org_id,
  o.organization_name,
  o.scope_path::text,
  o.status,
  CASE
    WHEN o.scope_path IS NOT NULL THEN '✅ Organization has scope_path'
    ELSE '❌ Organization missing scope_path'
  END as status
FROM organizations_projection o
WHERE o.org_id = (SELECT current_organization_id FROM users WHERE email = 'lars.tice@gmail.com');

\echo ''
\echo '===================================================================================='
\echo 'PHASE 6: FINAL DIAGNOSTIC SUMMARY'
\echo '===================================================================================='

-- Check 9: Count of each critical record
\echo ''
\echo '✓ Check 9: Record Count Summary'
\echo '   Expected: All counts > 0'
\echo ''

SELECT
  'auth.users' as table_name,
  COUNT(*) as count,
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '❌' END as status
FROM auth.users
WHERE email = 'lars.tice@gmail.com'
UNION ALL
SELECT
  'public.users',
  COUNT(*),
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '❌' END
FROM users
WHERE email = 'lars.tice@gmail.com'
UNION ALL
SELECT
  'user_roles (for this user)',
  COUNT(*),
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '❌' END
FROM user_roles_projection
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'lars.tice@gmail.com')
UNION ALL
SELECT
  'permissions (for this user)',
  COUNT(DISTINCT p.id),
  CASE WHEN COUNT(DISTINCT p.id) > 0 THEN '✅' ELSE '❌' END
FROM user_roles_projection ur
JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
JOIN permissions_projection p ON p.id = rp.permission_id
WHERE ur.user_id = (SELECT id FROM auth.users WHERE email = 'lars.tice@gmail.com');

-- Check 10: Overall health check
\echo ''
\echo '✓ Check 10: Overall JWT Hook Health Status'
\echo ''

WITH health_checks AS (
  SELECT
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
           WHERE p.proname = 'custom_access_token_hook' AND n.nspname = 'public') as hook_in_public_schema,
    has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'EXECUTE') as hook_executable,
    EXISTS(SELECT 1 FROM auth.users WHERE email = 'lars.tice@gmail.com') as auth_user_exists,
    EXISTS(SELECT 1 FROM users WHERE email = 'lars.tice@gmail.com') as public_user_exists,
    EXISTS(SELECT 1 FROM user_roles_projection ur
           WHERE ur.user_id = (SELECT id FROM auth.users WHERE email = 'lars.tice@gmail.com')) as user_has_role
)
SELECT
  hook_in_public_schema,
  hook_executable,
  auth_user_exists,
  public_user_exists,
  user_has_role,
  CASE
    WHEN hook_in_public_schema AND hook_executable AND auth_user_exists AND public_user_exists AND user_has_role
    THEN '✅ ALL CHECKS PASSED - JWT Hook should work correctly'
    WHEN NOT hook_in_public_schema
    THEN '❌ CRITICAL: Hook in wrong schema - must be in public schema'
    WHEN NOT hook_executable
    THEN '❌ CRITICAL: Hook not executable by supabase_auth_admin'
    WHEN NOT public_user_exists
    THEN '❌ CRITICAL: User missing from public.users table'
    WHEN NOT user_has_role
    THEN '❌ WARNING: User has no role assignments'
    ELSE '❌ UNKNOWN ISSUE - review checks above'
  END as overall_status
FROM health_checks;

\echo ''
\echo '===================================================================================='
\echo 'VERIFICATION COMPLETE'
\echo '===================================================================================='
\echo ''
\echo 'NEXT STEPS:'
\echo '  1. Review all result sets above'
\echo '  2. Look for any ❌ indicators'
\echo '  3. If "Hook in wrong schema" error appears:'
\echo '     → Run migration to recreate hook in public schema'
\echo '  4. If "User missing from public.users" error appears:'
\echo '     → Run fix-user-role.sql script to sync user'
\echo '  5. After fixes, manually re-register hook in Supabase Dashboard:'
\echo '     → Go to: Authentication → Hooks → Custom Access Token'
\echo '     → Schema: public'
\echo '     → Function: custom_access_token_hook'
\echo '  6. Test OAuth login with cleared browser storage'
\echo ''
\echo '===================================================================================='
