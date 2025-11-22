# Phase 4.1: Workflow Verification Context

**Created**: 2025-11-21
**Updated**: 2025-11-22
**Status**: INFRASTRUCTURE FIXES COMPLETE - Resume workflow planning complete
**Purpose**: Verify organization bootstrap workflow with new parameter structure and fix infrastructure issues

---

## Overview

Phase 4.1 tests the organization bootstrap workflow after moving contacts/addresses/phones to arrays and making subdomain optional. During testing, we discovered and fixed critical infrastructure issues with PostgREST schema access, database column mismatches, event type constraints, and Temporal serialization.

---

## Key Decisions

### 1. **PostgREST Schema Architecture**
Supabase PostgREST only exposes the `api` schema by default, not `public` schema. All table access from workflow activities must use RPC functions with `SECURITY DEFINER` in the `api` schema.

**Decision**: Create RPC wrapper functions in `api` schema for all projection table queries.
- **Why**: Direct `.from('table_name')` calls fail with "schema must be one of the following: api"
- **Impact**: Requires migration file + activity code updates
- **Date**: 2025-11-21

### 2. **Database Column Schema Mismatch**
The `organizations_projection` table uses different column names than expected:
- Uses: `is_active` (boolean), `deactivated_at`, `deleted_at`
- Expected: `status` (text), `activated_at`

**Decision**: Update RPC functions and activities to use actual database schema.
- **Why**: RPC functions were written based on assumptions, not actual schema
- **Impact**: Required dropping/recreating RPC functions, updating activities
- **Date**: 2025-11-21

### 3. **Event Type Naming Convention**
Database has CHECK constraint requiring lowercase with dots: `^[a-z_]+(\.[a-z_]+)+`

**Decision**: Change all PascalCase event types to lowercase.with.dots
- **Why**: Constraint violation errors on events like `'UserInvited'`, `'DNSConfigured'`
- **Required**: `'user.invited'`, `'organization.dns.configured'`, etc.
- **Date**: 2025-11-21

### 4. **DNS Activity Aggregate IDs**
DNS activities (`verifyDNS`, `removeDNS`) were using subdomain strings as UUID aggregate_ids, causing "invalid input syntax for type uuid" errors.

**Decision**: Add `orgId` parameter to DNS activities and use it as aggregate_id.
- **Why**: Event store requires UUID aggregate_ids, not strings
- **Impact**: Updated type definitions, activity implementations, workflow calls
- **Date**: 2025-11-21

### 5. **Temporal Date Serialization**
Temporal JSON-serializes data passed between activities. `Date` objects become ISO strings, breaking `.toLocaleDateString()` calls.

**Decision**: Convert deserialized dates with `new Date(invitation.expiresAt)` before calling Date methods.
- **Why**: `invitation.expiresAt` arrives as string `"2025-11-28T22:39:07.000Z"`, not Date object
- **Impact**: Updated email template builders
- **Date**: 2025-11-21

### 6. **Worker Logging Strategy**
Added `tee` command to worker startup script to log both console and file for debugging.

**Decision**: Create `/tmp/run-worker-local.sh` that logs to `/tmp/worker-output.log`
- **Why**: User requested not having to copy-paste terminal output for error analysis
- **Impact**: Easier debugging, persistent logs
- **Date**: 2025-11-21

