# Tasks: RBAC Scoping Architecture Cleanup

## Current Status

**Phase**: 6 - Provider Admin Permission Backfill ✅ COMPLETE
**Status**: ✅ COMPLETE (Phases 1-3, 5-6 done; Phase 4 optional)
**Last Updated**: 2025-12-29
**Next Step**: Bootstrap new organization to test NEW org workflow grants all 23 permissions

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

## Phase 7: Verification ⏸️ PENDING

### 7.1 Test New Organization Bootstrap
- [ ] Bootstrap new organization via UI
- [ ] Verify Temporal workflow grants all 23 permissions
- [ ] Verify `role.permission.granted` events emitted (AsyncAPI compliant)
- [ ] Verify Role Management UI shows all permissions for new org's provider_admin

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

### After Phase 7 (Verification)
- [ ] New organization bootstrap grants 23 permissions
- [ ] role.permission.granted events emitted for new orgs
- [ ] End-to-end flow verified

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

---

## Audit Results (Final)

| Metric | Before | After Phase 3 | After Phase 6 |
|--------|--------|---------------|---------------|
| Orphaned permissions | 19 | 0 | 0 |
| Orphaned users | 5 | 0 | 0 |
| Orphaned invitations | 2 | 0 | 0 |
| Test data (fake org_id) | 3 rows | 0 | 0 |
| `role.create` scope_type | global (BUG) | org (FIXED) | org |
| scope_type values | 5 | 2 (global, org) | 2 |
| Total permissions | 42 | 42 | **31** |
| provider_admin template permissions | ? | 19 | **23** |
| emit_domain_event overloads | 2 | 2 | **3** |

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
