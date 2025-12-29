# Tasks: RBAC Scoping Architecture Cleanup

## Current Status

**Phase**: 4 - Day 0 Baseline (Optional)
**Status**: ⏸️ PENDING
**Last Updated**: 2025-12-29
**Next Step**: Decide whether to generate new Day 0 baseline

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

---

## Completed Migrations

| Migration | Description | Status |
|-----------|-------------|--------|
| `20251229082721_regenerate_permissions.sql` | Regenerate all 42 permissions with correct scope_type | ✅ Applied |
| `20251229083038_backfill_orphaned_events.sql` | Backfill user/invitation events, cleanup test data | ✅ Applied |
| `20251229153821_simplify_scope_type_constraint.sql` | Simplify scope_type to global/org only | ✅ Applied |

---

## Audit Results (Final)

| Metric | Before | After |
|--------|--------|-------|
| Orphaned permissions | 19 | 0 |
| Orphaned users | 5 | 0 |
| Orphaned invitations | 2 | 0 |
| Test data (fake org_id) | 3 rows | 0 |
| `role.create` scope_type | global (BUG) | org (FIXED) |
| scope_type values | 5 (global, org, facility, program, client) | 2 (global, org) |

---

## Deployment Notes

1. All migrations applied via `supabase db push --linked`
2. Verified in Supabase dashboard that all migrations applied
3. Frontend type updated in `frontend/src/types/role.types.ts`
4. Phase 4 (Day 0 baseline) is optional - user can decide whether to consolidate migrations