### 7. **Resume Workflow Strategy**
After discovering that failed workflows cannot simply be retried (soft-deleted resources aren't recreated), designed comprehensive resume workflow architecture.

**Decision**: Create dedicated `organizationBootstrapResumeWorkflow` to handle recovery from any activity failure
- **Why**: Retrying original workflow returns early when finding soft-deleted org, doesn't recreate contacts/addresses/phones
- **Impact**: Requires new workflow + 2 new activities + admin UI + event types
- **Implementation**: Phased approach over 6-10 days
- **Date**: 2025-11-22
- **Document**: `dev/active/resume-workflow-implementation-plan.md`

---

## Infrastructure Changes

### New Files Created

#### SQL Migrations
- `infrastructure/supabase/sql/03-functions/workflows/001-organization-idempotency-checks.sql`
  - RPC functions: `check_organization_by_slug`, `check_organization_by_name`
  - Purpose: Idempotency checks for createOrganization activity
  - Date: 2025-11-21

- `infrastructure/supabase/sql/03-functions/workflows/002-emit-domain-event.sql`
  - RPC function: `emit_domain_event` with stream versioning
  - Purpose: PostgREST can't access `public.domain_events` directly
  - Date: 2025-11-21

- `infrastructure/supabase/sql/03-functions/workflows/003-projection-queries.sql`
  - 8 RPC functions for projection table access
  - Functions: `get_pending_invitations_by_org`, `get_invitation_by_org_and_email`, `get_organization_status`, `update_organization_status`, `get_organization_name`, `get_contacts_by_org`, `get_addresses_by_org`, `get_phones_by_org`
  - Purpose: Activities need to query projections via `api` schema
  - **FIXED**: Corrected to use `is_active` instead of `status`
  - Date: 2025-11-21

#### Applied Migrations
- `add_projection_query_rpc_functions` - Initial 8 RPC functions
- `fix_projection_query_rpc_columns_v2` - Fixed column names (status → is_active)
- Applied to: Supabase development environment

#### Helper Scripts
- `/tmp/run-worker-local.sh`
  - Worker startup with logging to `/tmp/worker-output.log`
  - Sets `TEMPORAL_TASK_QUEUE=bootstrap-local` to avoid k8s worker conflicts
  - Clears ts-node cache
  - Date: 2025-11-21

### Existing Files Modified

#### Activity Files (PostgREST Schema Fixes)
All updated to use `.schema('api').rpc(...)` instead of direct table access:

1. **`src/activities/organization-bootstrap/create-organization.ts`**
   - Lines 41, 49: Added `.schema('api')` to RPC calls
   - Lines 71-89: Fixed organization event to match AsyncAPI contract (slug, path, not status/parent_org_id)
   - Lines 99-127: Removed redundant entity IDs, fixed junction stream_type
   - Date: 2025-11-21

2. **`src/activities/organization-bootstrap/activate-organization.ts`**
   - Lines 34-48: Changed to RPC call `get_organization_status`
   - Lines 50-67: Use `is_active` instead of `status`
   - Lines 70-76: RPC call `update_organization_status` with `p_is_active: true`
   - Lines 85-96: Event data uses `previous_is_active`
   - Date: 2025-11-21

3. **`src/activities/organization-bootstrap/deactivate-organization.ts`**
   - Lines 40-51: RPC call for status check
   - Lines 58-76: Check `is_active` + `deleted_at`
   - Lines 80-87: RPC call with `p_is_active: false, p_deactivated_at, p_deleted_at`
   - Lines 97-108: Event data uses `previous_is_active`
   - Date: 2025-11-21

4. **`src/activities/organization-bootstrap/revoke-invitations.ts`**
   - Lines 41-45: RPC call `get_pending_invitations_by_org`
   - Date: 2025-11-21

5. **`src/activities/organization-bootstrap/delete-contacts.ts`**
   - Lines 33-37: RPC call `get_contacts_by_org`
   - Date: 2025-11-21

6. **`src/activities/organization-bootstrap/delete-addresses.ts`**
   - Lines 33-37: RPC call `get_addresses_by_org`
   - Date: 2025-11-21

7. **`src/activities/organization-bootstrap/delete-phones.ts`**
   - Lines 33-37: RPC call `get_phones_by_org`
   - Date: 2025-11-21

8. **`src/activities/organization-bootstrap/generate-invitations.ts`**
   - Lines 59-66: RPC call `get_invitation_by_org_and_email`
   - Line 85: Event type `'user.invited'` (was `'UserInvited'`)
   - Date: 2025-11-21

9. **`src/activities/organization-bootstrap/send-invitation-emails.ts`**
   - Lines 153-157: RPC call `get_organization_name`
   - Lines 47, 118: Added `new Date()` conversion for Temporal serialization fix
   - Line 179: Event type `'invitation.email.sent'` (was `'InvitationEmailSent'`)
   - Date: 2025-11-21

#### Activity Files (DNS UUID Fixes)
Added `orgId` parameter to DNS activities:

10. **`src/activities/organization-bootstrap/verify-dns.ts`**
    - Line 43: Use `params.orgId` as aggregate_id (was `params.domain`)
    - Line 70: Same for production mode
    - Date: 2025-11-21

11. **`src/activities/organization-bootstrap/remove-dns.ts`**
    - Lines 66, 93, 117: Use `params.orgId` as aggregate_id (was `params.subdomain`)
    - Date: 2025-11-21

#### Activity Files (Event Type Fixes)
12. **`src/activities/organization-bootstrap/configure-dns.ts`**
    - Lines 69, 102: Event type `'organization.dns.configured'` (was `'DNSConfigured'`)
    - Line 104: Aggregate type lowercase `'organization'`
    - Date: 2025-11-21

#### Workflow File
13. **`src/workflows/organization-bootstrap/workflow.ts`**
    - Line 153: Pass `orgId` to `verifyDNS`
    - Line 299: Pass `orgId` to `removeDNS`
    - Date: 2025-11-21

#### Shared Files
14. **`src/shared/types/index.ts`**
    - Lines 201-203: Added `orgId: string` to `VerifyDNSParams`
    - Lines 264-266: Added `orgId: string` to `RemoveDNSParams`
    - Date: 2025-11-21

15. **`src/shared/utils/emit-event.ts`**
    - Lines 109-124: Changed from direct table insert to RPC call `emit_domain_event`
    - Date: 2025-11-21

---

## Important Constraints

### PostgREST Schema Exposure
- **Constraint**: Supabase PostgREST only exposes schemas configured in settings (default: `api` only)
- **Impact**: Cannot query `public` schema tables directly from activities using service role key
- **Workaround**: All table access must go through RPC functions in `api` schema with `SECURITY DEFINER`
- **Discovered**: 2025-11-21

### Event Type Validation
- **Constraint**: Database CHECK constraint on `domain_events.event_type`: `^[a-z_]+(\.[a-z_]+)+`
- **Impact**: All event types must be lowercase with dots (e.g., `'organization.created'`)
- **Violation**: PascalCase types like `'UserInvited'` fail with constraint violation
- **Discovered**: 2025-11-21

### Temporal Serialization Behavior
- **Constraint**: Temporal JSON-serializes all data passed between workflow and activities
- **Impact**: `Date` objects become ISO strings, lose Date prototype methods
- **Workaround**: Reconstruct Date objects with `new Date(serializedValue)` before calling Date methods
- **Discovered**: 2025-11-21 (email template error: `toLocaleDateString is not a function`)

### Stream Versioning Requirements
- **Constraint**: `domain_events.stream_version` must auto-increment per (stream_id, stream_type)
- **Impact**: RPC function `emit_domain_event` calculates version with `COALESCE(MAX(stream_version), 0) + 1`
- **Discovered**: 2025-11-21 (during AsyncAPI contract alignment)

### Task Queue Isolation
- **Constraint**: Multiple workers can connect to same Temporal server with different task queues
- **Impact**: Remote k8s worker was picking up local test workflows on `bootstrap` queue
- **Workaround**: Use `bootstrap-local` queue for local testing to avoid conflicts
- **Discovered**: 2025-11-21 (environment variables showed in Docker container path)

---

## Test Results

### Test Case A: Provider Organization (Full Structure)
**Status**: ⚠️ WORKFLOW COMPLETED WITH EMAIL FAILURE

**Expected**:
- 3 contacts, 3 addresses, 3 phones
- DNS configured and verified
- 1 invitation sent
- Organization activated

**Actual Results**:
✅ Organization created: `e77a6dc4-8491-4054-967f-e1b40fcd4725`
- Name: "Test Healthcare Provider"
- Slug: "test-provider-001"
- Type: "provider"
- Status: Active (is_active: true)

✅ Related Entities:
- 3 contacts created and linked
- 3 addresses created and linked
- 3 phones created and linked

✅ DNS:
- Configured: `organization.dns.configured`
- Verified: `organization.dns.verified`

✅ Workflow Steps:
- Step 1: Organization created
- Step 2: DNS configured & verified
- Step 3: Invitations generated
- Step 4: Invitation emails sent (1 failed - Date serialization issue)
- Step 5: Organization activated

✅ Domain Events Emitted:
- `organization.dns.configured`
- `organization.dns.verified`
- `organization.contact.linked` (×3)
- `organization.address.linked` (×3)
- `organization.phone.linked` (×3)
- `user.invited`
- `organization.activated`

**Known Issues**:
- ⚠️ Email sending shows "0 sent, 1 failed" (development mode - expected, no real SMTP)
- ✅ FIXED: Date serialization issue in email templates

**Compensation Test**:
- Workflow failed on first attempts, compensation ran successfully
- Removed DNS records
- Deleted contacts, addresses, phones
- Deactivated organization
- All compensation activities completed without errors

### Test Case B: Stakeholder Partner
**Status**: NOT STARTED

### Test Case C: VAR Partner
**Status**: NOT STARTED

---

## Issues Encountered & Resolved

### 1. PostgREST Schema Error ✅ RESOLVED
**Error**: "The schema must be one of the following: api"
**Attempts**:
- Tried changing column names (subdomain → slug)
- Tried adding `db: { schema: 'public' }` to Supabase client
- Tried direct PostgreSQL connection (failed - JWT not password)
- Created RPC functions in public schema (didn't work)

**Root Cause**: PostgREST only exposes `api` schema
**Solution**: Created RPC functions in `api` schema with `SECURITY DEFINER`, added `.schema('api')` to activity calls

### 2. RPC Function Column Mismatch ✅ RESOLVED
**Error**: "column o.status does not exist"
**Root Cause**: RPC functions used `status`, `activated_at` but table has `is_active`, `deactivated_at`
**Solution**:
- Dropped and recreated RPC functions with correct column names
- Updated activities to use `is_active` boolean instead of `status` text
- Applied migration `fix_projection_query_rpc_columns_v2`

### 3. Event Type Constraint Violations ✅ RESOLVED
**Error**: "violates check constraint 'valid_event_type'"
**Violations Found**:
- `'DNSConfigured'` → `'organization.dns.configured'`
- `'DNSVerified'` → `'organization.dns.verified'`
- `'DNSRemoved'` → `'organization.dns.removed'`
- `'OrganizationActivated'` → `'organization.activated'`
- `'OrganizationDeactivated'` → `'organization.deactivated'`
- `'UserInvited'` → `'user.invited'`
- `'InvitationEmailSent'` → `'invitation.email.sent'`
- `'InvitationRevoked'` → `'invitation.revoked'`

**Solution**: Batch updated all event types with sed, rebuilt worker

### 4. DNS UUID Error ✅ RESOLVED
**Error**: "invalid input syntax for type uuid: 'test-provider-001'"
**Root Cause**: DNS activities used subdomain string as aggregate_id
**Solution**:
- Added `orgId` parameter to `VerifyDNSParams` and `RemoveDNSParams`
- Updated activities to use `params.orgId` as aggregate_id
- Updated workflow to pass `orgId` to DNS activities

### 5. Temporal Date Serialization ✅ RESOLVED
**Error**: "invitation.expiresAt.toLocaleDateString is not a function"
**Root Cause**: Temporal serializes Date objects to ISO strings
**Solution**: Added `new Date()` conversion in email template builders before calling `.toLocaleDateString()`

### 6. AsyncAPI Contract Misalignment ✅ RESOLVED
**Mismatches Found**:
- Organization event: Added `slug`, `path`; removed `status`, `parent_org_id`
- Junction events: Changed `stream_type` from `'organization'` to `'junction'`
- Removed redundant entity IDs from event data
- Field naming: `zipCode` → `zip_code` (already correct)
- Stream versioning: Implemented auto-increment in RPC function

**Solution**: Updated `create-organization.ts` to match AsyncAPI contract exactly

---

## Reference Materials

### Supabase Resources
- **Database Schema**: https://app.supabase.com/projects/tmrjlswbsxmbglmaclxu/database/tables
- **API Settings**: https://app.supabase.com/projects/tmrjlswbsxmbglmaclxu/settings/api
- **PostgREST Docs**: https://postgrest.org/en/stable/api.html#custom-queries

### Temporal Resources
- **Web UI**: `kubectl port-forward -n temporal svc/temporal-web 8080:8080`
- **Worker Logs**: `/tmp/worker-output.log`
- **Workflow Type**: `organizationBootstrapWorkflow`

### AsyncAPI Contract
- **File**: `infrastructure/supabase/contracts/asyncapi/asyncapi.yaml`
- **Authority**: AsyncAPI contract is the authoritative event schema definition

### Event Type Constraint
- **Pattern**: `^[a-z_]+(\.[a-z_]+)+`
- **Requires**: Lowercase letters, underscores, dots
- **Examples**: `organization.created`, `user.invited`, `invitation.email.sent`

---

## Session Summary (2025-11-22)

### What We Learned
1. **Temporal Workflow Idempotency** - Confirmed three-layer approach:
   - Layer 1: Workflow ID (Temporal built-in)
   - Layer 2: Activity check-then-act (business keys like slug, email)
   - Layer 3: Event deduplication (database constraints)

2. **DNS as Activity** - Confirmed DNS configuration is correctly implemented as activities (not workflows) because:
   - Involves side effects (Cloudflare API calls)
   - Non-deterministic operations (network calls)
   - Needs retry logic for transient failures

3. **Saga Compensation Flow** - Traced complete failure sequence for DNS exhaustion:
   - 7 retry attempts over ~20 minutes
   - Compensation runs in reverse order
   - Organization soft-deleted but preserves audit trail

4. **Resume Workflow Necessity** - Discovered retrying original workflow is broken:
   - Finds soft-deleted org by slug → Returns early
   - Contacts/addresses/phones NOT recreated
   - Organization activated but EMPTY
   - **Solution**: Dedicated resume workflow (6-10 day implementation)

### Documents Created
- ✅ `dev/active/resume-workflow-implementation-plan.md` - Comprehensive 13-section plan
- ✅ Committed with detailed implementation phases

### Git Commits
- `02dad64f` - Phase 4.1 infrastructure fixes (20 files, 1530 insertions)
- `f186279a` - Resume workflow implementation plan (1661 lines)

---

## Next Actions

### Immediate Options (User Choice)
**Option A: Continue Phase 4.1 Testing**
1. Investigate email failure (dev mode limitation vs real issue)
2. Run Test Case B (Stakeholder Partner - no subdomain)
3. Run Test Case C (VAR Partner - with subdomain)
4. Verify all event-driven projections update correctly
5. Proceed to Phase 4.2: Event Emission Verification

**Option B: Implement Resume Workflow**
1. Start Phase 1 of resume workflow (1-2 days)
   - Implement `detectOrganizationState` activity
   - Implement `reactivateOrganizationAndResources` activity
   - Build core resume workflow for DNS failures
2. Test with Phase 4.1 failed workflow scenarios
3. Continue with Phases 2-4 per plan

**Option C: Other Work**
- Provider onboarding enhancement (parked)
- Other features in backlog

### Recommended Next Step
**Complete Phase 4.1 testing first** (Option A), then implement resume workflow (Option B) as a separate feature.

**Rationale**:
- Phase 4.1 infrastructure fixes are complete
- Resume workflow can be tested against Phase 4.1 failures
- Clean separation of testing vs implementation work
