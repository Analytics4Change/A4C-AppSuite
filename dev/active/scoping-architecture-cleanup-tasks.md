# Tasks: RBAC Scoping Architecture Cleanup

## Current Status

**Phase**: 12 - Architect Recommendations Cleanup ✅ COMPLETE
**Status**: ✅ COMPLETE (Phases 1-3, 5-12 done; Phase 4 optional; Phase 11 done)
**Last Updated**: 2025-12-29
**Next Step**: Optional Phase 4 (Day 0 Baseline) or archive dev-docs

---

## Phase 1: Event Sourcing Integrity ✅ COMPLETE

### 1.1 Permissions Seed File
- [x] Create `infrastructure/supabase/sql/99-seeds/001-permissions-seed.sql`
- [x] Define all 42 permissions with correct scope_type values
- [x] Fix `role.create` to have `scope_type='org'` (not global)
- [x] Use idempotent DO blocks with event emission pattern

### 1.2 Permissions Regeneration Migration
- [x] Create migration `20251229082721_regenerate_permissions.sql`
- [x] TRUNCATE permissions_projection CASCADE
- [x] DELETE FROM domain_events WHERE event_type = 'permission.defined'
- [x] Execute seed file statements
- [x] Verify 42 permissions and 42 events after execution

### 1.3 Backfill user.registered Events (5 users)
- [x] Create backfill migration `20251229083038_backfill_orphaned_events.sql`
- [x] INSERT INTO domain_events for orphaned users
- [x] Verify all 5 users have events

### 1.4 Backfill user.role.assigned Events
- [x] Clean up test data first (aaaaaaaa-... org_id)
- [x] INSERT INTO domain_events for remaining orphaned role assignments
- [x] Verify real user role assignments have events

### 1.5 Backfill invitation.created Events (2 invitations)
- [x] INSERT INTO domain_events for orphaned invitations
- [x] Verify all invitations have events

### 1.6 Verification
- [x] Run audit query: orphaned permissions = 0
- [x] Run audit query: orphaned users = 0
- [x] Run audit query: orphaned user_roles = 0
- [x] Run audit query: orphaned invitations = 0
- [x] Verify `role.create` has `scope_type='org'`
- [x] Test UI at `/roles/manage` - Role Management only in Org section

---

## Phase 2: Documentation ✅ COMPLETE

### 2.1 Create Scoping Architecture Doc
- [x] Create `documentation/architecture/authorization/scoping-architecture.md`
- [x] Document three scoping mechanisms
- [x] Add architecture diagram
- [x] Explain how they interact

### 2.2 Update Existing Docs
- [x] Update `permissions_projection.md` - remove facility/program/client
- [x] Update `rbac-architecture.md` - simplified scope_type values
- [x] Search for other docs mentioning unused scope_type values

---

## Phase 3: Schema Simplification ✅ COMPLETE

### 3.1 Simplify scope_type Constraint
- [x] Create migration `20251229153821_simplify_scope_type_constraint.sql`
- [x] Add new constraint: `CHECK (scope_type IN ('global', 'org'))`
- [x] Verify migration is idempotent

### 3.2 Frontend Type Update
- [x] Update `role.types.ts` PermissionScopeType to `'global' | 'org'`
- [x] Update `MockRoleService.ts` to use 'org' instead of 'client'
- [x] Remove any references to 'facility', 'program', 'client'
- [x] Run TypeScript compilation to verify no errors

### 3.3 Test Data Cleanup
- [x] Remove user_roles with org_id 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' (done in Phase 1 backfill)

---

## Phase 4: Day 0 Baseline (Optional) ⏸️ PENDING

### 4.1 Pre-Verification
- [ ] All Phase 1-3 complete and verified
- [ ] Run full audit queries
- [ ] Test authorization behavior
- [ ] Test UI functionality

### 4.2 Baseline Generation
- [ ] Create backup: `supabase db dump --linked > backup_before_day0.sql`
- [ ] Generate new baseline: `supabase db dump --linked > migrations/20250101000000_baseline_v2.sql`
- [ ] Archive old migrations to `migrations.archived/`
- [ ] Mark old migrations as reverted in remote
- [ ] Mark new baseline as applied
- [ ] Verify migration list shows only baseline_v2

---

## Phase 5: Permission Architecture Cleanup ✅ COMPLETE

### 5.1 Delete Unused Permissions (13 deleted)
- [x] Remove a4c_role.* permissions (5) - not used in codebase
- [x] Remove medication.prescribe - user decision
- [x] Remove organization.business_profile_* and create_sub (3) - redundant
- [x] Remove role.assign and role.grant (2) - use user.role_assign/revoke instead

