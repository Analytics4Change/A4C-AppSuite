# AsyncAPI Contract Alignment - Context

**Feature**: Fix silent form submission failures by aligning AsyncAPI contract, Edge Function, and frontend types

**Date Started**: 2025-11-25
**Last Updated**: 2025-11-26
**Status**: Phase 6 - Production Testing BLOCKED (form submission not calling Edge Function)

## Problem Statement

### Root Cause
Data contract mismatch between frontend and Edge Function caused silent failures when creating organizations via the hosted UI.

**Frontend sent** (nested structure):
```typescript
{
  subdomain: "poc-test1-20251125",
  orgData: {
    name: "poc-test1-20251125",
    type: "provider",
    contacts: [{firstName, lastName, email, type, label, ...}],
    addresses: [{street1, city, state, zipCode, type, label, ...}],
    phones: [{number, type, label, ...}]
  },
  users: []
}
```

**Edge Function expected** (legacy flat structure):
```typescript
{
  organizationName: string,
  organizationSlug: string,
  organizationType: string,
  timezone: string,
  adminContact: {...},      // Single object, not array
  billingAddress: {...},    // Single object, not array
  billingPhone: {...},      // Single object, not array
  program: {...}
}
```

### Symptoms
1. Form submission in hosted UI (`https://a4c.firstovertheline.com`)
2. Form immediately redirects to `/clients` route
3. No visual feedback or error messages
4. No `organization.bootstrap.initiated` event created in database
5. No API calls visible in Supabase logs

### Investigation Results
- Tested with org name: `poc-test1-20251125` on 2025-11-25
- No events found in `domain_events` table
- No POST requests to `/functions/v1/organization-bootstrap` in API logs
- Edge Function (version 9) still running old legacy code
- Frontend ViewModel sending correct data structure (verified in code review)

## Solution Implemented

### Phase 1: Update AsyncAPI Contract ✅
**File**: `infrastructure/supabase/contracts/organization-bootstrap-events.yaml`

**Changes**:
- Replaced flat legacy payload with nested structure
- Added complete specifications for:
  - `contacts[]` array: Added `type`, `label`, `department` fields (required)
  - `addresses[]` array: Added `type`, `label` fields (required)
  - `phones[]` array: Added `type`, `label` fields (required)
  - `users[]` array: Made `email`, `firstName`, `lastName`, `role` required
- Made `subdomain`, `orgData`, `users` required at root level

**Key Schema Updates**:
```yaml
# Lines 41-209: Complete nested structure
payload:
  required: [subdomain, orgData, users]
  properties:
    subdomain: {type: string}
    orgData:
      required: [name, type, contacts, addresses, phones]
      properties:
        contacts:
          minItems: 1
          items:
            required: [firstName, lastName, email, type, label]
        addresses:
          minItems: 1
          items:
            required: [street1, city, state, zipCode, type, label]
        phones:
          minItems: 1
          items:
            required: [number, type, label]
```

### Phase 2: Update Edge Function ✅
**File**: `infrastructure/supabase/functions/organization-bootstrap/index.ts` ⚠️ WRONG LOCATION

**Changes**:
- Replaced `BootstrapRequest` interface with contract-aligned structure
- Added separate interfaces: `ContactInfo`, `AddressInfo`, `PhoneInfo`, `OrganizationUser`
- Each interface includes JSDoc comments referencing AsyncAPI contract line numbers
- Updated event emission to use nested structure directly (no transformation)
- Added payload validation for required fields (`subdomain`, `orgData`, `users`)

**Critical Issue Discovered**: Edge Function was edited in **WRONG location**
- ❌ Edited: `infrastructure/supabase/functions/organization-bootstrap/index.ts`
- ✅ Should be: `infrastructure/supabase/supabase/functions/organization-bootstrap/index.ts`
- GitHub Actions workflow deploys from `supabase/functions/**` (line 22 of `.github/workflows/edge-functions-deploy.yml`)

### Phase 3: Add JSDoc References ✅
**File**: `frontend/src/types/organization.types.ts`

**Changes**:
- Added comprehensive JSDoc comments to `ContactInfo`, `AddressInfo`, `PhoneInfo`
- Added detailed JSDoc to `OrganizationBootstrapParams` with contract references
- Included line number references to AsyncAPI contract and Edge Function
- Added `@see` references for easy navigation between related interfaces
- Added examples and descriptions for clarity

**Example JSDoc**:
```typescript
/**
 * Contact information structure
 *
 * @remarks
 * Matches AsyncAPI contract: infrastructure/supabase/contracts/organization-bootstrap-events.yaml lines 76-119
 * Matches Edge Function: infrastructure/supabase/functions/organization-bootstrap/index.ts lines 19-31
 */
export interface ContactInfo {
  firstName: string;
  lastName: string;
  email: string;
  title?: string;
  department?: string;
  type: string; // contact_type enum value
  label: string; // Human-readable label (e.g., "Billing Contact", "Provider Admin")
}
```

### Phase 4: Database Cleanup ✅
Ran comprehensive cleanup script to remove all test artifacts before deployment testing.

