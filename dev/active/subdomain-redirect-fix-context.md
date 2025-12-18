# Context: Subdomain Redirect Bug Fix

## Decision Record

**Date**: 2025-12-15 to 2025-12-16
**Feature**: Subdomain Redirect Bug Fix
**Goal**: Ensure users are redirected to their organization's subdomain after invitation acceptance
**Status**: ✅ COMPLETE

### Key Decisions

1. **Minimal Fix Approach**: Remove try-catch only, don't optimize DNS quorum tracking
   - The existing DNS retry loop is sufficient
   - Adding state tracking for partial quorum would add unnecessary complexity
   - DNS queries are cheap and idempotent

2. **Let Temporal Handle Retries**: By removing the try-catch, errors propagate to the DNS retry loop
   - Workflow-level retry (7 attempts, 10s-300s backoff) is appropriate for DNS propagation
   - Activity-level retry (3 attempts, 1s-30s) was bypassed by the try-catch anyway

3. **Data Repair via Event Emission**: Fix existing orgs by manually emitting the verified event
   - The projection trigger handles updating `subdomain_status`
   - No direct database updates needed

4. **Second Bug Discovery** (2025-12-16): `dnsSuccess = true` placement
   - During testing of first fix, discovered loop was still exiting immediately
   - Root cause: `dnsSuccess = true` was set BEFORE `verifyDNS()` instead of after
   - Loop condition `!dnsSuccess` was false, causing immediate exit after first failure

## Technical Context

### Architecture

```
Frontend → Edge Function → Database Projection → Redirect Decision
                ↑
Temporal Workflow → verifyDNS Activity → Domain Event → Projection Trigger
```

The redirect logic in `accept-invitation/index.ts` checks `subdomain_status === 'verified'` to decide whether to redirect to the subdomain URL.

### Event Flow

1. `configureDNS` creates Cloudflare CNAME record
2. `verifyDNS` queries 3 DNS servers (Google, Cloudflare, OpenDNS)
3. If quorum (2/3) reached, emits `organization.subdomain.verified` event
4. Projection trigger updates `subdomain_status` to `'verified'`
5. Invitation acceptance checks this status for redirect decision

### The Bugs (Both Fixed)

**Bug 1**: Try-catch swallowing verifyDNS errors
```typescript
// workflow.ts lines 224-233 (FIXED in b6e8d836)
try {
  await verifyDNS({ orgId: state.orgId!, domain: dnsResult.fqdn });
} catch (verifyError) {
  // DNS verification failed, but we'll continue  ← SWALLOWED ERROR
  log.warn('DNS verification failed (non-fatal)', {...});
}
```

**Bug 2**: `dnsSuccess = true` set too early
```typescript
// workflow.ts (FIXED in f3417a61)
// BEFORE: dnsSuccess was set BEFORE verifyDNS()
dnsSuccess = true;  // ← Too early!
await verifyDNS({...});

// AFTER: dnsSuccess set AFTER verifyDNS() succeeds
await verifyDNS({...});
dnsSuccess = true;  // ← Correct placement
```

### Evidence from Temporal Logs (Before Fix)

```
[ConfigureDNS] Creating CNAME record: liveforlife.firstovertheline.com → a4c.firstovertheline.com
[VerifyDNS] Quorum: 0/3 (required: 2)
error: Error: DNS verification failed: only 0/3 servers confirmed.
2025-12-15T16:40:12.665Z [WARN] DNS verification failed (non-fatal) { subdomain: 'liveforlife'
```

### Evidence After Fix

```
# poc-test2-20251215 - Verified automatically
Created: 02:52:17
DNS Verified: 02:52:34
Total time: ~17 seconds
subdomain_status: 'verified' ✅
```

## File Structure

### Files Modified
- `workflows/src/workflows/organization-bootstrap/workflow.ts`
  - Commit b6e8d836: Removed try-catch around `verifyDNS` call (lines 224-233)
  - Commit f3417a61: Moved `dnsSuccess = true` to after `verifyDNS()` succeeds (line 229)

