# Plan: Organization Bootstrap ID Fix

## Problem Summary

The organization bootstrap workflow broke after implementing the unified ID system. Before unification, workflows generated their own IDs and worked correctly. After unification, the API generates an `organizationId` and passes it to Temporal, but the **API validation step is failing before Temporal even starts**.

## Root Cause Analysis

### User-Reported Symptom
Form submission yields a toast error: "organization id could not be validated" - meaning the API fails BEFORE reaching Temporal.

### Evidence
- `organization.bootstrap.initiated` events exist from OLD code (have `bootstrap_id`, missing `temporal_workflow_id`)
- No `organization.created` events exist for recent bootstrap attempts
- Database query shows only seed org in `organizations_projection`
- Temporal workflow input was missing `organizationId` in older tests (OLD deployment)
- New deployment (image `ae1763f`) pulled at 05:01 UTC - test failure occurred AFTER this

### Identified Issues

1. **API Validation Query Failing** (`workflows/src/api/routes/workflows.ts:101-105`)
   - The query to check `organizations_projection` for UUID collision is returning an error
   - Error triggers 500 response: "Failed to validate organization ID"
   - `organizations_projection` has RLS enabled - service role should bypass but may not be working
   - Possible causes: Supabase client config issue, service role key issue, or network problem

2. **Activity Idempotency Bug** (`create-organization.ts:61-63`)
   - When idempotency check finds existing org by slug, returns `existing.id` instead of `params.organizationId`
   - This breaks the unified ID system on retries or when partial data exists

3. **Database Migration** (COMPLETED)
   - `get_bootstrap_status` function updated with `domain`, `dns_configured`, `invitations_sent` columns

## Implementation Plan

### Step 1: Diagnose and Fix the Validation Query (PRIMARY FIX)

**File**: `workflows/src/api/routes/workflows.ts`

**Problem**: The "P0 #1" validation check at lines 95-131 queries `organizations_projection` to check for UUID collision. The query is returning an error (500), not a collision (409).

**Root cause investigation**: The query works via MCP (service role), so the issue is likely:
- The Supabase client in the API is not using service role correctly, OR
- RLS is unexpectedly blocking the query

**Options**:

**Option A: Fix the Query (Recommended if keeping collision check)**
- Check if `getSupabaseClient()` is returning a properly configured service role client
- Add logging to see the exact error message from Supabase
- Ensure RLS policies allow service role access

**Option B: Remove the Query (Simpler)**
- UUID collision probability is 1 in 2^122, astronomically unlikely
- Remove lines 95-131 to eliminate the failure point
- Temporal workflow ID uniqueness already provides collision protection

**Recommendation**: Start with Option A (add more logging), trigger a test, examine logs. If issue persists or is complex, fall back to Option B.

### Step 2: Fix Activity Idempotency Logic (SECONDARY FIX)

**File**: `workflows/src/activities/organization-bootstrap/create-organization.ts`

**Current code (lines 61-64)**:
```typescript
if (existing) {
  console.log(`[CreateOrganization] Organization already exists: ${existing.id}`);
  return existing.id;
}
```

**Fix**: Return `params.organizationId` to maintain unified ID system:
```typescript
if (existing) {
  console.log(`[CreateOrganization] Organization already exists with slug: ${params.subdomain || params.name}`);
  console.log(`[CreateOrganization] Existing ID: ${existing.id}, Requested ID: ${params.organizationId}`);
  // Return the requested organizationId to maintain unified ID system
  return params.organizationId;
}
```

### Step 3: Deploy and Test

1. Build and push new Docker image
2. Restart worker pods
3. Trigger new organization bootstrap via frontend
4. Verify workflow completes and status page works

## Files to Modify

1. `workflows/src/api/routes/workflows.ts` - Remove validation query (lines 95-131)
2. `workflows/src/activities/organization-bootstrap/create-organization.ts` - Fix idempotency return value

## Development Guidelines

- **Run type checks and linting after each major write**: `npm run build` in the `workflows/` directory to catch TypeScript errors early

## Success Criteria

- [ ] API no longer returns 500 "Failed to validate organization ID"
- [ ] Temporal workflow starts successfully
- [ ] `organization.created` events are emitted with correct stream_id
- [ ] Activity returns `params.organizationId` on idempotency hit
- [ ] Status polling works via organizationId
- [ ] Full bootstrap workflow completes successfully
