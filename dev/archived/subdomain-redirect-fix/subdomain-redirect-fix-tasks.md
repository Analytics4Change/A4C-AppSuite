# Tasks: Subdomain Redirect Bug Fix

## Phase 1: Initial Code Fix ✅ COMPLETE

- [x] Remove try-catch block around `verifyDNS` in `workflow.ts` (lines 224-233)
- [x] Build workflow worker (`npm run build`)
- [x] Verify TypeScript compiles without errors
- [x] Deploy via GitHub Actions (commit b6e8d836)

## Phase 2: Second Bug Fix - Retry Loop Exit ✅ COMPLETE

**Issue discovered**: `dnsSuccess = true` was set BEFORE `verifyDNS()`, causing retry loop to exit immediately after first failure.

- [x] Move `dnsSuccess = true` to AFTER `verifyDNS()` succeeds (line 229)
- [x] Build workflow worker (`npm run build`)
- [x] Verify TypeScript compiles without errors
- [x] Commit and push fix (commit f3417a61)
- [x] Deploy via GitHub Actions (Run 20254682499)
- [x] Verify worker pod running with new image

## Phase 3: Data Repair ✅ COMPLETE

- [x] Emit `organization.subdomain.verified` event for `liveforlife` org (ID: `15179416-0229-4362-ab39-e754891d9d72`)
- [x] Emit `organization.subdomain.verified` event for `poc-test1-20251215` org (ID: `30357e3b-72bc-4b1f-89bb-1f080d612b64`)
- [x] Verify projection trigger updates `subdomain_status` to `'verified'`

## Phase 4: Validation ✅ COMPLETE

- [x] Bootstrap test org `poc-test2-20251215` with subdomain
- [x] Verify `subdomain_status = 'verified'` automatically (no manual intervention!)
- [x] DNS verified at: 02:52:34 (17 seconds after bootstrap initiated at 02:52:17)
- [x] `organization.subdomain.verified` event emitted by workflow
- [x] Clean up test orgs via `/org-cleanup`

## Success Validation Checkpoints ✅ ALL PASSED

### Immediate Validation
- [x] Code compiles without errors
- [x] `liveforlife` org has `subdomain_status = 'verified'`
- [x] `poc-test1-20251215` org repaired (manually emitted event)

### Feature Complete Validation
- [x] New organizations complete bootstrap with verified subdomain (`poc-test2-20251215` verified automatically!)
- [x] DNS verification succeeds within retry window (~17 seconds)
- [x] `organization.subdomain.verified` event emitted by workflow
- [x] No manual intervention required for new orgs

## Bug Analysis

### Bug 1 (Fixed in b6e8d836)
- **Issue**: try-catch around `verifyDNS` swallowed errors
- **Fix**: Remove try-catch, let errors propagate to DNS retry loop

### Bug 2 (Fixed in f3417a61)
- **Issue**: `dnsSuccess = true` set before `verifyDNS()` in retry loop
- **Effect**: Loop condition `!dnsSuccess` was false, loop exited immediately after first failure
- **Fix**: Move `dnsSuccess = true` to after `verifyDNS()` succeeds (line 229)

## Current Status

**Phase**: ✅ COMPLETE
**Last Updated**: 2025-12-16
**Commits**:
- `b6e8d836` - fix(workflows): Allow verifyDNS errors to propagate for retry
- `f3417a61` - fix(workflows): Move dnsSuccess flag after verifyDNS succeeds
**Worker Image**: `ghcr.io/analytics4change/a4c-workflows:f3417a6`

## Ready to Archive

This feature is complete. The subdomain redirect bug has been fixed and validated:
1. Two bugs were identified and fixed
2. Manual data repair was performed for existing orgs
3. New orgs now automatically get `subdomain_status = 'verified'`
4. Test validated with `poc-test2-20251215` (17 second verification time)

To archive: `git mv dev/active/subdomain-redirect-fix-*.md dev/archived/subdomain-redirect-fix/`

---

## Phase 5: Follow-on - org-cleanup Bug Fix ✅ COMPLETE (2025-12-16)

**Issue**: `/org-cleanup` wasn't cleaning `public.users` (shadow table), leaving orphaned records

- [x] Investigate 500 error on `poc-test3-20251215` invitation acceptance
- [x] Identify root cause: orphaned users in `public.users` and `auth.users`
- [x] Clean up orphaned `johnltice@yahoo.com` from `public.users` (2 records)
- [x] Clean up orphaned `johnltice@yahoo.com` from `auth.users` (1 record from poc-test2)
- [x] Update `/org-cleanup` command to add shadow user discovery (Step 1.6)
- [x] Update `/org-cleanup` command to delete from `public.users` first (Step 3.1)
- [x] Update `/org-cleanup-dryrun` to match

## Phase 6: accept-invitation Edge Function Fix ⏸️ PENDING

**Issue**: Edge function returns 500 when user already exists instead of handling gracefully