### Related Files (Read-Only Context)
- `workflows/src/activities/organization-bootstrap/verify-dns.ts`
  - Implements quorum-based DNS verification
  - Throws error if quorum not reached (correct behavior)
  - Emits `organization.subdomain.verified` event on success

- `infrastructure/supabase/supabase/functions/accept-invitation/index.ts` (lines 295-308)
  - Redirect logic checks `subdomain_status === 'verified'`

- `infrastructure/supabase/sql/03-functions/event-processing/002-process-organization-events.sql`
  - Handles `organization.subdomain.verified` event
  - Updates `subdomain_status` to `'verified'` in projection

## Related Components

- **Temporal Worker**: Runs the organization bootstrap workflow
- **Cloudflare DNS**: Target for CNAME records
- **Supabase Edge Functions**: Handle invitation acceptance redirect
- **PostgreSQL Triggers**: Process domain events to update projections

## Key Patterns and Conventions

### DNS Retry Loop Structure (lines 204-265) - CORRECTED
```typescript
while (dnsRetryCount < maxDnsRetries && !dnsSuccess) {
  try {
    const dnsResult = await configureDNS({...});
    await verifyDNS({...});  // Errors propagate to catch block
    dnsSuccess = true;       // Only set AFTER verifyDNS succeeds
  } catch (error) {
    dnsRetryCount++;
    // Exponential backoff: 10s → 20s → 40s → ... → 300s (max)
    await sleep(`${delaySeconds}s`);
  }
}
```

### Activity Idempotency
- `configureDNS`: Check-then-act pattern, returns existing record if found
- `verifyDNS`: Stateless, queries all DNS servers fresh each call

## Important Constraints

- **DNS Propagation Time**: Typically 60-300 seconds
- **Quorum Requirement**: 2 of 3 DNS servers must resolve
- **Retry Budget**: 7 attempts with exponential backoff (~15 min total)
- **WORKFLOW_MODE**: Production mode performs real DNS lookups

## Gotchas Discovered

1. **Loop condition timing**: The `dnsSuccess` flag must be set AFTER the action that determines success, not before. This is a common bug pattern in retry loops.

2. **Testing retry loops**: A retry loop that exits in 18 seconds when it should take 15 minutes is a clear sign the loop condition is wrong.

3. **Multiple bugs can stack**: Bug 1 (try-catch swallowing) masked Bug 2 (early dnsSuccess). Fixing Bug 1 revealed Bug 2.

## Data Repair Performed

### Organizations Repaired Manually
- `liveforlife` (ID: `15179416-0229-4362-ab39-e754891d9d72`) - Event emitted manually
- `poc-test1-20251215` (ID: `30357e3b-72bc-4b1f-89bb-1f080d612b64`) - Event emitted manually

### Organizations Verified Automatically (After Fix)
- `poc-test2-20251215` (ID: `44526b7b-c163-4f5a-a197-b8d316a36a5e`) - Verified in 17 seconds ✅

## Deployment Info

- **Commits**: `b6e8d836`, `f3417a61`
- **Worker Image**: `ghcr.io/analytics4change/a4c-workflows:f3417a6`
- **GitHub Actions Run**: 20254682499
- **Deployment Time**: 2025-12-16 ~02:45 UTC

---

## Follow-on Issue: org-cleanup Not Cleaning Users (2025-12-16)

### Issue Discovered

While testing `poc-test3-20251215` invitation acceptance, encountered 500 error:
```
422: A user with this email address has already been registered
```

**Root Cause**: `/org-cleanup` command was deleting from `auth.users` but NOT from `public.users` (shadow table). This left orphaned records that caused:
1. Duplicate user entries in `public.users`
2. Auth user from previous org (poc-test2) still existed, blocking new user creation

### Data Found

- `johnltice@yahoo.com` had 2 orphaned records in `public.users` (from Dec 11 and Dec 12)
- `johnltice@yahoo.com` still existed in `auth.users` from `poc-test2-20251215` cleanup
- The org `44526b7b-c163-4f5a-a197-b8d316a36a5e` (poc-test2) was deleted but user wasn't

### Fixes Applied

