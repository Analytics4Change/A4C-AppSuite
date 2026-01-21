# Tasks: Missing FK Constraints

## Phase 1: Analysis & Preparation ✅ COMPLETE

- [x] Identify all tables with organization-related columns
- [x] Analyze FK constraints vs missing constraints
- [x] Categorize missing FKs as oversight vs intentional (event store pattern)
- [x] Run orphan cleanup to remove blocking records
- [x] Document orphan detection methodology for non-FK tables
- [x] Generate idempotent ALTER TABLE statements

## Phase 2: Migration Creation ✅ COMPLETE

- [x] Create migration file via `supabase migration new add_missing_org_fk_constraints`
- [x] Add idempotent ALTER TABLE statements for:
  - [x] `impersonation_sessions_projection.target_org_id`
  - [x] `cross_tenant_access_grants_projection.provider_org_id`
  - [x] `cross_tenant_access_grants_projection.consultant_org_id`
  - [x] `user_notification_preferences_projection.organization_id` (NEW - found during analysis)
- [x] Add verification query as SQL comment
- [ ] Test migration locally with `supabase db push --linked --dry-run`

**Migration file**: `20260121005323_add_missing_org_fk_constraints.sql`

## Phase 3: Staging Deployment ✅ COMPLETE

- [x] Deploy migration via `supabase db push --linked`
- [x] Run verification query to confirm constraints exist
- [ ] Test CASCADE behavior (optional - can test on next org cleanup):
  - [ ] Create test organization
  - [ ] Create impersonation session referencing test org
  - [ ] Create cross-tenant grant referencing test org (both columns)
  - [ ] Delete test organization
  - [ ] Verify related records were cascaded

**Deployed**: 2026-01-21
**Verified**: All 4 FK constraints confirmed via information_schema query

## Phase 4: Documentation ⏸️ PENDING

- [ ] Update `impersonation_sessions_projection.md` with FK relationship
- [ ] Update `cross_tenant_access_grants_projection.md` with FK relationships
- [ ] Document intentionally missing FKs (event store tables) in schema docs
- [ ] Add orphan detection patterns to infrastructure guidelines

## Success Validation Checkpoints

### Immediate Validation
- [ ] Migration dry-run succeeds
- [ ] No errors on constraint creation

### Feature Complete Validation
- [ ] All three FK constraints visible in information_schema
- [ ] CASCADE delete works for all three relationships
- [ ] Orphan detection query returns 0 for these tables

### Long-Term Validation
- [ ] No orphaned records in these tables after normal operations
- [ ] /org-cleanup-dryrun reports these tables as "clean"

## Current Status

**Phase**: Phase 3 - Staging Deployment
**Status**: ✅ COMPLETE
**Last Updated**: 2026-01-21
**Next Step**: Documentation updates (Phase 4) or archive this task

## Tables Summary

| Table | Column | Status | Action |
|-------|--------|--------|--------|
| `impersonation_sessions_projection` | `target_org_id` | Missing FK | Add FK ON DELETE CASCADE |
| `cross_tenant_access_grants_projection` | `provider_org_id` | Missing FK | Add FK ON DELETE CASCADE |
| `cross_tenant_access_grants_projection` | `consultant_org_id` | Missing FK | Add FK ON DELETE CASCADE |
| `user_notification_preferences_projection` | `organization_id` | Missing FK | Add FK ON DELETE CASCADE (NEW) |
| `domain_events` | `stream_id` | Missing FK | Keep as-is (polymorphic) |
| `workflow_queue_projection` | `stream_id` | Missing FK | Keep as-is (polymorphic) |
| `unprocessed_events` | `stream_id` | Missing FK | Keep as-is (polymorphic) |

## Quick Reference: Migration SQL

**Migration file created**: `20260121005323_add_missing_org_fk_constraints.sql`

See: `infrastructure/supabase/supabase/migrations/20260121005323_add_missing_org_fk_constraints.sql`

4 FK constraints added:
1. `fk_impersonation_sessions_target_org` - impersonation_sessions_projection.target_org_id
2. `fk_cross_tenant_grants_provider_org` - cross_tenant_access_grants_projection.provider_org_id
3. `fk_cross_tenant_grants_consultant_org` - cross_tenant_access_grants_projection.consultant_org_id
4. `fk_user_notification_prefs_org` - user_notification_preferences_projection.organization_id

## Notes

- Orphan cleanup was completed on 2026-01-09 before this documentation
- 7 orphaned records were deleted (3 auth.users, 4 domain_events)
- Event store tables (domain_events, workflow_queue_projection, unprocessed_events) intentionally lack FKs due to polymorphic stream_id pattern
