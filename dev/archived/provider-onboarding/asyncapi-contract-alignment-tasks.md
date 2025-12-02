# AsyncAPI Contract Alignment - Tasks

**Feature**: Fix silent form submission failures by aligning data contracts
**Last Updated**: 2025-11-25

## Current Status

**Phase**: Phase 6 - Production Testing (CRITICAL BLOCKERS)
**Status**: ⏸️ BLOCKED - Frontend in mock mode
**Last Updated**: 2025-11-26
**Next Step**: Switch frontend to production mode (`VITE_APP_MODE=production`), add enhanced logging, test end-to-end

## Task Checklist

### Phase 1: Update AsyncAPI Contract ✅ COMPLETE

- [x] Read current AsyncAPI contract (`organization-bootstrap-events.yaml`)
- [x] Read frontend types to understand data structure being sent
- [x] Update `OrganizationBootstrapInitiated` payload to match frontend structure
- [x] Add complete specifications for `contacts[]` array (firstName, lastName, email, type, label, department)
- [x] Add complete specifications for `addresses[]` array (street1, city, state, zipCode, type, label)
- [x] Add complete specifications for `phones[]` array (number, extension, type, label)
- [x] Add complete specifications for `users[]` array (email, firstName, lastName, role)
- [x] Make `subdomain`, `orgData`, `users` required at root level
- [x] Set `minItems: 1` for contacts, addresses, phones arrays

**Files Modified**:
- `infrastructure/supabase/contracts/organization-bootstrap-events.yaml` (lines 41-209)

### Phase 2: Update Edge Function ✅ COMPLETE (but wrong location)

- [x] Read Edge Function code to understand current interfaces
- [x] Replace `BootstrapRequest` interface with contract-aligned structure
- [x] Create `ContactInfo` interface matching AsyncAPI lines 76-119
- [x] Create `AddressInfo` interface matching AsyncAPI lines 120-162
- [x] Create `PhoneInfo` interface matching AsyncAPI lines 163-190
- [x] Create `OrganizationUser` interface matching AsyncAPI lines 181-209
- [x] Add JSDoc comments to each interface referencing AsyncAPI contract line numbers
- [x] Update event emission logic to use nested structure directly
- [x] Add payload validation for required fields
- [ ] ⚠️ Copy Edge Function to correct deployment location (`supabase/functions/`)

**Files Modified**:
- `infrastructure/supabase/functions/organization-bootstrap/index.ts` (lines 19-83) ⚠️ WRONG LOCATION

**Critical Discovery**: Edge Function must be in `infrastructure/supabase/supabase/functions/` for GitHub Actions to deploy it.

### Phase 3: Add JSDoc References to Frontend Types ✅ COMPLETE

- [x] Read frontend types to understand current structure
- [x] Add comprehensive JSDoc comments to `ContactInfo` interface
- [x] Add comprehensive JSDoc comments to `AddressInfo` interface
- [x] Add comprehensive JSDoc comments to `PhoneInfo` interface
- [x] Add detailed JSDoc to `OrganizationBootstrapParams` with contract references
- [x] Include AsyncAPI contract line number references in all JSDoc comments
- [x] Include Edge Function line number references in all JSDoc comments
- [x] Add `@see` references for easy navigation between interfaces
- [x] Add examples and descriptions for clarity

**Files Modified**:
- `frontend/src/types/organization.types.ts` (lines 87-203)

### Phase 4: Database Cleanup ✅ COMPLETE

- [x] Run cleanup script to remove all test artifacts
- [x] Verify no test events in `domain_events` table
- [x] Verify no test organizations in `organizations_projection` table
- [x] Verify junction tables cleaned (organization_contacts, organization_addresses, organization_phones)
- [x] Verify entity projections cleaned (contacts_projection, addresses_projection, phones_projection)
- [x] Confirm database ready for clean deployment testing

**Cleanup Results**:
- domain_events: 0 test events (55 production events remain)
- organizations_projection: 0 test orgs (1 production org remains)
- All junction and projection tables cleaned

### Phase 5: Deploy Edge Function ✅ COMPLETE

**Deployment Results** (2025-11-25T19:44:59Z):
- ✅ GitHub Actions workflow completed successfully
- ✅ All 4 Edge Functions deployed: organization-bootstrap, accept-invitation, validate-invitation, workflow-status
- ✅ Supabase CLI setup-cli@v1 action working correctly
- ✅ SUPABASE_PROJECT_REF secret configured

**Critical Path Completed**:

1. **Copy Edge Function to Correct Location** ✅
   - [x] Copy `functions/organization-bootstrap/index.ts` → `supabase/functions/organization-bootstrap/index.ts`
   - [x] Verified file copied successfully
   - [x] Compared files to ensure exact copy

2. **Delete Redundant Directory** ✅
   - [x] Deleted `infrastructure/supabase/functions/` directory entirely
   - [x] Verified directory removed

3. **Commit Changes** ✅
   - [x] Staged AsyncAPI contract
   - [x] Staged Edge Function
   - [x] Staged frontend types
   - [x] Committed: "fix(contracts): Align AsyncAPI contract, Edge Function, and frontend types"