**Cleanup Results**:
- 0 test events remaining in `domain_events`
- 0 test organizations in `organizations_projection`
- All junction tables cleaned (organization_contacts, organization_addresses, organization_phones)
- All entity projections cleaned (contacts_projection, addresses_projection, phones_projection)
- Database ready for clean deployment testing

## Key Decisions

### 1. AsyncAPI as Single Source of Truth
**Decision**: AsyncAPI contract is the definitive schema - frontend and Edge Function must match it exactly

**Rationale**: User explicitly requested this approach. Provides:
- Single source of truth for event schemas
- Contract-first development prevents breaking changes
- Clear versioning and documentation

**User Quote**: "I absolutely want AsyncAPI to be the definitive schema. frontend and Edge Function should match the contract."

### 2. Manual TypeScript Types (No Type Generation)
**Decision**: Manually maintain TypeScript interfaces that match AsyncAPI contract exactly

**Rationale**:
- JSON Schema `type: object` → TypeScript `object` (too loose, no structure enforcement)
- Nested structures lose strictness when auto-generated
- Required fields become optional in generated types
- User assertion validated: Type generation doesn't work for nested document structures

**Implementation**: Added JSDoc comments with AsyncAPI contract line number references to maintain alignment

### 3. Hybrid Supabase Directory Structure
**Decision**: Keep current hybrid structure - do NOT move everything into `supabase/`

**Structure**:
```
infrastructure/supabase/
├── sql/                    # Custom SQL-first migrations (KEEP HERE)
├── contracts/              # AsyncAPI contracts (KEEP HERE)
├── local-tests/            # Testing scripts (KEEP HERE)
├── scripts/                # Utility scripts (KEEP HERE)
└── supabase/               # Supabase CLI managed directory
    ├── config.toml         # CLI configuration
    └── functions/          # Edge Functions (MUST BE HERE for deployment)
```

**Rationale**:
- SQL-first approach superior to timestamp-based migrations
- Organized by concern, not timestamp
- Deterministic execution order (00, 01, 02...)
- Easier to find and review specific migrations
- Works with custom `local-tests/run-migrations.sh` script

**Only Edge Functions must be in `supabase/functions/`** for Supabase CLI to deploy them.

## Important Constraints

### 1. Edge Functions Must Be in `supabase/functions/`
**Constraint**: Supabase CLI only deploys Edge Functions from `infrastructure/supabase/supabase/functions/`

**Evidence**:
- GitHub Actions workflow path filter: `infrastructure/supabase/supabase/functions/**`
- `config.toml` location: `infrastructure/supabase/supabase/config.toml`
- CLI deployment command runs from directory with `config.toml`

**Impact**: Edge Function code edited in wrong location won't be deployed

**Discovery Date**: 2025-11-25 during deployment investigation

### 2. AsyncAPI Type Generation Limitations
**Constraint**: JSON Schema → TypeScript type generation loses strictness for nested structures

**Examples**:
- `orgData: type: object` → `orgData: object` (no nested structure)
- `required: [email, role]` → `email?: string` (required becomes optional)
- Nested objects don't generate separate interfaces

**Impact**: Must manually maintain TypeScript types with JSDoc contract references

**Discovery Date**: 2025-11-25 during contract alignment discussion

### 3. Form Submission Silent Failures
**Constraint**: Frontend ViewModel always redirects after form submission, even on API failure

**Location**: `frontend/src/viewModels/organization/OrganizationFormViewModel.ts` lines 446-504

**Impact**: No error feedback to user when Edge Function rejects payload

**Workaround**: (Not yet implemented) Add try/catch, display errors, prevent redirect on failure

### 4. Production Permission System Failure
**Constraint**: Migration order caused permission events to be inserted BEFORE event processor trigger was created

**Root Cause**: Seed data inserted permissions with `stream_version=1` before `process_domain_event_trigger` existed

**Impact**: 22 permission projections missing, super_admin had only 19/32 permissions

**Fix Applied**: Manually processed all unprocessed events, fixed `process_rbac_event()` schema mismatch

**Discovery Date**: 2025-11-25 during production testing

**Files Fixed**:
- `infrastructure/supabase/sql/03-functions/event-processing/004-process-rbac-events.sql`

### 5. JWT Hook Registration Verification
**Constraint**: No SQL command to verify hook registration - must use Management API

**Why**: Hook registration stored in Supabase control plane, not in PostgreSQL

**Solution**: Created verification script using Management API endpoint

**Discovery Date**: 2025-11-26 during production diagnostics

**Files Created**:
- `infrastructure/supabase/scripts/verify-auth-hook-registration.sh`

### 6. Live Site Form Submission Mystery ⚠️ UNRESOLVED
**Constraint**: Form submission on live site does not call Edge Function despite valid authentication

**Symptoms**:
- User logs in successfully (Auth logs confirm hook runs)
- Form submits and redirects to `/clients` (expected behavior)
- NO Edge Function POST requests in logs
- NO database events created
- User has all required permissions (`organization.create_root`)

