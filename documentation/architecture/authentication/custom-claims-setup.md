---
status: current
last_updated: 2026-01-26
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Architecture spec for the PostgreSQL database hook that adds custom claims (org_id, org_type, effective_permissions, current_org_unit_id, current_org_unit_path) to Supabase JWT tokens for multi-tenant RLS and RBAC. JWT claims version 4 uses scope-aware permissions with permission implication expansion at JWT generation time.

**When to read**:
- Understanding the JWT custom claims v4 implementation
- Debugging RLS policies that rely on JWT claims
- Reviewing security model for multi-tenant isolation
- Writing new RLS policies using effective_permissions and scope-aware helpers

**Prerequisites**: [JWT-CLAIMS-SETUP.md](../../infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md) for deployment steps

**Key topics**: `jwt`, `custom-claims`, `database-hook`, `rls`, `multi-tenant`, `rbac`, `effective-permissions`, `scope-aware-permissions`

**Estimated read time**: 14 minutes
<!-- TL;DR-END -->

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
- 🔐 **RBAC enforcement**: `effective_permissions` array enables fine-grained, scope-aware access control
- 🔐 **Hierarchical scoping**: `current_org_unit_path` supports organizational unit hierarchies
- 🔐 **Permission implications**: Permissions expanded at JWT generation time (e.g., update implies view)
- 🔐 **Scope conflict resolution**: Widest scope wins when same permission exists at multiple scopes

**Security Model**:
- Custom claims are **server-side only** (never trust client input)
- RLS policies **must** use JWT claims via helper functions (`has_effective_permission`, `has_permission`)
- Hook function computes permissions using `compute_effective_permissions(user_id, org_id)`
- Any bug in the hook compromises multi-tenant isolation

---

## Custom Claims Structure

### Enhanced JWT Payload (Version 4)

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

  // Custom claims v4 (added by hook)
  "org_id": "org-uuid",
  "org_type": "provider",
  "access_blocked": false,
  "claims_version": 4,
  "current_org_unit_id": "org-unit-uuid-or-null",
  "current_org_unit_path": "acme.pediatrics.unit1",
  "effective_permissions": [
    {"p": "organization.view", "s": "acme"},
    {"p": "medication.view", "s": "acme.pediatrics"},
    {"p": "medication.update", "s": "acme.pediatrics"},
    {"p": "client.view", "s": "acme.pediatrics.unit1"}
  ],

  // Token metadata
  "iat": 1234567890,
  "exp": 1234571490
}
```

### Claims Definitions (Version 4)

| Claim | Type | Source | Purpose |
|-------|------|--------|---------|
| `org_id` | UUID | `user_roles_projection.org_id` | Primary tenant identifier for RLS |
| `org_type` | String | `organizations_projection.org_type` | Organization type (provider, payer, etc.) |
| `access_blocked` | Boolean | `user_roles_projection.access_blocked` | Whether user access is blocked |
| `claims_version` | Integer | Hard-coded (4) | JWT schema version for backward compatibility |
| `current_org_unit_id` | UUID or null | `user_roles_projection.current_org_unit_id` | Current organizational unit context |
| `current_org_unit_path` | ltree or null | Resolved from org unit | Hierarchical path of current org unit |
| `effective_permissions` | Object[] | `compute_effective_permissions()` | Scope-aware permissions with implications expanded |

**Key Changes in Version 4**:
- **Removed**: `user_role`, `permissions` (flat array), `scope_path`
- **Added**: `effective_permissions` with scope objects `{"p": "permission", "s": "scope"}`
- **Permission implication expansion**: `medication.update` automatically includes `medication.view`
- **Scope conflict resolution**: Widest scope wins (e.g., `acme` > `acme.pediatrics`)
- **New RLS helpers**: `has_effective_permission(permission, target_path)`, `has_permission(permission)`

**Note**: These claims reflect the user's **active organization**. Users with multiple org memberships must switch context (triggers new JWT generation).

---

## Database Hook Implementation (Version 4)

The JWT hook function is included in `infrastructure/supabase/supabase/migrations/` and calls `compute_effective_permissions(user_id, org_id)` to build scope-aware permissions with implications expanded.

**Key Implementation Details**:

```sql
-- File: infrastructure/supabase/supabase/migrations/...

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_user_id uuid;
  v_claims jsonb;
  v_org_id uuid;
  v_org_type text;
  v_access_blocked boolean;
  v_current_org_unit_id uuid;
  v_current_org_unit_path ltree;
  v_effective_permissions jsonb;
