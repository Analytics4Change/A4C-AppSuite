# Context: Subdomain Redirect for Subsequent Logins

## Decision Record

**Date**: 2025-12-19
**Feature**: Fix subdomain redirect for subsequent logins
**Goal**: Ensure users are redirected to their organization's subdomain on ALL logins, not just the first login after invitation acceptance

### Key Decisions

1. **Use RPC Function Instead of Direct Table Query**: The frontend's direct query to `organizations_projection` is subject to RLS, which fails due to `@supabase/ssr` session timing issues. An RPC function with SECURITY DEFINER bypasses this while maintaining security.

2. **Explicit org_id Validation in RPC**: Rather than relying on RLS policies, the RPC function explicitly validates that the caller's JWT `org_id` matches the requested org_id. This is equivalent security but more reliable.

3. **No Event Emission Required**: This is a read-only query operation for redirect purposes. No data is created, modified, or deleted - therefore no domain events are needed.

4. **Minimal Change Approach**: Only modify the subdomain lookup service, leaving all other org queries unchanged. This minimizes risk and scope.

## Technical Context

### Architecture

```
Login Flow:
User → LoginPage.tsx → handlePostLoginRedirect() → getOrganizationSubdomainInfo()
                                                           ↓
                                                   [CURRENT: Direct table query → RLS fails]
                                                   [FIX: RPC call → SECURITY DEFINER bypasses RLS]
                                                           ↓
                                                   Build subdomain URL → Redirect to org subdomain
```

### Root Cause Analysis

1. JWT hook (`custom_access_token_hook`) runs successfully at login and adds `org_id` to claims
2. Auth logs confirm: `"Hook ran successfully"` with `org_id` correctly set
3. But frontend query to `organizations_projection` returns HTTP 406 (0 rows)
4. RLS policy checks `id = get_current_org_id()` which reads from `auth.jwt()->>'org_id'`
5. The `@supabase/ssr` client is not correctly including the JWT in the Authorization header

### Why First Login Works

First login after invitation uses explicit redirect URL from query param:
- `AcceptInvitationPage` receives `redirectUrl: https://subdomain.../dashboard`
- Passes it to `LoginPage` via `?redirect=...`
- `handlePostLoginRedirect()` uses Priority 1 (explicit redirect URL)
- **No database query needed** - subdomain URL is already known

### Why Subsequent Logins Fail

Subsequent logins have no explicit redirect URL:
- User navigates directly to `/login`
- No `?redirect=` param
- `handlePostLoginRedirect()` falls to Priority 3 (subdomain lookup)
- Queries `organizations_projection` for `slug` and `subdomain_status`
- RLS blocks the query → 406 → Falls to Priority 4 → `/clients`

## File Structure

### No New Files Created

The existing `api.get_organization_by_id` RPC function already has:
- `SECURITY DEFINER` (bypasses RLS via postgres superuser)
- Returns `subdomain_status` (added in Phase 9 of previous fix)

### Existing Files Modified
- `frontend/src/services/organization/getOrganizationSubdomainInfo.ts`
  - Change from direct table query to RPC call
  - Use `.schema('api').rpc('get_organization_by_id', { p_org_id: orgId })`

## Related Components

- **LoginPage.tsx** (`frontend/src/pages/auth/LoginPage.tsx`)
  - Calls `handlePostLoginRedirect()` after login
  - Priority 3: Subdomain lookup via `getOrganizationSubdomainInfo()`

- **AuthCallback.tsx** (`frontend/src/pages/auth/AuthCallback.tsx`)
  - OAuth callback handler
  - Same subdomain lookup pattern for returning users

- **supabase-ssr.ts** (`frontend/src/lib/supabase-ssr.ts`)
  - Cookie-based Supabase client
  - Session timing issue with JWT inclusion

- **JWT Hook** (`infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql`)
  - `custom_access_token_hook` adds `org_id` to JWT claims
  - Works correctly - not the issue

- **RLS Policies** (`infrastructure/supabase/sql/06-rls/001-core-projection-policies.sql`)
  - `organizations_select` policy: `id = get_current_org_id()`
  - Works correctly when JWT is properly included

## Key Patterns and Conventions

### RPC Function Pattern for RLS Bypass
```sql
CREATE OR REPLACE FUNCTION api.get_subdomain_info_for_redirect(p_org_id UUID)
RETURNS TABLE (slug TEXT, subdomain_status TEXT)
SECURITY DEFINER  -- Runs as owner, bypasses RLS
SET search_path = public, extensions, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
  v_caller_org_id UUID;
BEGIN
  -- Get caller's org_id from JWT (still validates caller identity)
  v_caller_org_id := (auth.jwt()->>'org_id')::uuid;

  -- Security check: only allow querying your own org
  IF v_caller_org_id IS NULL OR v_caller_org_id != p_org_id THEN
    RETURN;  -- Return empty set (no access)
  END IF;

  RETURN QUERY
  SELECT o.slug, o.subdomain_status::TEXT
  FROM organizations_projection o
  WHERE o.id = p_org_id
  LIMIT 1;
END;
$$;
```

### Frontend RPC Call Pattern
```typescript
const { data, error } = await supabase
  .schema('api')
  .rpc('get_subdomain_info_for_redirect', { p_org_id: orgId })
  .single();
```

## Reference Materials

- **Previous Fix Documentation**: `dev/archived/subdomain-redirect-fix/`
  - Phase 1-9 of original subdomain redirect implementation
  - Contains context on DNS verification, cookie-based sessions, etc.

- **Auth Logs Evidence**: Supabase Auth logs showing hook success
- **Console Logs**: HTTP 406 error on `organizations_projection` query

## Important Constraints

1. **Security**: RPC function MUST validate org_id matches caller's JWT
2. **No Events**: This is read-only - no domain events
3. **Backwards Compatible**: No changes to existing redirect URL handling
4. **Minimal Scope**: Only fix subdomain lookup, don't change other queries

## Why This Approach?

**Considered Alternatives**:

1. **Debug `@supabase/ssr` session timing**: Complex, brittle, client-side issue
2. **Force session refresh before query**: Adds latency, might not solve root cause
3. **Add special RLS policy**: Would affect all queries, harder to reason about

**Chosen: RPC with SECURITY DEFINER**:
- Reliable - doesn't depend on client session state
- Secure - explicit validation in function
- Simple - minimal code change
- Targeted - only affects this specific use case
