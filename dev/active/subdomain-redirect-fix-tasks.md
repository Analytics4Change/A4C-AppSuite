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

## Phase 3: Data Repair ✅ COMPLETE

- [x] Emit `organization.subdomain.verified` event for `liveforlife` org (ID: `15179416-0229-4362-ab39-e754891d9d72`)
- [x] Emit `organization.subdomain.verified` event for `poc-test1-20251215` org (ID: `30357e3b-72bc-4b1f-89bb-1f080d612b64`)
- [x] Verify projection trigger updates `subdomain_status` to `'verified'`

## Phase 4: Deployment (PENDING)

- [ ] Commit and push second fix
- [ ] Build Docker image for worker (via GitHub Actions)
- [ ] Verify worker pod is running with new image
- [ ] Bootstrap a new test organization with subdomain
- [ ] Observe DNS verification retry behavior in logs (should see exponential backoff)

## Success Validation Checkpoints

### Immediate Validation
- [x] Code compiles without errors
- [x] `liveforlife` org has `subdomain_status = 'verified'`
- [x] `poc-test1-20251215` org has `subdomain_status = 'verified'`

### Feature Complete Validation
- [ ] New organizations complete bootstrap with verified subdomain
- [ ] DNS retry loop shows exponential backoff in logs (10s, 20s, 40s, ...)
- [ ] Invitation acceptance redirects to subdomain URL
- [ ] No organizations stuck in `'verifying'` state

## Bug Analysis

### Bug 1 (Fixed in b6e8d836)
- **Issue**: try-catch around `verifyDNS` swallowed errors
- **Fix**: Remove try-catch, let errors propagate to DNS retry loop

### Bug 2 (Fixed now)
- **Issue**: `dnsSuccess = true` set before `verifyDNS()` in retry loop
- **Effect**: Loop condition `!dnsSuccess` was false, loop exited immediately
- **Fix**: Move `dnsSuccess = true` to after `verifyDNS()` succeeds

## Current Status

**Phase**: Deployment pending
**Last Updated**: 2025-12-16
**Previous Commit**: b6e8d836 - fix(workflows): Allow verifyDNS errors to propagate for retry
**Pending Commit**: Move dnsSuccess assignment after verifyDNS succeeds