4. **Fix Code Issues** ✅
   - [x] Fixed Deno linting errors (unused variables)
   - [x] Fixed TypeScript error in accept-invitation Edge Function
   - [x] Fixed JWT custom claims access in organization-bootstrap
   - [x] Fixed GitHub Actions workflow (Supabase CLI installation)

5. **Push to Main Branch** ✅
   - [x] Pushed commits to main
   - [x] GitHub Actions workflow triggered automatically

6. **Configure GitHub Secrets** ✅
   - [x] Added SUPABASE_PROJECT_REF secret via gh CLI

7. **Verify GitHub Actions Deployment** ✅
   - [x] Workflow completed successfully (2025-11-25T19:44:59Z)
   - [x] "Validate Edge Functions" job passed (Deno lint + type-check)
   - [x] "Deploy Edge Functions to Supabase" job passed
   - [x] "Verify function deployment" confirmed 4 functions deployed
   - [x] All Edge Functions deployed successfully

### Phase 6: Production Testing ⏸️ BLOCKED - Critical Diagnostic Required

**PRODUCTION ISSUES DISCOVERED** (2025-11-26 - Live Site Testing):

#### 1. Permission System Failures ✅ FIXED (2025-11-25)
- [x] 22 `permission.defined` events existed but never processed (processed_at = NULL)
- [x] Root cause: Migration order - `process_domain_event_trigger` created AFTER seed data
- [x] Fixed `process_rbac_event()` function - audit_log schema mismatch (used non-existent columns)
- [x] Manually processed all 22 unprocessed permission events
- [x] Created 13 missing permission projections (total now 32)
- [x] Granted all 32 permissions to super_admin role
- [x] Verified super_admin has `organization.create_root` permission

**Files Modified**:
- `infrastructure/supabase/sql/03-functions/event-processing/004-process-rbac-events.sql` (fixed audit_log columns)

#### 2. JWT Hook Verification ✅ COMPLETE (2025-11-26)
- [x] Created verification script: `infrastructure/supabase/scripts/verify-auth-hook-registration.sh`
- [x] Verified hook registered via Supabase Management API
- [x] Management API confirms: `hook_custom_access_token_enabled: true`
- [x] Hook URI correct: `pg-functions://postgres/public/custom_access_token_hook`
- [x] Auth service logs show hook running successfully (multiple timestamps)
- [x] Manual hook test returns all 32 permissions including `organization.create_root`

**Files Created**:
- `infrastructure/supabase/scripts/verify-auth-hook-registration.sh` (new diagnostic tool)

#### 3. Live Site Form Submission Mystery ⏸️ CRITICAL BLOCKER (2025-11-26)

**Symptom**: User submitted organization form on live site (`https://a4c.firstovertheline.com`), redirected to `/clients`, but NO Edge Function calls in logs.

**Timeline**:
- 01:24:09 UTC - User login, hook ran successfully (Auth logs)
- 01:25:00 UTC (approx) - User submitted organization form
- 01:27:00 UTC - Query shows NO new events in database
- Edge Function logs: Only deployment health check (19:44:59 UTC), no recent POSTs

**Initial Misdiagnosis**: Assumed frontend running in mock mode
**Correction**: Live site (`a4c.firstovertheline.com`) is production deployment in k8s - NOT affected by local `.env.local`

**Possible Root Causes**:
1. **Frontend JavaScript error** - Form submission failed silently in browser
2. **Network blocking** - CORS, firewall, or proxy blocking Edge Function calls
3. **Wrong endpoint** - Frontend calling incorrect URL
4. **Form validation failure** - Client-side validation preventing submission
5. **WorkflowClient configuration** - Production build may have wrong config
6. **Edge Function not reachable** - DNS, routing, or Supabase service issue

**Diagnostic Steps Required**:
- [ ] Check browser DevTools Console for JavaScript errors
- [ ] Check browser DevTools Network tab for POST to `organization-bootstrap`
- [ ] Verify frontend build configuration (`VITE_APP_MODE` in k8s deployment)
- [ ] Check k8s deployment environment variables
- [ ] Verify Edge Function endpoint accessible: `curl https://tmrjlswbsxmbglmaclxu.supabase.co/functions/v1/organization-bootstrap`
- [ ] Add enhanced logging to frontend (TemporalWorkflowClient.ts)
- [ ] Add enhanced logging to Edge Function (organization-bootstrap/index.ts)
- [ ] Check frontend build logs for configuration issues

