# JWT Custom Claims Setup Guide

**Purpose**: Configure Supabase Auth to enrich JWT tokens with custom claims for RBAC and multi-tenant isolation.

**Status**: Ready for deployment
**Last Updated**: 2025-10-27

---

## Overview

This guide walks through deploying the JWT custom claims hook that adds:
- `org_id`: Organization UUID for multi-tenant RLS
- `user_role`: User's primary role (super_admin, provider_admin, etc.)
- `permissions`: Array of permission strings for RBAC
- `scope_path`: Hierarchical organization scope (ltree)

---

## Prerequisites

1. **Supabase Project**: Active project with database access
2. **Database Functions**: Authentication helper functions deployed
3. **User Data**: Users table with organization mappings
4. **RBAC Schema**: Roles, permissions, and user_roles tables populated

---

## Step 1: Deploy SQL Functions

### Option A: Via Supabase Studio SQL Editor

1. Navigate to **SQL Editor** in Supabase Dashboard
2. Create new query
3. Copy contents of `/infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql`
4. Execute query
5. Verify functions created:
   - `auth.custom_access_token_hook`
   - `public.switch_organization`
   - `public.get_user_claims_preview`

### Option B: Via psql CLI

```bash
cd infrastructure/supabase

# Deploy JWT hook functions
psql -f sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql

# Deploy updated authentication helpers
psql -f sql/03-functions/authorization/002-authentication-helpers.sql
```

---

## Step 2: Configure Auth Hook in Supabase Dashboard

### Enable Custom Access Token Hook

1. Navigate to **Authentication > Hooks** in Supabase Dashboard
2. Select **Custom Access Token Hook**
3. Enable the hook
4. **Schema**: `auth`
5. **Hook Name**: `custom_access_token_hook`
6. **HTTP Hook URL**: Leave blank (using database function)
7. Click **Save**

### Verification

The hook configuration should show:
```
Hook Type: Custom Access Token
Schema: auth
Function: custom_access_token_hook
Status: Enabled
```

---

## Step 3: Test JWT Claims

### Test 1: Preview Claims for User

```sql
-- Test Lars Tice's claims
SELECT public.get_user_claims_preview('your-user-uuid');

-- Expected output:
{
  "org_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "user_role": "super_admin",
  "permissions": [
    "organization.create_root",
    "organization.view",
    "role.create",
    "user.create",
    ...
  ],
  "scope_path": null,
  "claims_version": 1
}
```

### Test 2: Authenticate and Inspect JWT

Using the frontend application:

```typescript
// Login with Supabase Auth
const { data: { session } } = await supabase.auth.signInWithPassword({
  email: 'lars.tice@gmail.com',
  password: 'your-password'
});

// Decode JWT to verify custom claims
const payload = JSON.parse(atob(session.access_token.split('.')[1]));
console.log('Custom Claims:', {
  org_id: payload.org_id,
  user_role: payload.user_role,
  permissions: payload.permissions,
  scope_path: payload.scope_path
});
```

### Test 3: RLS Policy Enforcement

```sql
-- Set up test user context
SET app.current_user = 'your-user-uuid';

-- Test org_id extraction
SELECT get_current_org_id();  -- Should return user's org UUID

-- Test role extraction
SELECT get_current_user_role();  -- Should return 'super_admin' or role name

-- Test permissions extraction
SELECT get_current_permissions();  -- Should return array of permissions

-- Test permission check
SELECT has_permission('organization.view');  -- Should return true/false
```

### Test 4: Switch Organization Context

```sql
-- Switch to different organization (must have access)
SELECT public.switch_organization('different-org-uuid');

-- Frontend should refresh JWT after switch
-- New JWT will contain updated org_id and permissions
```

---

## Step 4: Update Users Table

Ensure users have organization context:

```sql
-- Check users without organization context
SELECT id, email, current_organization_id
FROM users
WHERE current_organization_id IS NULL;

-- Set default organization for users (if needed)
UPDATE users
SET current_organization_id = (
  SELECT ur.org_id
  FROM user_roles_projection ur
  WHERE ur.user_id = users.id
  LIMIT 1
)
WHERE current_organization_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    WHERE ur.user_id = users.id
  );
```

---

## Step 5: Verify RLS Policies Work with JWT Claims

### Test Organization Isolation

```sql
-- Create test data in different organizations
-- User should only see data for their org_id

-- As user in org A
SET app.current_user = 'user-a-uuid';
SELECT * FROM clients;  -- Should only return clients in org A

-- As user in org B
SET app.current_user = 'user-b-uuid';
SELECT * FROM clients;  -- Should only return clients in org B

-- As super_admin
SET app.current_user = 'super-admin-uuid';
SELECT * FROM clients;  -- Should return ALL clients (bypasses RLS)
```

### Test Permission-Based Access

```sql
-- User without 'client.create' permission
SET app.current_user = 'viewer-user-uuid';
INSERT INTO clients (name, organization_id) VALUES ('Test', 'some-org-uuid');
-- Should FAIL with permission denied

-- User with 'client.create' permission
SET app.current_user = 'admin-user-uuid';
INSERT INTO clients (name, organization_id) VALUES ('Test', 'some-org-uuid');
-- Should SUCCEED
```