**Possible Causes** (requires diagnostics):
1. Frontend JavaScript error during submission
2. Network blocking (CORS, firewall, proxy)
3. WorkflowClient configuration in production build
4. Form validation preventing submission
5. Edge Function endpoint unreachable

**Discovery Date**: 2025-11-26 during production testing

**Status**: CRITICAL BLOCKER - requires browser DevTools diagnostics and enhanced logging

## Files Modified

### AsyncAPI Contract
**File**: `infrastructure/supabase/contracts/organization-bootstrap-events.yaml`
**Lines Changed**: 36-209 (complete `OrganizationBootstrapInitiated` payload restructure)
**Status**: ✅ Updated and ready to commit

### Edge Function (WRONG LOCATION)
**File**: `infrastructure/supabase/functions/organization-bootstrap/index.ts`
**Lines Changed**: 19-83 (replaced interfaces and payload structure)
**Status**: ⚠️ Updated but in wrong directory - needs to be copied to `supabase/functions/`

### Frontend Types
**File**: `frontend/src/types/organization.types.ts`
**Lines Changed**: 87-203 (added JSDoc comments and contract references)
**Status**: ✅ Updated and ready to commit

## Reference Materials

### AsyncAPI Contract
- **Location**: `infrastructure/supabase/contracts/organization-bootstrap-events.yaml`
- **Lines 41-209**: Complete `OrganizationBootstrapInitiated` payload schema
- **Lines 76-119**: Contact information structure
- **Lines 120-162**: Address information structure
- **Lines 163-190**: Phone information structure

### Edge Function Deployment
- **GitHub Actions Workflow**: `.github/workflows/edge-functions-deploy.yml`
- **Path Filter**: Line 22 - `infrastructure/supabase/supabase/functions/**`
- **Deployment Command**: Line 153 - `supabase functions deploy --project-ref`

### Frontend Types
- **Location**: `frontend/src/types/organization.types.ts`
- **Lines 87-102**: `ContactInfo` interface with JSDoc
- **Lines 104-119**: `AddressInfo` interface with JSDoc
- **Lines 121-133**: `PhoneInfo` interface with JSDoc
- **Lines 135-203**: `OrganizationBootstrapParams` interface with JSDoc

### Event Documentation
- **Location**: `documentation/infrastructure/reference/events/organization-bootstrap-workflow-started.md`
- **Contains**: Event schema, query examples, architecture pattern explanation

## Next Steps

### Immediate Action Required (Phase 5)

1. **Copy Edge Function to Correct Location**
   ```bash
   cp infrastructure/supabase/functions/organization-bootstrap/index.ts \
      infrastructure/supabase/supabase/functions/organization-bootstrap/index.ts
   ```

2. **Delete Redundant Directory**
   ```bash
   rm -rf infrastructure/supabase/functions/
   ```

3. **Commit Changes**
   ```bash
   git add infrastructure/supabase/contracts/organization-bootstrap-events.yaml
   git add infrastructure/supabase/supabase/functions/organization-bootstrap/index.ts
   git add frontend/src/types/organization.types.ts
   git commit -m "fix(contracts): Align AsyncAPI contract, Edge Function, and frontend types"
   ```

4. **Push to Main** (triggers GitHub Actions deployment)
   ```bash
   git push origin main
   ```

5. **Verify Deployment**
   - Check GitHub Actions workflow succeeds
   - Verify Edge Function deployed (version should increment)
   - Test organization creation: "poc-test2-20251125"
   - Verify `organization.bootstrap.initiated` event created
   - Verify `organization.bootstrap.workflow_started` event created

### Expected Results After Deployment

✅ Form submission creates events
✅ Edge Function accepts nested data structure
✅ Event listener triggers Temporal workflow
✅ Complete event chain: initiated → workflow_started → created

## Session History

### 2025-11-25 - Contract Alignment Session

**Pre-test Verification**:
- Checked worker pod status: Running and healthy
- Verified event listener connectivity: Connected to PostgreSQL NOTIFY channel
- Database clean: 55 production events, 1 production org

**User Testing**:
- User created "poc-test3-20251124" via hosted UI (initial test)
- No events created - discovered frontend was in MOCK mode
- User created "poc-test1-20251125" via hosted UI (after switching to production)
- No events created - discovered data contract mismatch

**Investigation**:
- Checked Supabase API logs: No POST to `/functions/v1/organization-bootstrap`
- Checked Edge Function version: Still version 9 (old code)
- Identified root cause: Frontend sends nested structure, Edge Function expects flat legacy structure

**Resolution**:
- Updated AsyncAPI contract to nested structure
- Updated Edge Function interfaces (but in wrong directory)
- Added JSDoc comments to frontend types
- Discovered directory structure issue requiring Edge Function relocation

**Database Cleanup**:
- Ran `scripts/cleanup-test-artifacts.sql`
- Verified cleanup: 0 test events, 0 test orgs remaining
- Database ready for clean deployment testing

**Current State**: All code changes complete, ready to deploy once Edge Function is in correct location