1. **Immediate**: Deleted orphaned users manually via SQL
   - 2 records from `public.users`
   - 1 record from `auth.users` (`d7224c6b-2b85-423c-adf5-a423b89c46a2`)

2. **Systemic**: Updated `/org-cleanup` and `/org-cleanup-dryrun` slash commands:
   - Added Step 1.6: Find shadow users in `public.users` (by email AND by `current_organization_id`)
   - Added Step 3.1: Delete from `public.users` BEFORE `auth.users`
   - Added orphan cleanup: Explicitly deletes orphaned shadow users by email
   - Updated summary reports to show shadow user counts

### Files Modified (2025-12-16)

- `.claude/commands/org-cleanup.md` - Added shadow user discovery and cleanup steps
- `.claude/commands/org-cleanup-dryrun.md` - Matching updates for dry run preview

### Incomplete Work

- `infrastructure/supabase/supabase/functions/accept-invitation/index.ts`
  - Version bumped to `v6` but fix not complete
  - TODO: Handle `email_exists` error by looking up existing user instead of failing
  - Current behavior: Returns 500 when user already exists
  - Desired behavior: Look up existing user, use their ID, continue with invitation

### Testing Status

- `poc-test3-20251215` invitation acceptance should now work after manual cleanup
- Test URL: `https://a4c.firstovertheline.com/accept-invitation?token=pmlUp8Rb_Jb6p8Xls3HzAI6IAR3gqfTG-iJENts48f8`

---

## Phase 7: Cross-Subdomain Session Sharing (2025-12-16)

### Issue Discovered

After accepting invitation and logging in, users are redirected to `a4c.firstovertheline.com/clients` instead of their organization's subdomain. The edge function correctly returns a subdomain redirect URL, but:

1. **localStorage is domain-scoped**: Session data stored at `a4c.firstovertheline.com` is NOT available at `poc-test1.firstovertheline.com`
2. **Redirect URL is lost**: The redirect URL from edge function is lost during login flow
3. **No session sharing**: Each subdomain has its own isolated localStorage

### Root Cause Analysis

```
Current Flow (Broken):
1. User accepts invitation → Edge function returns redirectUrl: "https://poc-test1.firstovertheline.com/dashboard"
2. AcceptInvitationPage receives redirectUrl
3. User clicks "Go to Login" → navigates to /login
4. Login completes → redirects to /clients (default) ← REDIRECT URL LOST!
5. User manually navigates to subdomain → NO SESSION (localStorage is domain-scoped)
```

### Solution: Cookie-Based Sessions with @supabase/ssr

**Key Decisions**:

1. **Use `@supabase/ssr` package**: Cookie-based session storage instead of localStorage
2. **Parent domain cookie scope**: Cookies scoped to `.{PLATFORM_BASE_DOMAIN}` for cross-subdomain sharing
3. **Single source of truth**: `VITE_PLATFORM_BASE_DOMAIN` environment variable (no hardcoded domains)
4. **Subdomain from projection**: Query `organizations_projection.slug` for subdomain
5. **URL query parameter redirect**: OAuth-style pattern (`?redirect=`) for preserving redirect through login flow
6. **Redirect validation**: Prevent open redirect vulnerabilities by validating against allowed domain

### Technical Implementation

**Environment Variables**:
- `VITE_PLATFORM_BASE_DOMAIN` - Single source of truth for all domain-related configuration
- Cookie domain derived as `.${VITE_PLATFORM_BASE_DOMAIN}` (prefixed with dot for subdomain scope)

**Data Sources**:
- `organizations_projection.slug` - Subdomain for redirect URL construction
- `organizations_projection.subdomain_status` - Must be `'verified'` for subdomain redirect
- `session.claims.org_id` - User's organization ID from JWT