---

## Step 6: Frontend Integration

### Update Frontend Auth Configuration

The frontend is already configured to use Supabase Auth with custom claims.

**Environment Variables** (`.env.development.integration` or `.env.production`):

```bash
VITE_AUTH_PROVIDER=supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Access Custom Claims in Frontend

```typescript
import { useAuth } from '@/contexts/AuthContext';

const MyComponent = () => {
  const { session } = useAuth();

  // Custom claims are available in session.claims
  const orgId = session?.claims.org_id;
  const role = session?.claims.user_role;
  const permissions = session?.claims.permissions;
  const scopePath = session?.claims.scope_path;

  return (
    <div>
      <p>Organization: {orgId}</p>
      <p>Role: {role}</p>
      <p>Permissions: {permissions.length}</p>
    </div>
  );
};
```

### Switch Organization in Frontend

```typescript
import { supabase } from '@/services/supabase';

const switchOrg = async (newOrgId: string) => {
  // Call database function
  const { data, error } = await supabase.rpc('switch_organization', {
    p_new_org_id: newOrgId
  });

  if (error) throw error;

  // Refresh session to get new JWT with updated claims
  const { data: { session } } = await supabase.auth.refreshSession();

  // New session will have updated org_id in claims
  console.log('New org_id:', session?.claims.org_id);
};
```

---

## Troubleshooting

### Issue: JWT Claims Not Appearing

**Check hook is enabled**:
```sql
SELECT * FROM pg_catalog.pg_proc
WHERE proname = 'custom_access_token_hook'
  AND pronamespace = 'auth'::regnamespace;
```

**Verify hook execution**:
- Login via frontend
- Check PostgreSQL logs for warnings
- JWT hook errors are logged but don't block authentication

### Issue: Permission Denied on RLS Queries

**Check user has claims**:
```sql
-- Preview what JWT hook would return
SELECT public.get_user_claims_preview('user-uuid');
```

**Verify RLS policies exist**:
```sql
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

### Issue: Hook Returns Empty Permissions

**Check user has roles assigned**:
```sql
SELECT ur.*, r.name as role_name
FROM user_roles_projection ur
JOIN roles_projection r ON r.id = ur.role_id
WHERE ur.user_id = 'user-uuid';
```

**Check roles have permissions**:
```sql
SELECT r.name, p.name as permission_name
FROM role_permissions_projection rp
JOIN roles_projection r ON r.id = rp.role_id
JOIN permissions_projection p ON p.id = rp.permission_id
WHERE r.name = 'provider_admin';
```

### Issue: Organization Switch Doesn't Update JWT

**Frontend must refresh session after switch**:
```typescript
// After calling switch_organization RPC
const { data: { session } } = await supabase.auth.refreshSession();
```

**JWT tokens are immutable** - must refresh to get new claims.

---

## Performance Considerations

### JWT Hook Performance

The hook executes on every token generation:
- **Token refresh** (every hour by default)
- **Initial authentication**
- **Manual session refresh**

**Optimization**:
- Uses efficient queries with proper indexes
- Falls back gracefully on error (minimal claims)
- Cached at token level (not re-executed until refresh)

### RLS Policy Performance

Custom claims enable efficient RLS policies:

```sql
-- FAST - Uses JWT claim directly
CREATE POLICY org_isolation ON clients
USING (org_id = (auth.jwt()->>'org_id')::uuid);

-- SLOW - Requires database lookup
CREATE POLICY org_isolation_legacy ON clients
USING (org_id = get_user_org_from_database());
```

Always prefer JWT claims over database lookups in RLS policies.

---

## Rollback Procedure

If issues arise, disable the hook:

1. Navigate to **Authentication > Hooks** in Supabase Dashboard
2. Disable **Custom Access Token Hook**
3. Users will continue to authenticate but without custom claims
4. RLS policies using custom claims will DENY access (fail closed)

**Important**: Existing JWT tokens remain valid until expiry (1 hour). Disable hook doesn't invalidate active sessions.

---

## Next Steps

- [ ] Deploy JWT custom claims hook (this guide)
- [ ] Test custom claims in development
- [ ] Update RLS policies to use JWT claims directly
- [ ] Deploy to production
- [ ] Monitor PostgreSQL logs for hook errors
- [ ] Implement organization switching in frontend UI

---

## Related Documentation

- **Frontend Auth Architecture**: `/frontend/docs/auth-provider-architecture.md`
- **RBAC Implementation**: `/.plans/rbac-permissions/implementation-guide.md`
- **Supabase Auth Hooks**: https://supabase.com/docs/guides/auth/auth-hooks
- **Row Level Security**: `infrastructure/supabase/sql/06-rls/`

---

**Document Version**: 1.0
**Migration Status**: Backend JWT Hook Implementation
**Next Phase**: RLS Policy Migration to JWT Claims