**Known Frontend Behavior**:
- ViewModel ALWAYS redirects to `/clients` after form submission (lines 446-504)
- No try/catch - errors swallowed silently (known issue #1 in this doc)
- Redirect happens regardless of success/failure

**Test Plan** (AFTER diagnostics):
1. **Verify browser console** - Check for errors during form submission
2. **Verify network request** - Confirm POST to Edge Function attempted
3. **Navigate to hosted UI**: `https://a4c.firstovertheline.com`
4. **Create organization**: "poc-test3-20251125"
5. **Check Edge Function logs**: POST to `/functions/v1/organization-bootstrap`
6. **Query database events**:
   - `organization.bootstrap.initiated` event exists
   - `organization.bootstrap.workflow_started` event exists
   - Complete event chain verified
7. **Verify projection**: Organization appears in `organizations_projection` table

### Phase 6: Cleanup Test Data (After Successful Test)

- [ ] Run cleanup script: `psql < infrastructure/supabase/scripts/cleanup-test-artifacts.sql`
- [ ] Verify test organization "poc-test2-20251125" removed
- [ ] Verify all test events removed
- [ ] Leave production data intact

## Deployment Checklist

Before pushing to main:

- [ ] Edge Function code in correct location (`supabase/functions/organization-bootstrap/`)
- [ ] All three files staged for commit (AsyncAPI contract, Edge Function, frontend types)
- [ ] Redundant `functions/` directory deleted
- [ ] Commit message follows convention: "fix(contracts): ..."
- [ ] GitHub Actions secrets configured (SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF)

After deployment:

- [ ] GitHub Actions workflow completed successfully
- [ ] Edge Function version incremented in Supabase dashboard
- [ ] Test organization creation works end-to-end
- [ ] Events created in database
- [ ] Workflow triggered via event listener

## Known Issues

### 1. Frontend Error Handling
**Issue**: ViewModel always redirects after form submission, even on API failure

**Location**: `frontend/src/viewModels/organization/OrganizationFormViewModel.ts` lines 446-504

**Impact**: No error feedback to user when Edge Function rejects payload

**Status**: Not addressed in this phase (out of scope)

**Future Work**: Add try/catch in `submit()` method, display errors, prevent redirect on failure

### 2. Form Validation Messages
**Issue**: Form doesn't validate required arrays (contacts, addresses, phones) have at least 1 item

**Impact**: Could submit invalid payload if ViewModel transformation logic has bugs

**Status**: Not addressed in this phase (out of scope)

**Future Work**: Add minItems validation to form ViewModel

## Testing Scenarios

### Scenario 1: Happy Path (Expected)
1. User fills out organization form completely
2. Submits form
3. Edge Function accepts payload
4. `organization.bootstrap.initiated` event created
5. Event listener receives PostgreSQL NOTIFY
6. Event listener starts Temporal workflow
7. `organization.bootstrap.workflow_started` event created
8. Workflow executes activities
9. `organization.created` event created
10. Organization appears in `organizations_projection`

### Scenario 2: Missing Required Field (Error Case)
1. User submits form with missing `subdomain`
2. Edge Function validation catches error
3. Returns 400 error with details
4. Frontend should show error (but currently doesn't - known issue)

### Scenario 3: Empty Arrays (Error Case)
1. User submits form with empty `contacts[]` array
2. Edge Function validation should catch error (minItems: 1)
3. Returns 400 error
4. Frontend should show error (but currently doesn't - known issue)

## Success Criteria

### Deployment Success
- ✅ GitHub Actions workflow completes without errors
- ✅ Edge Function deployed to Supabase (version > 9)
- ✅ All 4 Edge Functions verified in deployment
- ✅ Health check passes for `organization-bootstrap` function

### Integration Success
- ✅ Form submission creates `organization.bootstrap.initiated` event
- ✅ Event listener triggers workflow (creates `workflow_started` event)
- ✅ Workflow executes successfully (creates `organization.created` event)
- ✅ Organization appears in `organizations_projection` table
- ✅ No errors in Supabase logs or worker logs

### Data Contract Alignment
- ✅ AsyncAPI contract matches frontend data structure exactly
- ✅ Edge Function interfaces match AsyncAPI contract exactly
- ✅ Frontend types have JSDoc references to contract
- ✅ All three components use same nested structure

## Next Action After /clear

**Command to run**:
```
Read dev/active/asyncapi-contract-alignment-*.md and continue from where we left off
```

**Current Phase**: Phase 6 - Production Testing (BLOCKED)

**Critical Blocker**: Live site form submission not calling Edge Function

**Immediate Tasks**:
1. **User diagnostics** - Check browser DevTools (Console + Network tab) during form submission
2. **Verify k8s frontend configuration** - Check `VITE_APP_MODE` in deployment
3. **Add enhanced logging**:
   - Frontend: `TemporalWorkflowClient.ts` - log before/after Edge Function call
   - Edge Function: `organization-bootstrap/index.ts` - detailed request/response logging
4. **Test with logging enabled** - Submit form, capture all logs
5. **Root cause analysis** - Determine why Edge Function not called

**Production Issues Fixed**:
1. ✅ Permission system (32 permissions, all granted to super_admin)
2. ✅ JWT hook verification (script created, hook confirmed working)

**Production Issues Remaining**:
1. ⏸️ Form submission mystery (no Edge Function calls despite form submit)
2. ⏸️ Enhanced logging needed (frontend + Edge Function)
3. ⏸️ Configuration verification (k8s environment variables)