BEGIN
  v_user_id := (event->>'user_id')::uuid;

  -- Query user's organization and role information
  SELECT
    ur.org_id,
    o.org_type,
    COALESCE(ur.access_blocked, false),
    ur.current_org_unit_id,
    CASE
      WHEN ur.current_org_unit_id IS NOT NULL
      THEN (SELECT path FROM organizational_units WHERE id = ur.current_org_unit_id)
      ELSE NULL
    END
  INTO v_org_id, v_org_type, v_access_blocked, v_current_org_unit_id, v_current_org_unit_path
  FROM user_roles_projection ur
  JOIN organizations_projection o ON o.org_id = ur.org_id
  WHERE ur.user_id = v_user_id
    AND ur.is_active = true
  LIMIT 1;

  -- Compute effective permissions (with implications expanded)
  v_effective_permissions := compute_effective_permissions(v_user_id, v_org_id);

  -- Build custom claims v4
  v_claims := jsonb_build_object(
    'org_id', v_org_id,
    'org_type', v_org_type,
    'access_blocked', v_access_blocked,
    'claims_version', 4,
    'current_org_unit_id', v_current_org_unit_id,
    'current_org_unit_path', v_current_org_unit_path::text,
    'effective_permissions', COALESCE(v_effective_permissions, '[]'::jsonb)
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
        'org_type', NULL,
        'access_blocked', true,
        'claims_version', 4,
        'current_org_unit_id', NULL,
        'current_org_unit_path', NULL,
        'effective_permissions', '[]'::jsonb,
        'claims_error', SQLERRM
      )
    );
END;
$$;

-- Required permission grants
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.compute_effective_permissions TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT SELECT ON TABLE user_roles_projection TO supabase_auth_admin;
GRANT SELECT ON TABLE organizations_projection TO supabase_auth_admin;
GRANT SELECT ON TABLE organizational_units TO supabase_auth_admin;
```

**Key Features**:
- Calls `compute_effective_permissions(user_id, org_id)` for permission computation
- Permission implications expanded at JWT generation time
- Widest scope wins for duplicate permissions
- Returns scope-aware permissions as `{"p": "permission", "s": "scope"}` objects

### Deployment

Deploy the function via Supabase migrations:

```bash
# Via Supabase CLI
supabase db push

# Or via SQL Editor in Dashboard
# Or via Supabase MCP tool
```

Then register the hook via Dashboard (Authentication > Hooks > Custom Access Token).

**Important**: The hook depends on `compute_effective_permissions()` function being deployed first.

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

The function is included in Supabase migrations. Deploy it via:

```bash
# Via Supabase CLI
supabase db push

# Or via SQL Editor in Dashboard
# Or via Supabase MCP tool
```

The deployment creates:
- Function: `public.custom_access_token_hook(event jsonb)`
- Permission grants to `supabase_auth_admin`
- Depends on: `compute_effective_permissions(user_id, org_id)` function
- Table access grants (SELECT on user_roles_projection, organizations_projection, organizational_units)

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

The JWT hook function is included in Supabase migrations:

```sql
-- ============================================================================
-- JWT CUSTOM CLAIMS HOOK (VERSION 4)
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
GRANT EXECUTE ON FUNCTION public.compute_effective_permissions TO supabase_auth_admin;
-- ... additional grants
```

The function is deployed via migrations and then registered via Dashboard or CLI configuration.

**Dependencies**: Requires `compute_effective_permissions(user_id, org_id)` function to be deployed first.

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

### Test 3: Test Claims Generation (Version 4)

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
INSERT INTO organizations_projection (org_id, name, org_type, path)
VALUES (
  '660e8400-e29b-41d4-a716-446655440000'::uuid,
  'Test Organization',
  'provider',
  'test_org'::ltree
)
ON CONFLICT (org_id) DO NOTHING;

-- Assign user to organization
INSERT INTO user_roles_projection (user_id, org_id, is_active, access_blocked)
VALUES (
  '550e8400-e29b-41d4-a716-446655440000'::uuid,
  '660e8400-e29b-41d4-a716-446655440000'::uuid,
  true,
  false
)
ON CONFLICT (user_id, org_id) DO UPDATE SET is_active = true;

-- Test claims via hook function
SELECT public.custom_access_token_hook(
  jsonb_build_object(
    'user_id', '550e8400-e29b-41d4-a716-446655440000',
    'claims', '{}'::jsonb
  )
);

-- Expected result should contain merged claims v4:
-- {
--   "claims": {
--     "org_id": "660e8400-e29b-41d4-a716-446655440000",
--     "org_type": "provider",
--     "access_blocked": false,
--     "claims_version": 4,
--     "current_org_unit_id": null,
--     "current_org_unit_path": null,
--     "effective_permissions": [
--       {"p": "organization.view", "s": "test_org"},
--       {"p": "medication.view", "s": "test_org"},
--       ...
--     ]
--   }
-- }
```

