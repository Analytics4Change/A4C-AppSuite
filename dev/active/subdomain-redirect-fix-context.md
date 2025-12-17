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
