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

The JWT hook function is included in `infrastructure/supabase/DEPLOY_TO_SUPABASE_STUDIO.sql` (lines 516-619). The implementation:

```sql
-- File: infrastructure/supabase/DEPLOY_TO_SUPABASE_STUDIO.sql (lines 516-619)

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_user_id uuid;
  v_claims jsonb;
  v_org_id uuid;
  v_user_role text;
  v_permissions text[];
  v_scope_path text;
BEGIN
  v_user_id := (event->>'user_id')::uuid;

  -- Query user's organization and role
  SELECT
    u.current_organization_id,
    COALESCE(
      (SELECT r.name
       FROM user_roles_projection ur
       JOIN roles_projection r ON r.id = ur.role_id
       WHERE ur.user_id = u.id
       ORDER BY CASE WHEN r.name = 'super_admin' THEN 1 ELSE 2 END
       LIMIT 1
      ),
      'viewer'
    ),
    NULL
  INTO v_org_id, v_user_role, v_scope_path
  FROM users u
  WHERE u.id = v_user_id;

  -- Get permissions based on role
  IF v_user_role = 'super_admin' THEN
    SELECT array_agg(p.name)
    INTO v_permissions
    FROM permissions_projection p;
  ELSE
    SELECT array_agg(DISTINCT p.name)
    INTO v_permissions
    FROM user_roles_projection ur
    JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
    JOIN permissions_projection p ON p.id = rp.permission_id
    WHERE ur.user_id = v_user_id
      AND (ur.org_id = v_org_id OR ur.org_id IS NULL);
  END IF;

  v_permissions := COALESCE(v_permissions, ARRAY[]::text[]);

  -- Build custom claims
  v_claims := jsonb_build_object(
    'org_id', v_org_id,
    'user_role', v_user_role,
    'permissions', to_jsonb(v_permissions),
    'scope_path', v_scope_path,
    'claims_version', 1
  );

  -- Merge into event
  RETURN jsonb_set(
    event,
    '{claims}',
    (COALESCE(event->'claims', '{}'::jsonb) || v_claims)
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'JWT hook error: % %', SQLERRM, SQLSTATE;
    RETURN jsonb_set(
      event,
      '{claims}',
      jsonb_build_object(
        'org_id', NULL,
        'user_role', 'viewer',
        'permissions', '[]'::jsonb,
        'scope_path', NULL,
        'claims_error', SQLERRM
      )
    );
END;
$$;

-- Required permission grants
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT SELECT ON TABLE users TO supabase_auth_admin;
GRANT SELECT ON TABLE user_roles_projection TO supabase_auth_admin;
GRANT SELECT ON TABLE roles_projection TO supabase_auth_admin;
GRANT SELECT ON TABLE role_permissions_projection TO supabase_auth_admin;
GRANT SELECT ON TABLE permissions_projection TO supabase_auth_admin;
```

### Deployment

Deploy the function via SQL:

```bash
# Via Supabase MCP
# Or via SQL Editor in Dashboard
# Or via CLI: supabase db push
```

Then register the hook via Dashboard (Authentication > Hooks > Custom Access Token).

---

## Hook Registration

⚠️ **SCHEMA LOCATION UPDATE (2025)**: As of April 2025, Supabase restricts creating NEW functions in `auth`, `storage`, and `realtime` schemas. The JWT custom claims hook must be created in the **`public` schema** with permission grants to `supabase_auth_admin`.

### Official Deployment Pattern (Public Schema)

The hook function should be created in the `public` schema via SQL deployment:

```sql
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
...

-- Required permission grants
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT SELECT ON TABLE users TO supabase_auth_admin;
-- ... additional table grants
```

**Why Public Schema**: Supabase platform restrictions prevent creating new functions in protected schemas (`auth`, `storage`, `realtime`), but you CAN edit existing functions in those schemas. Creating the hook in `public` schema with proper grants is the recommended approach.

**After SQL Deployment**: The hook must still be registered via Dashboard (Authentication > Hooks) or CLI config to activate it for JWT generation.

### Step 1: Deploy Function via SQL

The function is already included in `infrastructure/supabase/DEPLOY_TO_SUPABASE_STUDIO.sql` (lines 516-619). Deploy it via:

```bash
# Via Supabase MCP
# Or via SQL Editor in Dashboard
# Or via CLI: supabase db push
```

The deployment script creates:
- Function: `public.custom_access_token_hook(event jsonb)`
- Permission grants to `supabase_auth_admin`
- Table access grants (SELECT on users, roles, permissions projections)

### Step 2: Register Hook via Dashboard

After SQL deployment, register the hook to activate it:

1. **Navigate to Hooks**
   - Supabase Dashboard → Authentication → Hooks

2. **Enable "Custom Access Token Hook"**
   - Click "Enable Hook" or toggle "Custom Access Token Hook"

3. **Configure Hook**
   - **Schema**: `public` (not `auth`)
   - **Function**: `custom_access_token_hook`
   - The function already exists from SQL deployment

4. **Save Configuration**
   - Dashboard registers the hook in internal configuration
   - Supabase Auth will now call this function during JWT generation

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

The `infrastructure/supabase/DEPLOY_TO_SUPABASE_STUDIO.sql` script includes the JWT hook function (lines 516-619):

```sql
-- ============================================================================
-- JWT CUSTOM CLAIMS HOOK
-- ============================================================================
-- Creates hook in PUBLIC schema (not auth schema due to 2025 restrictions)
-- Must be registered in Dashboard: Authentication > Hooks > Custom Access Token
-- Or via config.toml: [auth.hook.custom_access_token] enabled = true
-- ============================================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
...
$$;

-- Grant permissions to supabase_auth_admin (required for hook execution)
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
-- ... additional grants
```

The function is deployed via SQL and then registered via Dashboard or CLI configuration.

---

## Testing and Validation

### Test 1: Verify Hook Function Exists

```sql
-- Check function exists in public schema
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  p.prosecdef AS security_definer,
  p.proargnames AS argument_names
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'custom_access_token_hook'
  AND n.nspname = 'public';

-- Expected result:
-- schema_name | function_name           | security_definer | argument_names
-- ------------+-------------------------+------------------+----------------
-- public      | custom_access_token_hook| f                | {event}
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

-- Test claims via hook function
SELECT public.custom_access_token_hook(
  jsonb_build_object(
    'user_id', '550e8400-e29b-41d4-a716-446655440000',
    'claims', '{}'::jsonb
  )
);

-- Expected result should contain merged claims:
-- {
--   "claims": {
--     "org_id": "660e8400-e29b-41d4-a716-446655440000",
--     "user_role": "provider_admin",
--     "permissions": ["medication.create", "client.view", ...],
--     "scope_path": "test_org"
--   }
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
SELECT public.custom_access_token_hook(
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
SELECT public.custom_access_token_hook(
  jsonb_build_object('user_id', 'sample-user-uuid', 'claims', '{}'::jsonb)
);
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
SELECT public.custom_access_token_hook(
  jsonb_build_object('user_id', 'sample-user-uuid', 'claims', '{}'::jsonb)
);

-- Check for missing indexes
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE tablename IN ('user_roles_projection', 'user_permissions_projection', 'organizations_projection');
```

**Solutions**:
1. Add recommended indexes (see Security Considerations section)
2. Optimize queries in `custom_access_token_hook` function
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