### 5.2 Add Missing Permissions (2 added)
- [x] Add medication.update
- [x] Add medication.delete

### 5.3 Update Display Names
- [x] organization.view → View Settings
- [x] organization.update → Update Settings
- [x] organization.view_ou → View Hierarchy
- [x] organization.create_ou → Create Unit

### 5.4 Update Frontend Config
- [x] Update `permissions.config.ts` - removed deleted permissions, added new ones
- [x] Update `MockRoleService.ts` - aligned with new permission set

---

## Phase 6: Provider Admin Permission Backfill ✅ COMPLETE

### 6.1 Fix role_permission_templates
- [x] Add 4 missing permissions to template: medication.administer, role.delete, role.update, user.delete
- [x] Template now has 23 permissions (was 19)

### 6.2 Backfill Existing provider_admin Roles
- [x] Create migration `20251229195740_backfill_provider_admin_permissions.sql`
- [x] Backfill all 23 permissions to existing provider_admin roles
- [x] Verify Live for Life has 23 permissions
- [x] Verify poc-test1-20251229 has 23 permissions

### 6.3 Fix emit_domain_event Function Signature
- [x] Debug "stack depth limit exceeded" error when creating roles
- [x] Root cause: api.create_role called emit_domain_event with 5 params, no matching overload
- [x] Create migration `20251229201217_fix_emit_domain_event_overload.sql`
- [x] Added overload that auto-calculates stream_version
- [x] Role creation now works via UI

### 6.4 Update Temporal Activity
- [x] Update PROVIDER_ADMIN_PERMISSIONS constant in grant-provider-admin-permissions.ts
- [x] Now includes all 23 permissions for new organization bootstrap

---

## Phase 7: Verification ✅ COMPLETE

### 7.1 Test New Organization Bootstrap (poc-test2-20251229)
- [x] Bootstrap new organization via UI
- [x] Verify Temporal workflow grants all 23 permissions (23 events emitted)
- [x] Verify `role.permission.granted` events emitted (AsyncAPI compliant - on role stream)
- [x] Verify Role Management UI shows all permissions for new org's provider_admin

---

## Phase 8: RLS Recursion Fix ✅ COMPLETE

### 8.1 Diagnose "stack depth limit exceeded" Error
- [x] Reproduce error: create new role at OU hierarchy level fails with ~9 second delay
- [x] Deploy diagnostic stubs for function overloads (`20251229220540_stub_unused_overloads.sql`)
- [x] Confirm stubs didn't fire → rule out function overload ambiguity

### 8.2 Identify Root Cause
- [x] Trace RLS policy chain: `domain_events` RLS → `is_super_admin()` → `user_roles_projection` RLS → `is_super_admin()` → infinite recursion
- [x] Confirm circular dependency: permission check functions query tables that have RLS calling those same functions

### 8.3 Implement Fix
- [x] Create migration `20251229221456_fix_rls_recursion.sql`
- [x] Make `is_super_admin()` SECURITY DEFINER (bypasses RLS)
- [x] Make `is_org_admin()` SECURITY DEFINER (bypasses RLS)
- [x] Fix column name error (`ur.org_id` → `ur.organization_id`)
- [x] Test role creation via UI - SUCCESS

### 8.4 Commit and Push
- [x] Commit both diagnostic and fix migrations
- [x] Push to main branch
- [x] Verify CI/CD pipeline succeeds

---

## Phase 9: Trigger WHEN Clause Optimization ✅ COMPLETE

### 9.1 Diagnose Anti-Pattern
- [x] Identified two triggers firing on ALL domain_events inserts
- [x] `trigger_notify_bootstrap_initiated` - no WHEN clause, checks event_type inside function
- [x] `bootstrap_workflow_trigger` - no WHEN clause, checks stream_type + event_type inside function

### 9.2 Architectural Principle Established
- [x] `process_domain_event_trigger`: NO WHEN clause (main event router - by design)
- [x] All other triggers: MUST have WHEN clause to filter at trigger level

### 9.3 Implement Fix
- [x] Create migration `20251229223544_add_when_clauses_to_bootstrap_triggers.sql`
- [x] Add `WHEN (NEW.event_type = 'organization.bootstrap.initiated')` to `trigger_notify_bootstrap_initiated`
- [x] Add `WHEN (NEW.event_type = 'organization.bootstrap.failed')` to `bootstrap_workflow_trigger`
- [x] Apply migration via `supabase db push --linked`

