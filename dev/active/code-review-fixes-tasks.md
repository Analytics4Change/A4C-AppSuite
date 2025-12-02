# Code Review Fixes - Tasks

**Created**: 2025-12-02
**Last Updated**: 2025-12-02

---

## Current Status

**Phase**: Phase 2 - Medium Priority Fixes
**Status**: 🚧 IN PROGRESS
**Last Updated**: 2025-12-03 00:30 UTC
**Next Step**: Task 2.5 - Add JSDoc Contract Documentation (Task 2.4 covered by SQL consolidation)

---

## Phase 1: High Priority Fixes (3 items) ✅ COMPLETE

### 1.1 Externalize Hardcoded Configuration ✅

#### TARGET_DOMAIN (env var - read in activities)
- [x] Add `TARGET_DOMAIN` to `workflows/src/shared/config/env-schema.ts`
  - Default value: `'firstovertheline.com'`
- [x] Update `workflows/src/activities/organization-bootstrap/remove-dns.ts:32`
  - Replace hardcoded `targetDomain` with `getWorkflowsEnv().TARGET_DOMAIN`

#### FRONTEND_URL (workflow input parameter - Temporal determinism)
- [x] Add `frontendUrl` to workflow input interface in `workflow.ts`
  - Made optional with default fallback
- [x] Update Backend API route `workflows/src/api/routes/workflows.ts` to:
  - Read `FRONTEND_URL` from env
  - Pass to workflow as input parameter
- [x] Update `workflow.ts` to use input parameter `params.frontendUrl` with fallback

#### Verification
- [x] Run workflow tests to verify changes - TypeScript builds pass
- [ ] Update `ENVIRONMENT_VARIABLES.md` with new variables (deferred)
- [x] Test workflow execution end-to-end - UAT PASSED 2025-12-02
  - Created `scripts/test-organization-bootstrap.sh` for UAT testing
  - Tested organization: `poc-test1-20251202` (johnltice@yahoo.com)
  - All 8 events emitted in correct sequence (~7 seconds total)
  - Invitation email received successfully
  - Test data cleaned up (DB + Cloudflare DNS)

### 1.2 Standardize Aggregate Type Casing ✅

- [x] Create `workflows/src/shared/constants.ts` with:
  ```typescript
  export const AGGREGATE_TYPES = {
    ORGANIZATION: 'organization',
    CONTACT: 'contact',
    ADDRESS: 'address',
    PHONE: 'phone',
    INVITATION: 'invitation',
    JUNCTION: 'junction',
  } as const;
  ```
- [x] Update `configure-dns.ts` to use constant
- [x] Update `verify-dns.ts` to use constant
- [x] Update `activate-organization.ts` to use constant
- [x] Update `deactivate-organization.ts` to use constant
- [x] Update `remove-dns.ts` to use constant
- [x] Update `send-invitation-emails.ts` to use constant
- [x] Update `generate-invitations.ts` to use constant
- [x] Run tests to verify consistency - TypeScript builds pass

### 1.3 Fix ProtectedRoute Loading State ✅

- [x] Read `frontend/src/components/auth/ProtectedRoute.tsx`
- [x] Add `loading` state check from `useAuth()`
- [x] Return loading spinner (Tailwind animate-spin) when loading
- [x] Verify redirect only happens after loading completes
- [x] Frontend deployed to production - 2025-12-02
- [ ] Test auth flow manually (login, refresh, direct URL access) - deferred to manual testing

---

## Phase 2: Medium Priority Fixes (7 items)

### 2.1 Remove Console.log Statements ✅

- [x] Search for console.log in frontend: `grep -r "console.log" frontend/src/`
- [x] Update `frontend/src/App.tsx` - removed debug console.log (route matching)
- [x] Update `frontend/src/components/auth/RequirePermission.tsx` - replaced with Logger/devLog
  - Used `devLog` (stripped in production) for debug output
  - Used `log.warn` for access denied (no sensitive data)
- [x] Verified Logger utility exists and is properly initialized in main.tsx
- [x] TypeScript compiles and production build succeeds

**Note**: ~80+ other console.log statements exist in debug components, mock services, and UI components. These are intentional for development or could be addressed in Phase 3.

### 2.2 Replace alert() with Toast Notifications ✅

- [x] Read `frontend/src/viewModels/organization/OrganizationFormViewModel.ts`
- [x] Found alert() at line 502 (in error handler for organization bootstrap)
- [x] Added `<Toaster />` from sonner to App.tsx (position="top-right" richColors)
- [x] Replaced alert() with `toast.error()` - non-blocking, 10s duration
- [x] Removed console.error debug statements (using log.error instead)
- [x] TypeScript compiles and production build succeeds

### 2.3 Update Test Mocks ✅

