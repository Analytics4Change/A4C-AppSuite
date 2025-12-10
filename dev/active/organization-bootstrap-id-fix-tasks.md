# Tasks: Organization Bootstrap ID Fix

## Phase 1: Root Cause Verification & Database Fix ✅ IN PROGRESS

### 1.1 Verify Serialization Issue
- [ ] Read `workflows/src/api/routes/workflows.ts` lines 40-80 to inspect workflow start code
- [ ] Check if `organizationId` is in the args object before `client.workflow.start()`
- [ ] Look for any serialization/transformation that might drop the field
- [ ] Check Temporal client version in `package.json` for known issues
- [ ] Add console.log to verify organizationId value before workflow start

### 1.2 Apply Database Migration
- [ ] Review the updated `get_bootstrap_status` function in SQL file
- [ ] Apply migration via Supabase MCP `apply_migration` tool
- [ ] Verify function now returns `domain`, `dns_configured`, `invitations_sent` columns
- [ ] Test the function with a known organizationId

### 1.3 Verify Current Database State
- [x] Query `domain_events` for recent bootstrap events
- [x] Confirm `organization.created` events are missing
- [x] Document ID values used by API vs workflow

## Phase 2: Fix ID Propagation ⏸️ PENDING

### 2.1 Fix Backend API Workflow Start
- [ ] Modify `workflows/src/api/routes/workflows.ts` to ensure organizationId in args
- [ ] Add explicit logging before and after workflow.start()
- [ ] Consider if object spread or destructuring is dropping the field
- [ ] Test locally with port-forwarded Temporal

### 2.2 Fix Activity Idempotency Logic
- [ ] Modify `workflows/src/activities/organization-bootstrap/create-organization.ts`
- [ ] Change idempotency check to NOT return existing.id
- [ ] Instead, verify existing.id matches params.organizationId
- [ ] If mismatch, log warning but use params.organizationId for events
- [ ] Ensure `organization.created` event is emitted

### 2.3 Fix Event Stream IDs
- [ ] Review `workflows/src/shared/utils/emit-event.ts`
- [ ] Ensure all events include organization context
- [ ] Consider adding `organization_id` to event_data for child entities
- [ ] Verify junction events use appropriate stream_id

## Phase 3: Deploy & Validate ⏸️ PENDING

### 3.1 Local Testing
- [ ] Start local Temporal worker with fixes
- [ ] Trigger bootstrap via API (curl or frontend)
- [ ] Check Temporal workflow history for organizationId in input
- [ ] Verify `organization.created` event is emitted
- [ ] Query `api.get_bootstrap_status` with organizationId

### 3.2 Deploy to Development
- [ ] Build and push updated Temporal worker image
- [ ] Deploy via GitHub Actions or kubectl
- [ ] Monitor worker logs for errors
- [ ] Test end-to-end via frontend

### 3.3 End-to-End Validation
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

### Immediate Validation
- [ ] `get_bootstrap_status` function returns all columns
- [ ] Temporal workflow input includes `organizationId` field
- [ ] `organization.created` events appear in `domain_events`

### Feature Complete Validation
- [ ] Status page shows progress through all stages
- [ ] ID is consistent: API ID = Event stream_id = Activity orgId
- [ ] Child entity events include organization context

### Production Stability Validation
- [ ] Multiple bootstrap workflows complete successfully
- [ ] Status polling works for all new organizations
- [ ] No orphaned or mismatched events in database

## Current Status

**Phase**: Phase 1 - Root Cause Verification & Database Fix
**Status**: ✅ IN PROGRESS
**Last Updated**: 2025-12-09
**Next Step**: Apply database migration for `get_bootstrap_status` function

## Diagnostic Evidence (Reference)

### Temporal Workflow History Evidence
```
Workflow: org-bootstrap-poc-test4-20251209-1765334499562
Input: [{"subdomain":"poc-test4-20251209","orgData":{...},"users":[...],"frontendUrl":"..."}]
Note: organizationId is MISSING from input
```

### ID Mismatch Evidence
```
API generated:     4d02fc82-c02c-49f7-81f9-21934ad7fca6
Workflow used:     3efe938a-213a-4ca4-b1d9-761a9f0060f4
Events stream_id:  Various entity-specific IDs
```

### Database Query Evidence
```sql
-- No organization.created events in last 24 hours
SELECT event_type, count(*) FROM domain_events
WHERE created_at > now() - interval '24 hours'
AND event_type = 'organization.created';
-- Result: 0 rows
```

## Commands Reference

### Check Temporal Workflow
```bash
kubectl exec -n temporal deploy/temporal-admin-tools -- \
  tctl workflow show -w org-bootstrap-{subdomain}-{timestamp}
```

### Query Database Events
```sql
SELECT event_type, aggregate_id, stream_id, created_at
FROM domain_events
WHERE created_at > now() - interval '24 hours'
ORDER BY created_at DESC;
```

### Apply Migration (via Supabase MCP)
```
Use mcp__supabase__apply_migration with:
- name: update_get_bootstrap_status_function
- query: [SQL from bootstrap-event-listener.sql]
```