### 9.4 Verification
- [x] All 5 triggers on `domain_events` verified
- [x] Only `process_domain_event_trigger` has no WHEN clause (correct)
- [x] All other triggers have WHEN clauses

---

## Phase 10: Diagnostic Stub Cleanup ✅ COMPLETE

### 10.1 Assess Diagnostic Stubs
- [x] Query current function overloads
- [x] Identified 3 diagnostic stubs from Phase 8 debugging (migration `20251229220540`)
- [x] Confirmed stubs are dead code (never called - would RAISE EXCEPTION)

### 10.2 Stubs Removed
| Stub | Signature | Reason |
|------|-----------|--------|
| `api.create_role` | 4-param (text, text, text, uuid[]) | 5-param version is canonical |
| `api.emit_domain_event` | 6-param legacy (event_id, aggregate_type...) | Dead code |
| `api.emit_domain_event` | 6-param explicit (with stream_version) | 5-param auto-version is canonical |

### 10.3 Implement Cleanup
- [x] Create migration `20251229225733_cleanup_diagnostic_stubs.sql`
- [x] DROP 3 stub functions
- [x] Verify only canonical overloads remain
- [x] Apply migration via `supabase db push --linked`

### 10.4 Verification
- [x] `api.create_role`: 1 canonical overload (5-param with p_cloned_from_role_id)
- [x] `api.emit_domain_event`: 1 canonical overload (5-param auto-version)
- [x] No regressions in role creation

---

## Phase 11: Software Architect Review ✅ COMPLETE

### 11.1 Review Scope
- [x] Anti-patterns - identified diagnostic RAISE NOTICE, TRUNCATE non-idempotency
- [x] Code reuse opportunities - none significant identified
- [x] Industry best practices (PostgreSQL, event sourcing, CQRS) - compliant
- [x] Internal documentation alignment - 9 files needing updates identified
- [x] Documentation gaps - permission counts outdated, invalid scope_types in docs
- [x] General suggestions - org_id rename investigated (NOT NEEDED - columns already use organization_id)

### 11.2 Files Reviewed
- `dev/active/scoping-architecture-cleanup-*.md`
- `infrastructure/supabase/supabase/migrations/20251229*.sql`
- `documentation/architecture/authorization/`
- Git commit history since 2025-12-29

---

## Phase 12: Architect Recommendations Cleanup ✅ COMPLETE

### 12.1 Documentation Updates (9 files)
- [x] `permissions-reference.md` - Updated permission counts (34→31), removed deleted permissions
- [x] `scoping-architecture.md` - Updated permission counts (42→31), fixed org permissions (32→21)
- [x] `permissions_projection.md` - Fixed scope_type (removed facility/program/client)
- [x] `rbac-architecture.md` - Updated Zitadel→Supabase, fixed permission catalogs, updated role matrix
- [x] `roles_projection.md` - No changes needed (already current)
- [x] `rbac-implementation-guide.md` - Updated scope_type, permission counts, test examples
- [x] `cross_tenant_access_grants_projection.md` - No changes needed (scope is different from scope_type)
- [x] `invitations_projection.md` - No changes needed (already current)
- [x] `user_roles_projection.md` - No changes needed (already current)

### 12.2 Remove Diagnostic RAISE NOTICE Statements
- [x] Identified 40 `[DIAG:` statements across 4 functions
- [x] Created migration `20251229233333_remove_diagnostic_notices.sql`
- [x] Cleaned functions: api.create_role, api.emit_domain_event, process_domain_event, process_rbac_event
- [x] Applied migration via `supabase db push --linked`
- [x] Verified: "SUCCESS: All diagnostic statements removed from 4 functions"

### 12.3 Decisions
- [x] **TRUNCATE idempotency**: SKIP - one-time cleanup migration, acceptable pattern
- [x] **org_id → organization_id rename**: NOT NEEDED - all database columns already use organization_id

---

## Success Validation Checkpoints

### After Phase 1 ✅
- [x] 42 permissions in projection
- [x] 42 permission.defined events in domain_events
- [x] All projection IDs match event stream_ids
- [x] `role.create` scope_type = 'org'
- [x] 0 orphaned permissions
- [x] 0 orphaned users (after user.registered backfill)
- [x] 0 orphaned invitations

### After Phase 2 ✅
- [x] New scoping-architecture.md created
- [x] Existing docs updated
- [x] No references to facility/program/client scope_type

### After Phase 3 ✅
- [x] scope_type constraint allows only 'global' and 'org'
- [x] Frontend PermissionScopeType type simplified
- [x] Test data removed
- [x] TypeScript compilation passes