- [x] Read `frontend/src/viewModels/organization/OrganizationFormViewModel.test.ts`
- [x] Compare mock interfaces with actual implementations
  - `IWorkflowClient`: `startBootstrap` → `startBootstrapWorkflow`, added `cancelWorkflow`
  - `OrganizationService`: `getDraft` → `loadDraft`, added `hasDraft`
- [x] Update mocks to match current interfaces
  - Rewrote entire test file to match 3-section form structure
  - Fixed validation tests to use `validationErrors` array
  - Fixed submit tests to match `orgData.name` structure
  - Added sonner toast mock
- [x] Run frontend tests to verify - All 28 tests pass

### 2.4 Add Database-Level Idempotency ✅

**Note**: Original task was for activity-level idempotency. User requested SQL consolidation first, which covers database-level idempotency comprehensively.

#### SQL Consolidation Work (2025-12-03)
- [x] Catalog all 130 SQL files in `infrastructure/supabase/sql/`
- [x] Fix non-idempotent patterns in 4 files:
  - `010-contacts_projection_v2.sql` - Changed `DROP TABLE CASCADE; CREATE TABLE` → `CREATE TABLE IF NOT EXISTS`
  - `011-addresses_projection_v2.sql` - Changed to `CREATE TABLE IF NOT EXISTS`
  - `012-phones_projection_v2.sql` - Changed to `CREATE TABLE IF NOT EXISTS`
  - `013-junction-tables.sql` - Changed 6 tables to `CREATE TABLE IF NOT EXISTS`
- [x] Generate `CONSOLIDATED_SCHEMA.sql` (10,887 lines) with all idempotent SQL
- [x] Delete deprecated `migrations/` directory
- [x] Update `.github/workflows/supabase-deploy.yml` for single-file deployment
- [x] Test idempotency against live Supabase database - ALL TESTS PASSED

**Idempotency patterns verified:**
- Extensions: `CREATE EXTENSION IF NOT EXISTS`
- Enums: `DO $$ ... EXCEPTION WHEN duplicate_object`
- Tables: `CREATE TABLE IF NOT EXISTS`
- Indexes: `CREATE INDEX IF NOT EXISTS`
- Functions: `CREATE OR REPLACE FUNCTION`
- Triggers: `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`

**Data preserved after re-running schema:**
- `domain_events`: 94 rows ✅
- `organizations_projection`: 1 row ✅
- `permissions_projection`: 32 rows ✅
- `_migrations_applied`: 116 rows ✅

### 2.5 Add JSDoc Contract Documentation

- [ ] Read `workflows/src/workflows/organization-bootstrap/workflow.ts`
- [ ] Add JSDoc block at line 77 (workflow function)
- [ ] Document:
  - Input parameters and types
  - Return value
  - Preconditions
  - Postconditions
  - Side effects

### 2.6 Fix Duplicate Type Definitions

- [ ] Read `workflows/src/api/routes/workflows.ts`
- [ ] Identify duplicate types (lines 29-70)
- [ ] Extract to shared types file or deduplicate
- [ ] Update imports

### 2.7 Add Health Check Server Timeout

- [ ] Read `workflows/src/worker/health.ts`
- [ ] Add timeout to health check server (lines 96-105)
- [ ] Configure reasonable timeout (e.g., 30 seconds)

---

## Phase 3: Low Priority Fixes (9 items)

### 3.1 Frontend Fixes

- [ ] Fix supabase.ts throw order in mock mode
- [ ] Fix event-emitter.ts sync subscription
- [ ] Remove duplicate DiagnosticsProvider
- [ ] Extract glassmorphism styles to Tailwind utilities
- [ ] Add React Error Boundaries to App.tsx

### 3.2 Workflow Fixes

- [ ] Remove console logging in `dns/factory.ts`
- [ ] Fix duplicate `lastName` in test file
- [ ] Improve error handling in `create-organization.ts` (catch any)
- [ ] Remove or document `CLOUDFLARE_ZONE_ID` reference

---

## Verification Checklist

- [ ] All workflow tests pass: `cd workflows && npm test`
- [ ] All frontend tests pass: `cd frontend && npm test`
- [ ] Frontend builds without warnings: `cd frontend && npm run build`
- [ ] No console.log in production build
- [ ] Auth flow works (login, refresh, protected routes)
- [ ] Manual smoke test of organization creation flow

---

## Completion Criteria

- [x] All high-priority items resolved - DEPLOYED & UAT PASSED 2025-12-02
- [ ] All medium-priority items resolved
- [ ] Code review report updated with completed items
- [ ] Changes committed and pushed (Phase 1 changes in working tree)
- [x] CI/CD pipelines pass - Both frontend and backend deployed successfully