- [ ] Handle `email_exists` error code from `supabase.auth.admin.createUser()`
- [ ] Look up existing user by email using admin API
- [ ] Use existing user's ID to continue with invitation acceptance
- [ ] Deploy updated edge function (currently at v6, incomplete)
- [ ] Test with existing user accepting invitation to new org

## Phase 7: Cross-Subdomain Session Sharing ✅ COMPLETE

**Issue**: Users redirected to `/clients` instead of org subdomain after login (localStorage is domain-scoped)

- [x] Install `@supabase/ssr` dependency
- [x] Create `frontend/src/lib/supabase-ssr.ts` with cookie-based client
- [x] Update `frontend/src/lib/supabase.ts` to re-export from SSR module
- [x] Create `frontend/src/services/organization/getOrganizationSubdomainInfo.ts`
- [x] Create `frontend/src/utils/redirect-validation.ts`
- [x] Update `frontend/src/pages/auth/LoginPage.tsx` with redirect logic
- [x] Update `frontend/src/pages/auth/AuthCallback.tsx` for OAuth flow
- [x] Update `frontend/src/pages/organizations/AcceptInvitationPage.tsx`
- [x] Update `frontend/.env.example` with `VITE_PLATFORM_BASE_DOMAIN`
- [x] Test end-to-end: invitation acceptance → login → subdomain redirect
- [x] Test returning user: login → subdomain redirect

## Phase 8: Diagnostic Logging ✅ COMPLETE (2025-12-17)

**Issue**: Test with `poc-test2-20251217` showed redirect NOT working:
- User was NOT redirected to subdomain
- User went directly to `/organizations/{id}/dashboard` (fallback path)
- `subdomain_status` was `'verified'` in database

**Root cause hypotheses**:
1. `subdomain_status` wasn't `'verified'` at invitation acceptance time (timing issue)
2. Existing session from previous test persisted in cookies
3. Edge function RPC `get_organization_by_id` not returning expected fields

**Tasks Completed**:
- [x] Add enhanced logging to `accept-invitation` edge function (v6)
  - Log org query result (slug, subdomain_status, hasOrgData)
  - Log redirect decision conditions and outcome
- [x] Add logging to `SupabaseInvitationService.ts` - edge function response
- [x] Add logging to `AcceptInvitationPage.tsx` - handleRedirect with URL analysis
- [x] Add logging to `LoginPage.tsx` - component mount state (auth, redirect params, session)
- [x] Commit and push changes (fb0ab084)
- [x] Deploy edge function via MCP (v6, version 42)
- [x] Clean up `poc-test2-20251217` organization

## Phase 9: RPC Function Fix ✅ COMPLETE (2025-12-18)

**Issue**: `api.get_organization_by_id` RPC function was missing `subdomain_status` in return columns

- [x] Investigate why `poc-test1-20251218` redirect failed despite `subdomain_status = 'verified'`
- [x] Compare domain_events timeline (subdomain verified 17:08:19, user created 17:09:46)
- [x] Discover RPC function missing `subdomain_status` column
- [x] Fix `api.get_organization_by_id` to include `subdomain_status TEXT`
- [x] Apply migration via Supabase MCP
- [x] Verify fix with SQL query
- [x] Test subdomain redirect with new test org (UAT passed)

## Current Status

**Phase**: ✅ ALL PHASES COMPLETE - ARCHIVED
**Last Updated**: 2025-12-18
**Result**: Subdomain redirect feature fully functional and validated via UAT

### Recent Commits
- `fb0ab084` - feat(logging): Add diagnostic logging for redirect flow debugging
- `cfe58a55` - fix(commands): Add public.users shadow table to org-cleanup
- (pending) - fix(db): Add subdomain_status to get_organization_by_id RPC

### Root Cause (Phase 9)
The `api.get_organization_by_id` RPC function did NOT return `subdomain_status`, so the edge function's check `orgData?.subdomain_status === 'verified'` was always `undefined`.

### Fix Applied
- Added `subdomain_status TEXT` to RPC function's RETURNS TABLE
- Added `o.subdomain_status::TEXT` to SELECT query
- Migration applied: `add_subdomain_status_to_get_organization_by_id`

### Implementation Summary
- Cookie-based sessions via `@supabase/ssr` with parent domain scope (`.{PLATFORM_BASE_DOMAIN}`)
- Post-login redirect logic queries `organizations_projection` for subdomain info
- Redirect URL preservation via `?redirect=` query param (OAuth-style pattern)
- Open redirect prevention with domain validation
- **RPC function now returns subdomain_status** for edge function redirect decision

### Edge Function Status
- `accept-invitation` at v6 (Supabase version 42)
- Contains comprehensive logging for redirect debugging

### Deferred Work (Phase 6) - BACKLOG ITEM
- accept-invitation edge function fix for existing users
- Handle `email_exists` error by looking up existing user instead of returning 500
- Lower priority: only affects edge case of same email accepting invitations to multiple orgs
- Tracked separately from subdomain redirect feature