### After Phase 4 (Optional)
- [ ] New baseline captures clean state
- [ ] Old migrations archived
- [ ] Migration list shows only baseline_v2
- [ ] No regressions in functionality

### After Phase 5 ✅
- [x] 31 permissions in projection (42 - 13 + 2)
- [x] Unused a4c_role.* permissions removed
- [x] medication.update and medication.delete added
- [x] Frontend config updated

### After Phase 6 ✅
- [x] role_permission_templates has 23 entries for provider_admin
- [x] All existing provider_admin roles have 23 permissions
- [x] emit_domain_event function has 3 overloads (fixed signature issue)
- [x] PROVIDER_ADMIN_PERMISSIONS constant updated in Temporal activity

### After Phase 7 ✅ (Verification - poc-test2-20251229)
- [x] New organization bootstrap grants 23 permissions
- [x] role.permission.granted events emitted for new orgs (23 events on role stream)
- [x] End-to-end flow verified

### After Phase 8 ✅
- [x] `is_super_admin()` is SECURITY DEFINER
- [x] `is_org_admin()` is SECURITY DEFINER
- [x] Role creation via UI works (no more "stack depth limit exceeded")
- [x] RLS policies still function correctly for tenant isolation

### After Phase 9 ✅
- [x] `trigger_notify_bootstrap_initiated` has WHEN clause
- [x] `bootstrap_workflow_trigger` has WHEN clause
- [x] Only `process_domain_event_trigger` fires on all events (by design)
- [x] No unnecessary function calls for non-bootstrap events

### After Phase 10 ✅
- [x] 3 diagnostic stub functions removed
- [x] `api.create_role`: 1 canonical overload (5-param)
- [x] `api.emit_domain_event`: 1 canonical overload (5-param auto-version)
- [x] Simplified API surface (no confusing overloads)

### After Phase 11 ✅
- [x] Architect review completed
- [x] Anti-patterns documented (diagnostic RAISE NOTICE, TRUNCATE)
- [x] Recommendations prioritized
- [x] Documentation gaps identified (9 files)

### After Phase 12 ✅
- [x] All 9 documentation files reviewed and updated (4 changed, 5 already current)
- [x] 40 diagnostic RAISE NOTICE statements removed from 4 functions
- [x] Migration `20251229233333_remove_diagnostic_notices.sql` applied
- [x] org_id rename determined NOT NEEDED (columns already use organization_id)

---

## Completed Migrations

