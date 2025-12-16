# Tasks: Subdomain Redirect Bug Fix

## Phase 1: Code Fix ✅ IN PROGRESS

- [ ] Remove try-catch block around `verifyDNS` in `workflow.ts` (lines 224-233)
- [ ] Build workflow worker (`npm run build`)
- [ ] Verify TypeScript compiles without errors

## Phase 2: Data Repair ⏸️ PENDING

- [ ] Emit `organization.subdomain.verified` event for `liveforlife` org (ID: `15179416-0229-4362-ab39-e754891d9d72`)
- [ ] Verify projection trigger updates `subdomain_status` to `'verified'`
- [ ] Test that `liveforlife.firstovertheline.com` redirects correctly

## Phase 3: Deployment ⏸️ PENDING

- [ ] Build Docker image for worker
- [ ] Push to container registry
- [ ] Apply Kubernetes deployment
- [ ] Verify worker pod is running and connected to Temporal

## Phase 4: Validation ⏸️ PENDING

- [ ] Bootstrap a new test organization with subdomain
- [ ] Observe DNS verification retry behavior in logs
- [ ] Verify `organization.subdomain.verified` event emitted
- [ ] Accept invitation and verify subdomain redirect works

## Success Validation Checkpoints

### Immediate Validation
- [ ] Code compiles without errors
- [ ] `liveforlife` org has `subdomain_status = 'verified'`

### Feature Complete Validation
- [ ] New organizations complete bootstrap with verified subdomain
- [ ] Invitation acceptance redirects to subdomain URL
- [ ] No organizations stuck in `'verifying'` state

## Current Status

**Phase**: 1 - Code Fix
**Status**: ✅ IN PROGRESS
**Last Updated**: 2025-12-15
**Next Step**: Remove try-catch in workflow.ts lines 224-233
