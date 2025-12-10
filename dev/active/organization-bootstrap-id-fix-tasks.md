# Tasks: Organization Bootstrap ID Fix

## Phase 1: Root Cause Verification & Database Fix ✅ COMPLETE

### 1.1 Verify Serialization Issue
- [x] Read `workflows/src/api/routes/workflows.ts` lines 40-80 to inspect workflow start code
- [x] Check if `organizationId` is in the args object before `client.workflow.start()`
- [x] Look for any serialization/transformation that might drop the field
- [x] Identified: Issue was UUID collision validation query failing (lines 95-131)
- [x] Console logging already present showed query error, not serialization issue

### 1.2 Apply Database Migration
- [x] Review the updated `get_bootstrap_status` function in SQL file
- [x] Apply migration via Supabase MCP `apply_migration` tool
- [x] Verify function now returns `domain`, `dns_configured`, `invitations_sent` columns
- [x] Function tested and working

### 1.3 Verify Current Database State
- [x] Query `domain_events` for recent bootstrap events
- [x] Confirm `organization.created` events are missing
- [x] Document ID values used by API vs workflow
- [x] Verified RLS policies on `organizations_projection` - service role should bypass

## Phase 2: Fix ID Propagation ✅ COMPLETE

### 2.1 Fix Backend API Workflow Start
- [x] Removed UUID collision validation query (lines 95-131) - was causing 500 error
- [x] UUID collision probability is 1 in 2^122 - Temporal workflow ID provides collision protection
- [x] Commit: `e38e1ba1`

### 2.2 Fix Activity Idempotency Logic
- [x] Modified `workflows/src/activities/organization-bootstrap/create-organization.ts`
- [x] Changed idempotency check to return `params.organizationId` instead of `existing.id`
- [x] Added logging for debugging: shows existing ID vs requested ID
- [x] Ensures unified ID system works on activity retries

### 2.3 Fix Event Stream IDs
- [x] No changes needed - `emit-event.ts` already uses `aggregate_id` as `stream_id`
- [x] The fix in create-organization.ts ensures correct `organizationId` flows through

## Phase 3: Deploy & Validate ✅ COMPLETE

### 3.1 Build and Deploy
- [x] Build TypeScript code (`npm run build` in workflows/)
- [x] Commit changes with descriptive message
- [x] Push to main branch
- [x] GitHub Actions workflows triggered:
  - Deploy Temporal Workers: ✅ Success
  - Deploy Temporal Backend API: ✅ Success

### 3.2 Verify Deployment
- [x] `workflow-worker` pod running with image `e38e1ba` (matches commit)
- [x] `temporal-api` pods running (2 replicas)
- [x] All pods in `Running` status

### 3.3 End-to-End Validation ⏸️ AWAITING USER TEST
- [ ] Create new organization via frontend
- [ ] Verify status page shows real-time progress
- [ ] Confirm all 7 stages are tracked:
  - [ ] Stage 1: Organization creation
  - [ ] Stage 2: DNS configuration
  - [ ] Stage 3: DNS propagation wait
  - [ ] Stage 4: DNS verification
  - [ ] Stage 5: Invitation generation
  - [ ] Stage 6: Email sending
  - [ ] Stage 7: Organization activation
- [ ] Verify no "Workflow not found" errors

## Success Validation Checkpoints

### Immediate Validation ✅
- [x] `get_bootstrap_status` function returns all columns (verified via MCP)
- [x] UUID collision check removed (no more 500 error)
- [x] Activity returns `params.organizationId` on idempotency hit

### Feature Complete Validation ⏸️ PENDING USER TEST
- [ ] Status page shows progress through all stages
- [ ] ID is consistent: API ID = Event stream_id = Activity orgId
- [ ] Child entity events include organization context

### Production Stability Validation ⏸️ PENDING
- [ ] Multiple bootstrap workflows complete successfully
- [ ] Status polling works for all new organizations
- [ ] No orphaned or mismatched events in database

## Current Status

**Phase**: Phase 3 - Deploy & Validate
**Status**: ✅ DEPLOYED - Awaiting User Test
**Last Updated**: 2025-12-10
**Next Step**: User should test organization bootstrap from frontend and verify status page works

## Implementation Summary

### Root Cause
The unified ID system broke because:
1. UUID collision validation query (lines 95-131) was failing with RLS issues, returning 500 "Failed to validate organization ID"
2. Activity idempotency returned `existing.id` instead of `params.organizationId`, breaking ID consistency on retries

### Fix Applied
1. **Removed UUID collision check** - Probability is 1 in 2^122, Temporal workflow ID uniqueness provides sufficient protection
2. **Fixed idempotency return** - Activity now returns `params.organizationId` to maintain unified ID system

### Files Modified
- `workflows/src/api/routes/workflows.ts` - Removed lines 95-131 (UUID collision check)
- `workflows/src/activities/organization-bootstrap/create-organization.ts` - Fixed idempotency return value (lines 61-67)

### Deployment
- Commit: `e38e1ba1`
- Image: `ghcr.io/analytics4change/a4c-workflows:e38e1ba`
- Both `Deploy Temporal Workers` and `Deploy Temporal Backend API` workflows completed successfully

## Commands Reference

### Check Temporal Workflow
```bash
kubectl exec -n temporal deploy/temporal-admin-tools -- \
  tctl workflow show -w org-bootstrap-{organizationId}
```

### Query Database Events
```sql
SELECT event_type, aggregate_id, stream_id, created_at
FROM domain_events
WHERE created_at > now() - interval '24 hours'
ORDER BY created_at DESC;
```

### Check Pod Status
```bash
kubectl get pods -n temporal -l app=workflow-worker
kubectl get pods -n temporal -l app=temporal-api
```

### View Worker Logs
```bash
kubectl logs -n temporal deploy/workflow-worker --tail=100
```