| Migration | Description | Status |
|-----------|-------------|--------|
| `20251229082721_regenerate_permissions.sql` | Regenerate all 42 permissions with correct scope_type | ✅ Applied |
| `20251229083038_backfill_orphaned_events.sql` | Backfill user/invitation events, cleanup test data | ✅ Applied |
| `20251229153821_simplify_scope_type_constraint.sql` | Simplify scope_type to global/org only | ✅ Applied |
| `20251229184955_permission_cleanup.sql` | Delete 13 unused permissions, add 2 new ones | ✅ Applied |
| `20251229195740_backfill_provider_admin_permissions.sql` | Backfill 23 permissions to existing provider_admin roles | ✅ Applied |
| `20251229201217_fix_emit_domain_event_overload.sql` | Add function overload that auto-calculates stream_version | ✅ Applied |
| `20251229220540_stub_unused_overloads.sql` | Diagnostic stubs for function overloads (ruled out ambiguity) | ✅ Applied |
| `20251229221456_fix_rls_recursion.sql` | **FIX**: SECURITY DEFINER on is_super_admin/is_org_admin | ✅ Applied |
| `20251229223544_add_when_clauses_to_bootstrap_triggers.sql` | Add WHEN clauses to bootstrap triggers for performance | ✅ Applied |
| `20251229225733_cleanup_diagnostic_stubs.sql` | Remove 3 diagnostic stub functions from Phase 8 debugging | ✅ Applied |
| `20251229233333_remove_diagnostic_notices.sql` | Remove 40 [DIAG: RAISE NOTICE statements from 4 functions | ✅ Applied |

---

## Audit Results (Final)

| Metric | Before | After Phase 3 | After Phase 6 | After Phase 8 | After Phase 9 | After Phase 10 |
|--------|--------|---------------|---------------|---------------|---------------|----------------|
| Orphaned permissions | 19 | 0 | 0 | 0 | 0 | 0 |
| Orphaned users | 5 | 0 | 0 | 0 | 0 | 0 |
| Orphaned invitations | 2 | 0 | 0 | 0 | 0 | 0 |
| Test data (fake org_id) | 3 rows | 0 | 0 | 0 | 0 | 0 |
| `role.create` scope_type | global (BUG) | org (FIXED) | org | org | org | org |
| scope_type values | 5 | 2 (global, org) | 2 | 2 | 2 | 2 |
| Total permissions | 42 | 42 | **31** | 31 | 31 | 31 |
| provider_admin template permissions | ? | 19 | **23** | 23 | 23 | 23 |
| api.emit_domain_event overloads | 2 | 2 | 3 | 3 | 3 | **1** (canonical) |
| api.create_role overloads | 1 | 1 | 2 | 2 | 2 | **1** (canonical) |
| is_super_admin/is_org_admin | SECURITY INVOKER (BUG) | - | - | **SECURITY DEFINER** | SECURITY DEFINER | SECURITY DEFINER |
| Role creation via UI | ❌ stack overflow | - | ❌ stack overflow | **✅ Working** | ✅ Working | ✅ Working |
| Bootstrap triggers with WHEN | 3/5 (60%) | - | - | - | **5/5 (100%)** | 5/5 (100%) |
| Diagnostic RAISE NOTICE | 40+ | - | - | - | - | **0** (cleaned) |
| Documentation files updated | - | - | - | - | - | **4 of 9** (5 already current) |

---

## Deployment Notes

1. All migrations applied via `supabase db push --linked`
2. Verified in Supabase dashboard that all migrations applied
3. Frontend type updated in `frontend/src/types/role.types.ts`
4. Frontend config updated in `frontend/src/config/permissions.config.ts`
5. Temporal activity updated in `workflows/src/activities/organization-bootstrap/grant-provider-admin-permissions.ts`
6. Phase 4 (Day 0 baseline) is optional - user can decide whether to consolidate migrations

## Important Technical Notes

### Complete provider_admin Permission Set (23 total)
```
Organization (4): view, update, view_ou, create_ou
Client (4): create, view, update, delete
Medication (5): create, view, update, delete, administer
Role (4): create, view, update, delete
User (6): create, view, update, delete, role_assign, role_revoke
```

### emit_domain_event Function Overloads (3 total)
1. `(p_stream_id, p_stream_type, p_stream_version, p_event_type, p_event_data, p_event_metadata)` - explicit version
2. `(p_event_id, p_event_type, p_aggregate_type, p_aggregate_id, p_event_data, p_event_metadata)` - different naming
3. `(p_stream_id, p_stream_type, p_event_type, p_event_data, p_event_metadata)` - **NEW: auto-calculates stream_version**

### AsyncAPI Contract Compliance
- **New database deployments**: COMPLIANT - Temporal workflow emits `role.permission.granted` events
- **Backfill migration**: Non-compliant (direct INSERT) - acceptable for one-time fix
- **Contract file**: `infrastructure/supabase/contracts/asyncapi/domains/rbac.yaml`

### RLS Recursion Fix (Phase 8)
**Root Cause**: Circular RLS policy recursion
```
domain_events INSERT
  → RLS policy checks is_super_admin(get_current_user_id())
    → queries user_roles_projection
      → RLS policy checks is_super_admin(get_current_user_id())
        → infinite recursion until PostgreSQL stack exhausted (~9 seconds)
```

**Fix**: Make permission check functions SECURITY DEFINER
- `is_super_admin(UUID)` - bypasses RLS on user_roles_projection
- `is_org_admin(UUID, UUID)` - bypasses RLS on user_roles_projection

**Why SECURITY DEFINER is safe here**:
1. These functions only return BOOLEAN - no data leakage
2. They check if the GIVEN user_id has admin role - no privilege escalation
3. The function owner (postgres) has full table access anyway

---

### Trigger WHEN Clause Principle (Phase 9)
**Architectural Pattern**: All triggers on `domain_events` except the main router must have WHEN clauses.

| Trigger | Has WHEN? | Purpose |
|---------|-----------|---------|
| `process_domain_event_trigger` | NO (correct) | Main event router - fires on all by design |
| `trigger_notify_bootstrap_initiated` | YES | `organization.bootstrap.initiated` only |
| `bootstrap_workflow_trigger` | YES | `organization.bootstrap.failed` only |
| `enqueue_workflow_from_bootstrap_event_trigger` | YES | `organization.bootstrap.initiated` only |
| `update_workflow_queue_projection_trigger` | YES | `workflow.queue.*` events only |

**Why this matters**: PostgreSQL evaluates WHEN clauses before invoking the trigger function. Without WHEN, every INSERT causes a function call even if the function immediately exits. This adds unnecessary overhead (context switch, stack allocation) for high-volume event tables.
