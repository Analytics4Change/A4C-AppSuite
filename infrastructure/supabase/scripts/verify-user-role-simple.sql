-- Simple User Role Verification (returns result sets)

-- 1. Check if user exists in auth.users
SELECT '1. auth.users check' as check_name,
  CASE WHEN EXISTS (SELECT 1 FROM auth.users WHERE id = '5a975b95-a14d-4ddd-bdb6-949033dab0b8')
    THEN 'EXISTS' ELSE 'NOT FOUND' END as status;

-- 2. Check if user exists in public.users
SELECT '2. public.users check' as check_name,
  CASE WHEN EXISTS (SELECT 1 FROM users WHERE id = '5a975b95-a14d-4ddd-bdb6-949033dab0b8')
    THEN 'EXISTS' ELSE 'NOT FOUND' END as status;

-- 3. Show user details from public.users
SELECT '3. User details' as section, id, email, name, is_active, created_at
FROM users
WHERE id = '5a975b95-a14d-4ddd-bdb6-949033dab0b8';

-- 4. Show all available roles
SELECT '4. Available roles' as section, id, name
FROM roles_projection
ORDER BY name;

-- 5. Show user's role assignments
SELECT '5. User role assignments' as section,
  ur.user_id,
  ur.role_id,
  r.name as role_name,
  ur.org_id,
  ur.scope_path,
  ur.assigned_at
FROM user_roles_projection ur
LEFT JOIN roles_projection r ON r.id = ur.role_id
WHERE ur.user_id = '5a975b95-a14d-4ddd-bdb6-949033dab0b8';

-- 6. Show domain events for this user
SELECT '6. Domain events' as section,
  stream_version,
  event_type,
  event_data,
  created_at
FROM domain_events
WHERE stream_id = '5a975b95-a14d-4ddd-bdb6-949033dab0b8'
  AND stream_type = 'user'
ORDER BY stream_version;

-- 7. Test JWT claims preview (skip if function doesn't exist - Supabase Cloud only)
-- SELECT '7. JWT claims preview' as section,
--   public.get_user_claims_preview('5a975b95-a14d-4ddd-bdb6-949033dab0b8') as claims;

-- 7. Manual JWT claims simulation (what the hook SHOULD return)
SELECT '7. JWT claims simulation' as section,
  u.id as user_id,
  u.email,
  u.current_organization_id as org_id,
  COALESCE(
    (SELECT r.name
     FROM user_roles_projection ur
     JOIN roles_projection r ON r.id = ur.role_id
     WHERE ur.user_id = u.id
     ORDER BY CASE WHEN r.name = 'super_admin' THEN 1 ELSE 2 END
     LIMIT 1
    ),
    'viewer'
  ) as user_role,
  (
    SELECT array_agg(p.name)
    FROM user_roles_projection ur
    JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
    JOIN permissions_projection p ON p.id = rp.permission_id
    WHERE ur.user_id = u.id
  ) as permissions
FROM users u
WHERE u.id = '5a975b95-a14d-4ddd-bdb6-949033dab0b8';
