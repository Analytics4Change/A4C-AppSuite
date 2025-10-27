# Supabase Auth - Custom JWT Claims Setup

**Status**: ✅ Implementation Complete - Ready for Deployment
**Priority**: Critical - Must be implemented before production use
**Dependencies**: Organizations and user_roles projections must exist
**Implementation**: `infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql`
**Deployment Guide**: `infrastructure/supabase/JWT-CLAIMS-SETUP.md`

---

## Table of Contents

1. [Overview](#overview)
2. [Custom Claims Structure](#custom-claims-structure)
3. [Database Hook Implementation](#database-hook-implementation)
4. [Hook Registration](#hook-registration)
5. [Testing and Validation](#testing-and-validation)
6. [RLS Policy Examples](#rls-policy-examples)
7. [Security Considerations](#security-considerations)
8. [Troubleshooting](#troubleshooting)

---

## Overview

Supabase JWT tokens include standard claims (sub, email, role) but require custom claims for multi-tenant isolation and RBAC. Custom claims are added via a PostgreSQL database hook that runs during JWT generation.

**Why Custom Claims Are Critical**:
- 🔐 **Multi-tenant isolation**: `org_id` enforces tenant boundaries in RLS policies
- 🔐 **RBAC enforcement**: `permissions` array enables fine-grained access control
- 🔐 **Hierarchical scoping**: `scope_path` supports organizational hierarchies
- 🔐 **Role-based logic**: `user_role` enables role-specific UI/API behavior

**Security Model**:
- Custom claims are **server-side only** (never trust client input)
- RLS policies **must** use JWT claims, not request parameters
- Hook function runs with **SECURITY DEFINER** (elevated privileges)
- Any bug in the hook compromises multi-tenant isolation

---

## Custom Claims Structure

### Enhanced JWT Payload

After implementing the custom claims hook, Supabase JWTs will include:

```json
{
  // Standard Supabase claims
  "sub": "user-uuid",
  "email": "user@example.com",
  "email_verified": true,
  "role": "authenticated",
  "aal": "aal1",
  "session_id": "session-uuid",

  // Custom claims (added by hook)
  "org_id": "org-uuid",
  "user_role": "provider_admin",
  "permissions": ["medication.create", "client.view", "organization.manage"],
  "scope_path": "org_acme_healthcare",

  // Token metadata
  "iat": 1234567890,
  "exp": 1234571490
}
```

### Claims Definitions

| Claim | Type | Source | Purpose |
|-------|------|--------|---------|
| `org_id` | UUID | `user_roles_projection.org_id` | Primary tenant identifier for RLS |
| `user_role` | String | `user_roles_projection.role` | User's role within organization |
| `permissions` | String[] | `user_permissions_projection` | Fine-grained permission strings |
| `scope_path` | ltree | `organizations_projection.path` | Hierarchical scope for inheritance |

**Note**: These claims reflect the user's **active organization**. Users with multiple org memberships must switch context (triggers new JWT generation).

---

## Database Hook Implementation

### Step 1: Create Helper Function

First, create a helper function to query user permissions:

```sql
-- File: infrastructure/supabase/sql/03-functions/authorization/get_user_claims.sql

CREATE OR REPLACE FUNCTION auth.get_user_claims(user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  claims jsonb;
  user_org_id uuid;
  user_role text;
  user_permissions text[];
  org_scope_path ltree;
BEGIN
  -- Get user's active organization and role
  SELECT
    urp.org_id,
    urp.role
  INTO
    user_org_id,
    user_role
  FROM user_roles_projection urp
  WHERE urp.user_id = get_user_claims.user_id
    AND urp.is_active = true
  LIMIT 1;

  -- If no active organization, return empty claims
  IF user_org_id IS NULL THEN
    RETURN jsonb_build_object(
      'org_id', null,
      'user_role', null,
      'permissions', '[]'::jsonb,
      'scope_path', null
    );
  END IF;

  -- Get organization scope path
  SELECT op.path
  INTO org_scope_path
  FROM organizations_projection op
  WHERE op.org_id = user_org_id;

  -- Get user's effective permissions (aggregated from all sources)
  SELECT array_agg(DISTINCT upp.permission_name)
  INTO user_permissions
  FROM user_permissions_projection upp
  WHERE upp.user_id = get_user_claims.user_id
    AND upp.org_id = user_org_id
    AND upp.is_active = true;

  -- Build claims object
  claims := jsonb_build_object(
    'org_id', user_org_id,
    'user_role', user_role,
    'permissions', COALESCE(to_jsonb(user_permissions), '[]'::jsonb),
    'scope_path', org_scope_path::text
  );

  RETURN claims;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION auth.get_user_claims(uuid) TO authenticated;

COMMENT ON FUNCTION auth.get_user_claims IS
  'Retrieves custom JWT claims for a user based on their active organization membership and permissions';
```

### Step 2: Create Custom Access Token Hook

Create the main hook function that Supabase calls during JWT generation:

```sql
-- File: infrastructure/supabase/sql/03-functions/authorization/custom_access_token_hook.sql

CREATE OR REPLACE FUNCTION auth.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  claims jsonb;
  user_id uuid;
BEGIN
  -- Extract user ID from event
  user_id := (event->>'user_id')::uuid;

  -- Validate user_id exists
  IF user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required in event payload';
  END IF;

  -- Get custom claims
  claims := auth.get_user_claims(user_id);

  -- Merge custom claims into event claims
  event := jsonb_set(
    event,
    '{claims}',
    COALESCE(event->'claims', '{}'::jsonb) || claims
  );

  RETURN event;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't block authentication
    -- In production, consider logging to a monitoring table
    RAISE WARNING 'Failed to add custom claims for user %: %', user_id, SQLERRM;
    RETURN event;
END;
$$;

COMMENT ON FUNCTION auth.custom_access_token_hook IS
  'Supabase Auth hook that adds custom claims (org_id, permissions, role, scope_path) to JWT during token generation';
```

### Step 3: Deploy Functions

Deploy the SQL functions to your Supabase project:

```bash
# Option 1: Via Supabase CLI
supabase db push

# Option 2: Via Supabase Dashboard
# Copy SQL content and run in SQL Editor

# Option 3: Via migration (recommended)
# Add to infrastructure/supabase/sql/03-functions/authorization/
```

---

## Hook Registration

⚠️ **IMPORTANT DEPLOYMENT LIMITATION**: The JWT custom claims hook function CANNOT be created via SQL due to `auth` schema permission restrictions. You MUST use the Supabase Dashboard UI to create this function.

### Why SQL Deployment Fails

When attempting to create `auth.custom_access_token_hook` via SQL (e.g., `psql`, Supabase MCP, or SQL Editor), you will receive:

```
ERROR: 42501: permission denied for schema auth
```

**Reason**: The `auth` schema is protected by Supabase. Even with `service_role` credentials, direct SQL CREATE FUNCTION statements on the `auth` schema are blocked. This is a platform security feature, not a bug.

**Solution**: Use the Dashboard UI (Authentication > Hooks) which has elevated permissions to create functions in the `auth` schema.

### Via Supabase Dashboard (UI) ✅ REQUIRED METHOD

This is the **only supported method** for deploying the JWT hook function:

1. **Navigate to Hooks**
   - Supabase Dashboard → Authentication → Hooks

2. **Enable "Custom Access Token Hook"**
   - Click "Enable Hook" or toggle "Custom Access Token Hook"

3. **Paste Function Code**
   - The Dashboard provides a code editor
   - Copy the function code from `infrastructure/supabase/DEPLOY_TO_SUPABASE_STUDIO.sql` (lines 528-606)
   - Paste into the editor (excluding the `CREATE OR REPLACE FUNCTION` wrapper - Dashboard handles this)

4. **Save Configuration**
   - Dashboard automatically:
     - Creates the function in `auth` schema with `SECURITY DEFINER`
     - Registers the hook in `auth.hooks` table
     - Enables the hook for JWT generation

### Via Supabase CLI

⚠️ **Note**: CLI method may still require Dashboard access for initial hook creation.

Configure hooks in `supabase/config.toml`:

```toml
[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/auth/custom_access_token_hook"
```

Apply configuration:

```bash
supabase db push
```

### Deployment Script Reference

The `infrastructure/supabase/DEPLOY_TO_SUPABASE_STUDIO.sql` script includes the JWT hook function as a **comment block** (lines 517-609) with clear instructions:

```sql
-- ============================================================================
-- JWT CUSTOM CLAIMS HOOK (Must be enabled via Supabase Dashboard)
-- ============================================================================
-- NOTE: The custom_access_token_hook function CANNOT be created via SQL
-- due to auth schema permissions. You must create it via Dashboard:
--
-- 1. Go to: Authentication > Hooks > Custom Access Token Hook
-- 2. Click "Create a new hook" or "Enable"
-- 3. Paste the following function code in the editor:
-- ============================================================================
/*
CREATE OR REPLACE FUNCTION auth.custom_access_token_hook(event jsonb)
...
*/
```

This ensures the function code is version-controlled and documented, even though deployment requires manual Dashboard interaction.

---

## Testing and Validation

### Test 1: Verify Hook Function Exists

```sql
-- Check function exists
SELECT
  proname AS function_name,
  prosecdef AS security_definer,
  proargnames AS argument_names
FROM pg_proc
WHERE proname = 'custom_access_token_hook'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'auth');

-- Expected result:
-- function_name           | security_definer | argument_names
-- ------------------------+------------------+----------------
-- custom_access_token_hook| t                | {event}
```

### Test 2: Verify Hook Registration

```sql
-- Check hook is registered
SELECT
  hook_table_name,
  hook_name,
  created_at
FROM auth.hooks
WHERE hook_name = 'custom_access_token_hook';

-- Expected result:
-- hook_table_name | hook_name                | created_at
-- ----------------+--------------------------+---------------------------
-- auth            | custom_access_token_hook | 2025-10-24 12:34:56+00
```

### Test 3: Test Claims Generation

Create a test user and verify claims:

```sql
-- Create test user (if not exists)
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES (
  '550e8400-e29b-41d4-a716-446655440000'::uuid,
  'test@example.com',
  crypt('test-password', gen_salt('bf')),
  now(),
  now(),
  now()
)
ON CONFLICT (email) DO NOTHING;

-- Create test organization
INSERT INTO organizations_projection (org_id, name, path)
VALUES (
  '660e8400-e29b-41d4-a716-446655440000'::uuid,
  'Test Organization',
  'test_org'::ltree
)
ON CONFLICT (org_id) DO NOTHING;

-- Assign user to organization
INSERT INTO user_roles_projection (user_id, org_id, role, is_active)
VALUES (
  '550e8400-e29b-41d4-a716-446655440000'::uuid,
  '660e8400-e29b-41d4-a716-446655440000'::uuid,
  'provider_admin',
  true
)
ON CONFLICT (user_id, org_id) DO UPDATE SET is_active = true;

-- Test claims retrieval
SELECT auth.get_user_claims('550e8400-e29b-41d4-a716-446655440000'::uuid);

-- Expected result (jsonb):
-- {
--   "org_id": "660e8400-e29b-41d4-a716-446655440000",
--   "user_role": "provider_admin",
--   "permissions": ["medication.create", "client.view", ...],
--   "scope_path": "test_org"
-- }
```

### Test 4: Verify JWT Contains Custom Claims

**Frontend Test** (after hook is deployed):

```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
)

// Sign in
const { data: { session }, error } = await supabase.auth.signInWithPassword({
  email: 'test@example.com',
  password: 'test-password'
})

if (session) {
  // Decode JWT (Base64)
  const payload = JSON.parse(atob(session.access_token.split('.')[1]))

  console.log('Custom Claims:', {
    org_id: payload.org_id,
    user_role: payload.user_role,
    permissions: payload.permissions,
    scope_path: payload.scope_path
  })

  // Expected output:
  // Custom Claims: {
  //   org_id: "660e8400-e29b-41d4-a716-446655440000",
  //   user_role: "provider_admin",
  //   permissions: ["medication.create", "client.view", ...],
  //   scope_path: "test_org"
  // }
}
```

---

## RLS Policy Examples

Once custom claims are in the JWT, use them in RLS policies:

### Example 1: Basic Tenant Isolation

```sql
-- Ensure users only access their organization's data
CREATE POLICY "tenant_isolation"
ON clients
FOR ALL
TO authenticated
USING (
  org_id = (auth.jwt()->>'org_id')::uuid
);
```

### Example 2: Permission-Based Access

```sql
-- Only users with 'medication.create' permission can insert
CREATE POLICY "medication_create_permission"
ON medications
FOR INSERT
TO authenticated
WITH CHECK (
  'medication.create' = ANY(
    string_to_array(
      auth.jwt()->>'permissions',
      ','
    )
  )
);
```

### Example 3: Role-Based Access

```sql
-- Only provider admins can delete
CREATE POLICY "admin_delete_only"
ON clients
FOR DELETE
TO authenticated
USING (
  (auth.jwt()->>'user_role') IN ('provider_admin', 'super_admin')
);
```

### Example 4: Hierarchical Scope Access

```sql
-- Users can access their organization and all descendants
CREATE POLICY "hierarchical_org_access"
ON organizations_projection
FOR SELECT
TO authenticated
USING (
  -- User's scope encompasses this organization
  path <@ (auth.jwt()->>'scope_path')::ltree
  OR
  -- This organization encompasses user's scope (ancestors)
  (auth.jwt()->>'scope_path')::ltree <@ path
);
```

### Example 5: Combined Conditions

```sql
-- Complex policy: tenant + permission + role
CREATE POLICY "complex_access"
ON sensitive_data
FOR SELECT
TO authenticated
USING (
  -- Must be in same organization
  org_id = (auth.jwt()->>'org_id')::uuid
  AND (
    -- Either has specific permission
    'sensitive_data.view' = ANY(
      string_to_array(auth.jwt()->>'permissions', ',')
    )
    -- OR is an admin
    OR (auth.jwt()->>'user_role') = 'provider_admin'
  )
);
```

---

## Security Considerations

### Critical Security Rules

1. **Never Trust Client Input for Tenant ID**
   ```sql
   -- ❌ WRONG: Uses client-provided org_id
   CREATE POLICY "bad_policy"
   ON clients FOR SELECT
   USING (org_id = current_setting('request.jwt.claim.org_id', true)::uuid);

   -- ✅ CORRECT: Uses JWT claim from server
   CREATE POLICY "good_policy"
   ON clients FOR SELECT
   USING (org_id = (auth.jwt()->>'org_id')::uuid);
   ```

2. **Validate Hook Function Logic Thoroughly**
   - Test with users having no organization membership
   - Test with users having multiple organization memberships
   - Test with inactive/deleted organizations
   - Test with revoked permissions

3. **Monitor Hook Performance**
   - Hook runs on EVERY authentication
   - Slow queries impact user experience
   - Consider caching strategies for permissions (if query is slow)
   - Use indexes on `user_roles_projection` and `user_permissions_projection`

4. **Handle Hook Errors Gracefully**
   - Hook errors should NOT block authentication
   - Log errors for monitoring/debugging
   - Return safe defaults (no claims) rather than blocking login

5. **Audit Hook Changes**
   - Any change to hook function affects ALL users
   - Test in staging before deploying to production
   - Version control all hook SQL code
   - Document hook behavior in event log

### Required Database Indexes

Ensure these indexes exist for hook performance:

```sql
-- Indexes for user_roles_projection
CREATE INDEX IF NOT EXISTS idx_user_roles_user_active
  ON user_roles_projection(user_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_user_roles_org
  ON user_roles_projection(org_id);

-- Indexes for user_permissions_projection
CREATE INDEX IF NOT EXISTS idx_user_permissions_user_org
  ON user_permissions_projection(user_id, org_id) WHERE is_active = true;

-- Indexes for organizations_projection
CREATE INDEX IF NOT EXISTS idx_organizations_path
  ON organizations_projection USING gist(path);
```

---

## Troubleshooting

### Issue: Custom Claims Not Appearing in JWT

**Symptoms**: After signing in, JWT does not contain `org_id`, `permissions`, etc.

**Diagnosis**:
```sql
-- Check if hook is registered
SELECT * FROM auth.hooks WHERE hook_name = 'custom_access_token_hook';

-- Check if function exists
SELECT proname FROM pg_proc WHERE proname = 'custom_access_token_hook';

-- Test function directly
SELECT auth.custom_access_token_hook(
  jsonb_build_object(
    'user_id', 'your-user-uuid',
    'claims', '{}'::jsonb
  )
);
```

**Solutions**:
1. Re-register hook via dashboard or CLI
2. Verify function has `SECURITY DEFINER` attribute
3. Check Supabase logs for hook errors
4. Force new session (sign out + sign in) to regenerate JWT

---

### Issue: Hook Function Throws Errors

**Symptoms**: Authentication fails or returns generic errors

**Diagnosis**:
```sql
-- Check PostgreSQL logs
SELECT * FROM pg_stat_statements
WHERE query LIKE '%custom_access_token_hook%'
ORDER BY last_exec_time DESC LIMIT 10;

-- Test function with sample user
SELECT auth.get_user_claims('sample-user-uuid'::uuid);
```

**Solutions**:
1. Wrap hook logic in `BEGIN...EXCEPTION` block (shown in implementation above)
2. Add detailed logging via `RAISE WARNING`
3. Return event unchanged if error occurs (fail open for authentication)
4. Investigate missing projection data (organizations, roles, permissions)

---

### Issue: Performance Degradation

**Symptoms**: Slow authentication, login takes 3-5+ seconds

**Diagnosis**:
```sql
-- Check query execution time
EXPLAIN ANALYZE
SELECT auth.get_user_claims('sample-user-uuid'::uuid);

-- Check for missing indexes
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE tablename IN ('user_roles_projection', 'user_permissions_projection', 'organizations_projection');
```

**Solutions**:
1. Add recommended indexes (see Security Considerations section)
2. Optimize queries in `get_user_claims` function
3. Consider materialized view for permissions (if many permissions per user)
4. Cache claims in application session (don't re-fetch on every request)

---

### Issue: Claims Out of Sync with Database

**Symptoms**: User's permissions changed but JWT still has old permissions

**Diagnosis**: JWTs are **stateless** and have 1-hour expiration by default

**Solutions**:
1. Force session refresh: `supabase.auth.refreshSession()`
2. Reduce JWT expiration time (in Supabase Dashboard → Auth → Settings)
3. Implement active revocation via blocklist (if real-time revocation required)
4. Document to users: "Changes take effect after re-login"

---

### Issue: User Has Multiple Organizations

**Symptoms**: User belongs to multiple orgs, but JWT only shows one

**Explanation**: JWT can only contain **one active organization** at a time

**Solutions**:
1. Implement "organization switcher" UI
2. Store user's selected org_id in `user_roles_projection.is_active`
3. Update `is_active` when user switches orgs
4. Force token refresh after switching: `supabase.auth.refreshSession()`

**Example Organization Switcher**:
```typescript
async function switchOrganization(userId: string, newOrgId: string) {
  // Deactivate all organizations for user
  await supabase
    .from('user_roles_projection')
    .update({ is_active: false })
    .eq('user_id', userId)

  // Activate selected organization
  await supabase
    .from('user_roles_projection')
    .update({ is_active: true })
    .eq('user_id', userId)
    .eq('org_id', newOrgId)

  // Refresh session to get new JWT with updated org_id
  await supabase.auth.refreshSession()
}
```

---

## Testing Checklist

Before deploying to production:

- [ ] Hook function deployed and registered
- [ ] Test with user having no organization (returns empty claims gracefully)
- [ ] Test with user having one organization (correct org_id, role, permissions)
- [ ] Test with user having multiple organizations (only active org in claims)
- [ ] Test with user having no permissions (empty permissions array)
- [ ] Test RLS policies using JWT claims
- [ ] Verify JWT expiration and refresh works correctly
- [ ] Performance test: Hook execution time < 100ms
- [ ] All recommended indexes created
- [ ] Hook error handling logs warnings without blocking auth
- [ ] Documentation updated with hook SQL location and version

---

## Frontend Integration

### Accessing Custom Claims

The frontend automatically receives and decodes custom JWT claims through the auth provider:

```typescript
import { useAuth } from '@/contexts/AuthContext';

const MyComponent = () => {
  const { session } = useAuth();

  // Custom claims available in session.claims
  const orgId = session?.claims.org_id;
  const role = session?.claims.user_role;
  const permissions = session?.claims.permissions;
  const scopePath = session?.claims.scope_path;

  return (
    <div>
      <p>Organization: {orgId}</p>
      <p>Role: {role}</p>
      <p>Permissions: {permissions.join(', ')}</p>
    </div>
  );
};
```

### Organization Switching

Frontend triggers organization switch which refreshes JWT:

```typescript
const { switchOrganization } = useAuth();

// Updates database + refreshes JWT with new org_id
await switchOrganization('new-org-uuid');
```

See `frontend-auth-architecture.md` for complete frontend implementation details.

---

## Related Documentation

- **Supabase Auth Overview**: `.plans/supabase-auth-integration/overview.md`
- **Frontend Implementation**: `.plans/supabase-auth-integration/frontend-auth-architecture.md` ✅
- **Enterprise SSO**: `.plans/supabase-auth-integration/enterprise-sso-guide.md`
- **RLS Policies**: `infrastructure/supabase/sql/06-rls/`
- **RBAC Architecture**: `.plans/rbac-permissions/architecture.md`
- **User Projections**: `infrastructure/supabase/sql/02-tables/user_roles_projection/`

---

**Document Version**: 1.1
**Last Updated**: 2025-10-27
**Status**: Ready for Implementation (Frontend Complete)