**Files Created/Modified**:
- `frontend/src/lib/supabase-ssr.ts` (NEW) - Cookie-based Supabase client
- `frontend/src/lib/supabase.ts` - Re-export from SSR module
- `frontend/src/services/organization/getOrganizationSubdomainInfo.ts` (NEW) - Query projection
- `frontend/src/utils/redirect-validation.ts` (NEW) - Open redirect prevention
- `frontend/src/pages/auth/LoginPage.tsx` - Post-login redirect logic
- `frontend/src/pages/auth/AuthCallback.tsx` - OAuth redirect handling
- `frontend/src/pages/organizations/AcceptInvitationPage.tsx` - Pass redirect to login
- `frontend/.env.example` - Add `VITE_PLATFORM_BASE_DOMAIN`

### AsyncAPI Contract Status

**No AsyncAPI updates required** - This is a frontend-only change that:
- Reads existing data from `organizations_projection`
- Does not emit any new domain events
- Does not create or modify edge functions

### Plan File Reference

Full implementation plan: `/home/lars/.claude/plans/humming-petting-lecun.md`

---

## Phase 8: Diagnostic Logging (2025-12-17)

### Issue Discovered

Test with `poc-test2-20251217` showed redirect NOT working despite verified subdomain:
- User was NOT redirected to subdomain (expected: `https://poc-test2-20251217.firstovertheline.com/dashboard`)
- User was NOT prompted to re-login (went directly to dashboard)
- User ended up at fallback URL: `/organizations/{id}/dashboard`
- `subdomain_status` WAS `'verified'` in database after bootstrap

### Root Cause Hypotheses

1. **Timing**: `subdomain_status` wasn't `'verified'` at invitation acceptance time (async DNS verification)
2. **Existing session**: Cookie-based session persisted from previous test
3. **Edge function RPC**: `get_organization_by_id` not returning expected fields (`slug`, `subdomain_status`)

### Diagnostic Logging Added

Comprehensive logging was added to trace the redirect flow end-to-end:

#### Edge Function Logging (`accept-invitation/index.ts`)

```typescript
// After querying organization (line 237)
console.log(`[accept-invitation v${DEPLOY_VERSION}] Org query result:`, JSON.stringify({
  orgId: invitation.organization_id,
  slug: orgData?.slug,
  subdomain_status: orgData?.subdomain_status,
  hasOrgData: !!orgData,
}));

// Before redirect decision (line 306)
console.log(`[accept-invitation v${DEPLOY_VERSION}] Redirect decision:`, JSON.stringify({
  condition: {
    hasSlug: !!orgData?.slug,
    slugValue: orgData?.slug,
    subdomainStatus: orgData?.subdomain_status,
    isVerified: orgData?.subdomain_status === 'verified',
    baseDomain: env.PLATFORM_BASE_DOMAIN,
  },
  willUseSubdomain: !!(orgData?.slug && orgData?.subdomain_status === 'verified'),
}));
```

#### Frontend Service Logging (`SupabaseInvitationService.ts`)

```typescript
// After receiving edge function response
log.info('Edge function response received', {
  success: data.success,
  userId: data.userId,
  orgId: data.orgId,
  redirectUrl: data.redirectUrl,
  isAbsoluteUrl: data.redirectUrl?.startsWith('http'),
  isSubdomainRedirect: data.redirectUrl?.includes('.firstovertheline.com'),
});
```

#### AcceptInvitationPage Logging

```typescript
// In handleRedirect
log.info('handleRedirect called', {
  redirectUrl,
  isAbsoluteUrl,
  loginUrl,
  currentLocation: window.location.href,
});
```

#### LoginPage Logging

```typescript
// On component mount (one-time)
log.info('[LoginPage] Component mounted', {
  isAuthenticated,
  loading,
  redirectParam,
  rawRedirectParam: searchParams.get('redirect'),
  hasSession: !!session,
  sessionOrgId: session?.claims?.org_id,
  locationState: location.state,
});
```

### Logging Standards Applied

**Frontend**: Uses `Logger.getLogger('category')` from `@/utils/logger`
- Category `'invitation'` for `SupabaseInvitationService`
- Category `'component'` for React components (`AcceptInvitationPage`, `LoginPage`)

**Edge Functions**: Uses `console.log()` with `[function-name vX]` prefix pattern
- Format: `[accept-invitation v6] Description`
- JSON.stringify for complex objects

### Files Modified