### Test 4: Verify JWT Contains Custom Claims (Version 4)

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

  console.log('Custom Claims v4:', {
    org_id: payload.org_id,
    org_type: payload.org_type,
    access_blocked: payload.access_blocked,
    claims_version: payload.claims_version,
    current_org_unit_id: payload.current_org_unit_id,
    current_org_unit_path: payload.current_org_unit_path,
    effective_permissions: payload.effective_permissions
  })

  // Expected output:
  // Custom Claims v4: {
  //   org_id: "660e8400-e29b-41d4-a716-446655440000",
  //   org_type: "provider",
  //   access_blocked: false,
  //   claims_version: 4,
  //   current_org_unit_id: null,
  //   current_org_unit_path: null,
  //   effective_permissions: [
  //     {"p": "organization.view", "s": "test_org"},
  //     {"p": "medication.view", "s": "test_org"},
  //     ...
  //   ]
  // }
}
```

---

## RLS Policy Examples (Version 4)

Once custom claims v4 are in the JWT, use them in RLS policies via helper functions:

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

### Example 2: Permission-Based Access (Scope-Aware)

```sql
-- Only users with 'medication.create' permission at appropriate scope can insert
CREATE POLICY "medication_create_permission"
ON medications
FOR INSERT
TO authenticated
WITH CHECK (
  -- Check permission against resource's org_unit_path
  has_effective_permission('medication.create', org_unit_path::text)
);
```

### Example 3: Permission-Based Access (Scope-Free)

```sql
-- Only users with 'organization.manage' permission (at any scope) can update
CREATE POLICY "organization_manage_permission"
ON organizations_projection
FOR UPDATE
TO authenticated
USING (
  -- Check permission without scope validation
  has_permission('organization.manage')
  AND org_id = (auth.jwt()->>'org_id')::uuid
);
```

### Example 4: Hierarchical Scope Access

```sql
-- Users can access data within their current org unit hierarchy
CREATE POLICY "hierarchical_org_unit_access"
ON client_data
FOR SELECT
TO authenticated
USING (
  -- Resource path must be within user's current org unit scope
  org_unit_path <@ (auth.jwt()->>'current_org_unit_path')::ltree
  AND has_effective_permission('client.view', org_unit_path::text)
);
```

### Example 5: Combined Conditions

```sql
-- Complex policy: tenant + permission with scope + access control
CREATE POLICY "complex_access"
ON sensitive_data
FOR SELECT
TO authenticated
USING (
  -- Must be in same organization
  org_id = (auth.jwt()->>'org_id')::uuid
  -- Access not blocked
  AND (auth.jwt()->>'access_blocked')::boolean = false
  -- Has permission at appropriate scope
  AND has_effective_permission('sensitive_data.view', org_unit_path::text)
);
```

### Key Differences from Version 3

- **Use `has_effective_permission(permission, target_path)` instead of string matching on flat permissions array**
- **Use `has_permission(permission)` for scope-free permission checks**
- **Deprecated helpers**: `get_current_user_role()`, `get_current_permissions()`, `get_current_scope_path()`
- **No more `user_role` field**: Use permissions instead of role checks
- **Scope-aware**: Permissions are evaluated against resource's ltree path

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

2. **Always Use Helper Functions for Permission Checks**
   ```sql
   -- ❌ WRONG: Direct JSON parsing of effective_permissions
   CREATE POLICY "bad_permission_check"
   ON medications FOR SELECT
   USING (
     (auth.jwt()->'effective_permissions')::jsonb @>
     '[{"p": "medication.view"}]'::jsonb
   );

   -- ✅ CORRECT: Use has_effective_permission helper
   CREATE POLICY "good_permission_check"
   ON medications FOR SELECT
   USING (
     has_effective_permission('medication.view', org_unit_path::text)
   );
   ```

3. **Validate Hook Function Logic Thoroughly**
   - Test with users having no organization membership
   - Test with users having multiple organization memberships
   - Test with inactive/deleted organizations
   - Test with access_blocked = true
   - Test permission implication expansion (e.g., update includes view)

4. **Monitor Hook Performance**
   - Hook runs on EVERY authentication
   - `compute_effective_permissions()` can be expensive with many roles/permissions
   - Slow queries impact user experience
   - Use indexes on `user_roles_projection`, `role_permissions`, and `organizational_units`

5. **Handle Hook Errors Gracefully**
   - Hook errors should NOT block authentication
   - Log errors for monitoring/debugging
   - Return safe defaults (access_blocked = true, empty permissions) rather than blocking login

6. **Audit Hook Changes**
   - Any change to hook function affects ALL users
   - Test in staging before deploying to production
   - Version control all hook SQL code and migration files
   - Document hook behavior and version changes

### Required Database Indexes

Ensure these indexes exist for hook performance:

```sql
-- Indexes for user_roles_projection
CREATE INDEX IF NOT EXISTS idx_user_roles_user_active
  ON user_roles_projection(user_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_user_roles_org
  ON user_roles_projection(org_id);

-- Indexes for organizational_units
CREATE INDEX IF NOT EXISTS idx_org_units_path
  ON organizational_units USING gist(path);

-- Indexes for role_permissions (used by compute_effective_permissions)
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id
  ON role_permissions(role_id);

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

**Symptoms**: User's permissions changed but JWT still has old effective_permissions

**Diagnosis**: JWTs are **stateless** and have 1-hour expiration by default

**Solutions**:
1. Force session refresh: `supabase.auth.refreshSession()`
2. Reduce JWT expiration time (in Supabase Dashboard → Auth → Settings)
3. Use `access_blocked` flag for immediate access revocation
4. Implement active revocation via blocklist (if real-time revocation required)
5. Document to users: "Permission changes take effect after re-login"

**Note**: Permission implication changes (e.g., adding new implications) require JWT refresh to take effect.

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
- [ ] `compute_effective_permissions()` function deployed
- [ ] Test with user having no organization (returns empty claims gracefully)
- [ ] Test with user having one organization (correct org_id, org_type, effective_permissions)
- [ ] Test with user having multiple organizations (only active org in claims)
- [ ] Test with user having no permissions (empty effective_permissions array)
- [ ] Test with user having access_blocked = true (access denied)
- [ ] Test permission implication expansion (e.g., update includes view)
- [ ] Test scope conflict resolution (widest scope wins)
- [ ] Test RLS policies using `has_effective_permission()` helper
- [ ] Verify JWT expiration and refresh works correctly
- [ ] Performance test: Hook execution time < 100ms
- [ ] All recommended indexes created
- [ ] Hook error handling logs warnings without blocking auth
- [ ] Verify `claims_version` = 4 in all JWTs
- [ ] Documentation updated with hook SQL location and version

---

## Frontend Integration (Version 4)

### Accessing Custom Claims

The frontend automatically receives and decodes custom JWT claims v4 through the auth provider:

```typescript
import { useAuth } from '@/contexts/AuthContext';

const MyComponent = () => {
  const { session } = useAuth();

  // Custom claims v4 available in session.claims
  const orgId = session?.claims.org_id;
  const orgType = session?.claims.org_type;
  const accessBlocked = session?.claims.access_blocked;
  const claimsVersion = session?.claims.claims_version; // Should be 4
  const currentOrgUnitId = session?.claims.current_org_unit_id;
  const currentOrgUnitPath = session?.claims.current_org_unit_path;
  const effectivePermissions = session?.claims.effective_permissions;

  return (
    <div>
      <p>Organization: {orgId} ({orgType})</p>
      <p>Claims Version: {claimsVersion}</p>
      <p>Current Org Unit: {currentOrgUnitPath || 'None'}</p>
      <p>Access Blocked: {accessBlocked ? 'Yes' : 'No'}</p>
      <p>Permissions: {effectivePermissions.length} effective permissions</p>
    </div>
  );
};
```

### Organization Switching

Frontend triggers organization switch which refreshes JWT with new org context:

```typescript
const { switchOrganization } = useAuth();

// Updates database + refreshes JWT with new org_id and effective_permissions
await switchOrganization('new-org-uuid');
```

### Permission Checking in Frontend

```typescript
import { hasPermission } from '@/utils/permissions';

// Check if user has permission at a specific scope
const canViewMedications = hasPermission(
  session.claims.effective_permissions,
  'medication.view',
  'acme.pediatrics.unit1' // target scope
);

// Permission implications are already expanded in JWT
// e.g., medication.update automatically includes medication.view
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

**Document Version**: 2.0 (JWT Claims v4)
**Last Updated**: 2026-01-26
**Status**: Production (JWT Claims Version 4 Active)
