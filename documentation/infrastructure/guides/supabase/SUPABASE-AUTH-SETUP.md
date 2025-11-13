---
status: current
last_updated: 2025-01-13
---

# Supabase Auth Setup Guide

**Status**: ✅ Implementation guide for Supabase Auth integration
**Last Updated**: 2025-10-24
**Purpose**: Step-by-step instructions for configuring Supabase Auth with custom JWT claims

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Phase 1: Enable Social Providers](#phase-1-enable-social-providers)
4. [Phase 2: Deploy Custom Claims Hook](#phase-2-deploy-custom-claims-hook)
5. [Phase 3: Update RLS Policies](#phase-3-update-rls-policies)
6. [Phase 4: Testing](#phase-4-testing)
7. [Phase 5: Enterprise SSO (Future)](#phase-5-enterprise-sso-future)
8. [Troubleshooting](#troubleshooting)

---

## Overview

This guide walks through configuring Supabase Auth to replace Zitadel as the authentication provider for the A4C Platform. The configuration includes:

- Social login providers (Google, GitHub, etc.)
- Custom JWT claims for RBAC and multi-tenancy
- Integration with event-driven database schema
- Row-level security (RLS) policy updates

**See Also**:
- **Architecture**: `.plans/supabase-auth-integration/overview.md`
- **Custom Claims Details**: `.plans/supabase-auth-integration/custom-claims-setup.md`
- **Enterprise SSO**: `.plans/supabase-auth-integration/enterprise-sso-guide.md`

---

## Prerequisites

Before starting, ensure you have:

1. **Supabase Project**: Pro plan or higher (required for custom hooks and SAML SSO)
2. **Database Schema Deployed**: Run `DEPLOY_TO_SUPABASE_STUDIO.sql` to create tables and projections
3. **Supabase CLI Installed**: For deploying hooks and migrations
   ```bash
   npm install -g supabase
   supabase login
   ```
4. **Social Provider Credentials**: OAuth client IDs and secrets from providers (Google, GitHub, etc.)

---

## Phase 1: Enable Social Providers

### Step 1.1: Configure Google OAuth

1. **Create OAuth App** in [Google Cloud Console](https://console.cloud.google.com/)
   - Navigate to: APIs & Services → Credentials
   - Create OAuth 2.0 Client ID
   - Application type: Web application
   - Authorized JavaScript origins:
     - `https://your-project.supabase.co`
     - `https://app.firstovertheline.com`
   - Authorized redirect URIs:
     - `https://your-project.supabase.co/auth/v1/callback`

2. **Enable in Supabase Dashboard**
   - Navigate to: Authentication → Providers → Google
   - Toggle "Google enabled"
   - Enter Client ID and Client Secret from Google Console
   - Click "Save"

### Step 1.2: Configure GitHub OAuth (Optional)

1. **Create OAuth App** in [GitHub Settings](https://github.com/settings/developers)
   - Navigate to: Settings → Developer settings → OAuth Apps
   - New OAuth App
   - Authorization callback URL: `https://your-project.supabase.co/auth/v1/callback`

2. **Enable in Supabase Dashboard**
   - Navigate to: Authentication → Providers → GitHub
   - Toggle "GitHub enabled"
   - Enter Client ID and Client Secret from GitHub
   - Click "Save"

### Step 1.3: Test Social Login

**Frontend Test** (from React app):
```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
)

// Trigger Google login
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: 'https://app.firstovertheline.com/auth/callback'
  }
})

// User will be redirected to Google, then back to your app
```

**Verify**:
- User should be redirected to Google login
- After successful authentication, user should be redirected back to app
- Check Supabase Dashboard → Authentication → Users to see new user

---

## Phase 2: Deploy Custom Claims Hook

### Step 2.1: Verify Database Schema

Ensure these tables exist (created by `DEPLOY_TO_SUPABASE_STUDIO.sql`):

```sql
-- Check tables exist
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'organizations_projection',
    'user_roles_projection',
    'user_permissions_projection'
  );

-- Expected output: 3 rows
```

### Step 2.2: Deploy Custom Claims Functions

**File**: `sql/03-functions/authorization/002-authentication-helpers.sql`

```sql
-- Function to get user claims
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

  -- Get user's effective permissions
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

-- Function to add custom claims to JWT
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
    RAISE WARNING 'user_id is null in custom_access_token_hook';
    RETURN event;
  END IF;

  -- Get custom claims
  BEGIN
    claims := auth.get_user_claims(user_id);
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Failed to get custom claims for user %: %', user_id, SQLERRM;
      RETURN event;
  END;

  -- Merge custom claims into event claims
  event := jsonb_set(
    event,
    '{claims}',
    COALESCE(event->'claims', '{}'::jsonb) || claims
  );

  RETURN event;
END;
$$;

COMMENT ON FUNCTION auth.custom_access_token_hook IS
  'Supabase Auth hook that adds custom claims (org_id, permissions, role, scope_path) to JWT during token generation';
```

**Deploy via Supabase SQL Editor**:
1. Copy SQL above
2. Navigate to: Supabase Dashboard → SQL Editor
3. Paste and execute

**Verify Functions Exist**:
```sql
SELECT proname, prosecdef
FROM pg_proc
WHERE proname IN ('get_user_claims', 'custom_access_token_hook')
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'auth');

-- Expected output: 2 rows with prosecdef = true (SECURITY DEFINER)
```

### Step 2.3: Register Hook with Supabase Auth

**Via Supabase Dashboard**:
1. Navigate to: Authentication → Hooks
2. Find "Custom Access Token Hook"
3. Toggle "Enable Custom Access Token Hook"
4. Select Function:
   - Schema: `auth`
   - Function: `custom_access_token_hook`
5. Click "Save"

**Verify Hook Registration**:
```sql
-- Check hook is registered (Supabase Pro plan feature)
-- This query may not work on all Supabase versions
SELECT * FROM auth.hooks
WHERE hook_name = 'custom_access_token_hook';
```

### Step 2.4: Test Custom Claims

**Create Test User and Organization**:
```sql
-- Create test organization
INSERT INTO organizations_projection (org_id, name, type, path, is_active)
VALUES (
  '550e8400-e29b-41d4-a716-446655440000'::uuid,
  'Test Organization',
  'provider',
  'test_org'::ltree,
  true
)
ON CONFLICT (org_id) DO NOTHING;

-- Create test user in Supabase Auth (via dashboard or signup flow)

-- Assign user to organization
INSERT INTO user_roles_projection (user_id, org_id, role, is_active)
VALUES (
  'your-user-uuid'::uuid,
  '550e8400-e29b-41d4-a716-446655440000'::uuid,
  'provider_admin',
  true
)
ON CONFLICT (user_id, org_id) DO UPDATE SET is_active = true;

-- Grant test permissions
INSERT INTO user_permissions_projection (user_id, org_id, permission_name, is_active)
VALUES
  ('your-user-uuid'::uuid, '550e8400-e29b-41d4-a716-446655440000'::uuid, 'medication.create', true),
  ('your-user-uuid'::uuid, '550e8400-e29b-41d4-a716-446655440000'::uuid, 'client.view', true)
ON CONFLICT (user_id, org_id, permission_name) DO UPDATE SET is_active = true;
```

**Test Claims Function**:
```sql
-- Test claims retrieval
SELECT auth.get_user_claims('your-user-uuid'::uuid);

-- Expected output (jsonb):
-- {
--   "org_id": "550e8400-e29b-41d4-a716-446655440000",
--   "user_role": "provider_admin",
--   "permissions": ["medication.create", "client.view"],
--   "scope_path": "test_org"
-- }
```

**Frontend Test** (decode JWT):
```typescript
// After signing in, decode JWT to verify custom claims
const { data: { session } } = await supabase.auth.getSession()

if (session) {
  // Decode JWT payload (Base64)
  const payload = JSON.parse(atob(session.access_token.split('.')[1]))

  console.log('Custom Claims:', {
    org_id: payload.org_id,
    user_role: payload.user_role,
    permissions: payload.permissions,
    scope_path: payload.scope_path
  })

  // Expected output:
  // Custom Claims: {
  //   org_id: "550e8400-e29b-41d4-a716-446655440000",
  //   user_role: "provider_admin",
  //   permissions: ["medication.create", "client.view"],
  //   scope_path: "test_org"
  // }
}
```

---

## Phase 3: Update RLS Policies

### Step 3.1: Update Existing Policies

**File**: `sql/06-rls/001-core-projection-policies.sql`

Replace Zitadel-based policies with Supabase Auth JWT claims:

**Before (Zitadel)**:
```sql
CREATE POLICY "tenant_isolation"
ON clients FOR ALL
TO authenticated
USING (
  org_id = current_setting('app.current_org_id')::uuid
);
```

**After (Supabase Auth)**:
```sql
CREATE POLICY "tenant_isolation"
ON clients FOR ALL
TO authenticated
USING (
  org_id = (auth.jwt()->>'org_id')::uuid
);
```

### Step 3.2: Permission-Based Policies

```sql
-- Permission-based INSERT policy
CREATE POLICY "medication_create_permission"
ON medications FOR INSERT
TO authenticated
WITH CHECK (
  -- Tenant isolation
  org_id = (auth.jwt()->>'org_id')::uuid
  AND
  -- Permission check
  'medication.create' = ANY(
    string_to_array(auth.jwt()->>'permissions', ',')
  )
);

-- Permission-based SELECT policy
CREATE POLICY "client_view_permission"
ON clients FOR SELECT
TO authenticated
USING (
  -- Tenant isolation
  org_id = (auth.jwt()->>'org_id')::uuid
  AND
  -- Permission check
  'client.view' = ANY(
    string_to_array(auth.jwt()->>'permissions', ',')
  )
);
```

### Step 3.3: Hierarchical Scope Policies

```sql
-- Hierarchical organization access
CREATE POLICY "hierarchical_org_access"
ON organizations_projection FOR SELECT
TO authenticated
USING (
  -- User can access their org and all descendants
  path <@ (auth.jwt()->>'scope_path')::ltree
  OR
  -- User can access ancestors of their org
  (auth.jwt()->>'scope_path')::ltree <@ path
);
```

### Step 3.4: Deploy Updated Policies

```sql
-- Drop old policies (Zitadel-based)
DROP POLICY IF EXISTS "old_policy_name" ON table_name;

-- Create new policies (Supabase Auth-based)
-- Copy policies from sql/06-rls/001-core-projection-policies.sql

-- Verify policies exist
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE tablename IN ('clients', 'medications', 'organizations_projection')
ORDER BY tablename, policyname;
```

---

## Phase 4: Testing

### Test 4.1: Multi-Tenant Isolation

```sql
-- Create second test organization
INSERT INTO organizations_projection (org_id, name, type, path, is_active)
VALUES (
  '660e8400-e29b-41d4-a716-446655440001'::uuid,
  'Second Test Organization',
  'provider',
  'test_org_2'::ltree,
  true
);

-- Create test client in first org
INSERT INTO clients (client_id, org_id, first_name, last_name)
VALUES (
  gen_random_uuid(),
  '550e8400-e29b-41d4-a716-446655440000'::uuid,
  'Test',
  'Client'
);

-- Create test client in second org
INSERT INTO clients (client_id, org_id, first_name, last_name)
VALUES (
  gen_random_uuid(),
  '660e8400-e29b-41d4-a716-446655440001'::uuid,
  'Other',
  'Client'
);
```

**Frontend Test**:
```typescript
// User assigned to first org should only see clients from that org
const { data: clients, error } = await supabase
  .from('clients')
  .select('*')

console.log('Clients:', clients)
// Should only include clients from user's org (first org)
// RLS policy enforces: org_id = (auth.jwt()->>'org_id')::uuid
```

### Test 4.2: Permission-Based Access

```typescript
// User without 'medication.create' permission should fail
const { data, error } = await supabase
  .from('medications')
  .insert({
    medication_name: 'Test Medication',
    org_id: 'user-org-uuid'
  })

if (error) {
  console.log('Expected error:', error.message)
  // "new row violates row-level security policy"
}
```

### Test 4.3: Organization Switching

```typescript
// Switch user's active organization
async function switchOrganization(userId: string, newOrgId: string) {
  // Deactivate all organizations
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

  // Verify JWT has new org_id
  const { data: { session } } = await supabase.auth.getSession()
  const payload = JSON.parse(atob(session.access_token.split('.')[1]))
  console.log('New org_id:', payload.org_id)
}
```

### Test 4.4: OAuth Configuration Verification

**Purpose**: Validate that OAuth providers are correctly configured and JWT custom claims are being populated.

**See Also**: For comprehensive OAuth testing procedures, refer to [`OAUTH-TESTING.md`](./OAUTH-TESTING.md)

#### Quick Verification Steps

1. **Verify OAuth Provider Configuration**:
   ```bash
   cd infrastructure/supabase/scripts
   export SUPABASE_ACCESS_TOKEN="your-access-token"
   ./verify-oauth-config.sh

   # Expected output:
   # ✓ Google OAuth is ENABLED
   # ✓ Client ID is configured
   ```

2. **Test OAuth URL Generation**:
   ```bash
   cd infrastructure/supabase/scripts
   ./test-oauth-url.sh

   # Copy the displayed URL and open in browser
   # Complete Google OAuth flow
   # Verify successful redirect
   ```

3. **Verify JWT Custom Claims**:
   ```sql
   -- Run comprehensive JWT hook diagnostics
   -- Copy contents of verify-jwt-hook-complete.sql into Supabase SQL Editor

   -- Check results for:
   -- ✓ Hook exists in public schema
   -- ✓ Permissions granted to supabase_auth_admin
   -- ✓ User record exists
   -- ✓ Role assignments exist
   -- ✓ Simulated claims show correct data
   ```

4. **Frontend JWT Inspection**:
   ```typescript
   // After OAuth login, inspect JWT token
   const { data: { session } } = await supabase.auth.getSession()

   if (session) {
     const payload = JSON.parse(atob(session.access_token.split('.')[1]))

     console.log('JWT Custom Claims:', {
       org_id: payload.org_id,              // Should not be null (unless super_admin)
       user_role: payload.user_role,        // Should match user's role
       permissions: payload.permissions,    // Should be array of permission names
       scope_path: payload.scope_path,      // Should match org hierarchy path
       claims_version: payload.claims_version // Should be 1
     })

     // Verify no error field
     if (payload.claims_error) {
       console.error('JWT Hook Error:', payload.claims_error)
     }
   }
   ```

#### Common OAuth Issues and Solutions

**Issue**: OAuth returns "redirect_uri_mismatch"
- **Solution**: Verify redirect URI in Google Cloud Console matches exactly:
  `https://tmrjlswbsxmbglmaclxu.supabase.co/auth/v1/callback`

**Issue**: JWT contains `claims_error` field
- **Solution**: Run `verify-jwt-hook-complete.sql` to diagnose hook configuration issues
- Check Supabase auth logs: Dashboard → Logs → Auth Logs

**Issue**: User shows "viewer" role instead of assigned role
- **Solution**:
  1. Verify JWT hook is registered in Dashboard (Authentication → Hooks)
  2. Check permissions: `SELECT has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook', 'EXECUTE')`
  3. Verify user has role assignment in `user_roles_projection`

**Issue**: JWT missing custom claims entirely
- **Solution**:
  1. Verify hook function exists: `SELECT * FROM pg_proc WHERE proname = 'custom_access_token_hook'`
  2. Verify hook is in `public` schema (not `auth` schema)
  3. Check hook is enabled in Supabase Dashboard

#### Comprehensive Testing

For complete OAuth testing procedures including:
- Two-phase testing strategy
- Troubleshooting common issues
- JWT hook diagnostics
- Production application integration testing

**See**: [`OAUTH-TESTING.md`](./OAUTH-TESTING.md) for the full guide.

---

## Phase 5: Enterprise SSO (Future)

Enterprise SSO (SAML 2.0) will be configured per-organization in the future. Prerequisites:

1. **Supabase Pro Plan**: Required for SAML support
2. **Customer IdP**: Customer provides SAML metadata (Okta, Azure AD, etc.)
3. **Temporal Workflow**: SSO configuration orchestrated via `ConfigureOrganizationSSOWorkflow`

**See**: `.plans/supabase-auth-integration/enterprise-sso-guide.md` for detailed instructions (timeline: 3-6 months)

---

## Troubleshooting

### Issue: Custom Claims Not Appearing in JWT

**Diagnosis**:
```sql
-- Check if hook function exists
SELECT proname FROM pg_proc WHERE proname = 'custom_access_token_hook';

-- Check if hook is enabled (dashboard: Authentication → Hooks)

-- Test function directly
SELECT auth.custom_access_token_hook(
  jsonb_build_object(
    'user_id', 'your-user-uuid',
    'claims', '{}'::jsonb
  )
);
```

**Solutions**:
1. Re-register hook in Supabase Dashboard
2. Verify function has `SECURITY DEFINER` attribute
3. Force new session: Sign out and sign in again
4. Check Supabase logs for hook errors

---

### Issue: RLS Policy Blocks Valid Request

**Diagnosis**:
```sql
-- Check if user has organization assignment
SELECT * FROM user_roles_projection
WHERE user_id = 'your-user-uuid' AND is_active = true;

-- Check if JWT contains expected claims
-- Decode JWT in frontend and inspect payload

-- Test RLS policy directly
SET ROLE authenticated;
SET request.jwt.claims = '{"org_id": "550e8400-e29b-41d4-a716-446655440000", "sub": "your-user-uuid"}';
SELECT * FROM clients;
RESET ROLE;
```

**Solutions**:
1. Ensure user is assigned to an organization
2. Ensure `is_active = true` in user_roles_projection
3. Verify RLS policy syntax uses `auth.jwt()` correctly
4. Check table has `org_id` column

---

### Issue: Hook Function Slow

**Diagnosis**:
```sql
-- Check query execution time
EXPLAIN ANALYZE
SELECT auth.get_user_claims('your-user-uuid'::uuid);

-- Check for missing indexes
\d user_roles_projection
\d user_permissions_projection
```

**Solutions**:
1. Add recommended indexes:
```sql
CREATE INDEX IF NOT EXISTS idx_user_roles_user_active
  ON user_roles_projection(user_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_user_permissions_user_org
  ON user_permissions_projection(user_id, org_id) WHERE is_active = true;
```
2. Optimize `get_user_claims` function queries
3. Consider caching claims in application session

---

## Security Advisors

After deploying, run security advisors:

```bash
# Via Supabase CLI (if available)
supabase db lint

# Via Supabase Dashboard
# Navigate to: Advisors → Security
```

**Check for**:
- Missing RLS policies on tables with sensitive data
- Overly permissive RLS policies
- Missing indexes affecting performance

---

## Deployment Checklist

Before deploying to production:

- [ ] Social providers configured and tested
- [ ] Custom claims hook deployed and registered
- [ ] Hook function tested with sample user
- [ ] JWT contains expected custom claims
- [ ] RLS policies updated to use `auth.jwt()`
- [ ] Multi-tenant isolation tested (users cannot see other orgs' data)
- [ ] Permission-based access tested
- [ ] Organization switching tested (JWT refresh)
- [ ] Indexes created for performance
- [ ] Security advisors run with no critical issues
- [ ] Frontend updated to use Supabase Auth (remove Zitadel)
- [ ] Environment variables updated (remove Zitadel vars)

---

## Related Documentation

- **Architecture**: `.plans/supabase-auth-integration/overview.md`
- **Custom Claims Details**: `.plans/supabase-auth-integration/custom-claims-setup.md`
- **Enterprise SSO**: `.plans/supabase-auth-integration/enterprise-sso-guide.md`
- **Temporal Workflows**: `.plans/temporal-integration/organization-onboarding-workflow.md`
- **RBAC Architecture**: `.plans/rbac-permissions/architecture.md`

---

**Document Version**: 1.0
**Last Updated**: 2025-10-24
**Status**: Ready for Implementation
