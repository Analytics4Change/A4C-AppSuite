# Tasks: Subdomain Redirect for Subsequent Logins

## Phase 1: Update Frontend Service ✅ COMPLETE

- [x] Update `frontend/src/services/organization/getOrganizationSubdomainInfo.ts`
- [x] Change from direct table query to RPC call
- [x] Use `.schema('api').rpc('get_organization_by_id', {...})`
- [x] Add proper TypeScript types for RPC response
- [x] Verify TypeScript compilation passes

## Phase 2: Deployment and Validation ⏸️ PENDING

- [ ] Commit and push changes
- [ ] Wait for GitHub Actions to deploy frontend
- [ ] Clean up any existing test organizations
- [ ] Bootstrap fresh test organization
- [ ] Accept invitation with test user
- [ ] First login: verify redirect to subdomain
- [ ] Logout
- [ ] Second login: verify redirect to subdomain (this is the fix!)
- [ ] Test OAuth flow (Google) for returning user

## Success Validation Checkpoints

### Immediate Validation
- [x] Frontend service compiles without errors
- [x] Uses existing `api.get_organization_by_id` RPC (no new SQL needed)

### Feature Complete Validation
- [ ] Fresh private browser: login → redirects to subdomain
- [ ] Same browser, logout + login → redirects to subdomain
- [ ] OAuth (Google) returning user → redirects to subdomain
- [ ] User without org_id → graceful fallback to `/clients`

## Bug Analysis

### Root Cause
- `@supabase/ssr` client not correctly including JWT in Authorization header
- Direct table query to `organizations_projection` subject to RLS
- RLS checks `id = get_current_org_id()` which requires JWT
- Query returns 406 (0 rows) due to missing/incorrect JWT

### Evidence
- Auth logs: `"Hook ran successfully"` with `org_id` correctly set
- Console logs: `XHR GET organizations_projection [HTTP/3 406 235ms]`
- Database: User exists with correct `current_organization_id`
- JWT hook simulation: Returns correct `org_id`

### Fix Applied
- Use existing RPC function `api.get_organization_by_id` with SECURITY DEFINER
- SECURITY DEFINER runs as postgres superuser which bypasses RLS
- RPC call doesn't depend on client session state
- **No new SQL needed** - existing function already has everything required

## Current Status

**Phase**: Phase 2 - Deployment and Validation
**Status**: ⏸️ PENDING
**Last Updated**: 2025-12-19
**Next Step**: Commit and push changes, then test in fresh browser