- `infrastructure/supabase/supabase/functions/accept-invitation/index.ts` - Enhanced logging, version v6
- `frontend/src/services/invitation/SupabaseInvitationService.ts` - Response logging
- `frontend/src/pages/organizations/AcceptInvitationPage.tsx` - handleRedirect logging
- `frontend/src/pages/auth/LoginPage.tsx` - Mount state logging

### Deployment Status

- **Commit**: `fb0ab084` - feat(logging): Add diagnostic logging for redirect flow debugging
- **Edge Function**: Version v6 (Supabase version 42)
- **Frontend**: Deployed via GitHub Actions

### Testing Strategy

1. Create new test org: `poc-test3-20251218`
2. Accept invitation with `johnltice@yahoo.com`
3. Check console logs in browser for frontend logging
4. Check Supabase Edge Function logs for redirect decision
5. Identify exact failure point in the redirect flow

### Expected Log Output

If working correctly:
```
[accept-invitation v6] Org query result: {"orgId":"...","slug":"poc-test3-20251218","subdomain_status":"verified","hasOrgData":true}
[accept-invitation v6] Redirect decision: {"condition":{"hasSlug":true,"slugValue":"poc-test3-20251218","subdomainStatus":"verified","isVerified":true,"baseDomain":"firstovertheline.com"},"willUseSubdomain":true}
```

If `subdomain_status` not verified:
```
[accept-invitation v6] Redirect decision: {"condition":{"hasSlug":true,"slugValue":"poc-test3-20251218","subdomainStatus":"verifying","isVerified":false,...},"willUseSubdomain":false}
```

---

## Phase 9: RPC Function Missing subdomain_status (2025-12-18)

### Issue Discovered

Testing with `poc-test1-20251218` confirmed `subdomain_status` was `'verified'` (17:08:19) BEFORE invitation acceptance (17:09:46), ruling out timing issues. Further investigation revealed the real issue.

### Root Cause

The `api.get_organization_by_id` RPC function did NOT include `subdomain_status` in its return columns:

```sql
-- BEFORE (broken) - infrastructure/supabase/sql/03-functions/api/004-organization-queries.sql
CREATE OR REPLACE FUNCTION api.get_organization_by_id(p_org_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  display_name TEXT,
  slug TEXT,
  type TEXT,
  path TEXT,
  parent_path TEXT,
  timezone TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
  -- subdomain_status was MISSING!
)
```

The edge function at line 318 checked `orgData?.subdomain_status === 'verified'`, but since the RPC didn't return that column, it was always `undefined`.

### Fix Applied

Added `subdomain_status` to the RPC function's return type and SELECT list:

```sql
-- AFTER (fixed)
RETURNS TABLE (
  ...
  updated_at TIMESTAMPTZ,
  subdomain_status TEXT  -- Added
)
...
SELECT
  ...
  o.subdomain_status::TEXT  -- Added
FROM organizations_projection o
```

### Files Modified

- `infrastructure/supabase/sql/03-functions/api/004-organization-queries.sql`
  - Added `subdomain_status TEXT` to RETURNS TABLE
  - Added `o.subdomain_status::TEXT` to SELECT

### Migration Applied

```sql
-- Migration: add_subdomain_status_to_get_organization_by_id
DROP FUNCTION IF EXISTS api.get_organization_by_id(UUID);
CREATE OR REPLACE FUNCTION api.get_organization_by_id(p_org_id UUID) ...
```

### Verification

```sql
SELECT * FROM api.get_organization_by_id('a73df31a-b897-4563-a068-53c87719452e'::uuid);
-- Returns: {..., "subdomain_status": "verified"}  ✅
```

### Key Learning

When debugging data flow issues, check the ENTIRE data path:
1. Data exists in source table ✅ (`organizations_projection.subdomain_status = 'verified'`)
2. Data passes through RPC function ❌ (RPC didn't select the column)
3. Data used in edge function ✅ (correctly checked `subdomain_status`)

The diagnostic logging helped narrow down the issue but wasn't strictly necessary - the RPC return type mismatch could have been found by comparing the function definition to its usage.
