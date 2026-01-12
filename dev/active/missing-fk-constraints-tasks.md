# Tasks: Missing FK Constraints

## Phase 1: Analysis & Preparation ✅ COMPLETE

- [x] Identify all tables with organization-related columns
- [x] Analyze FK constraints vs missing constraints
- [x] Categorize missing FKs as oversight vs intentional (event store pattern)
- [x] Run orphan cleanup to remove blocking records
- [x] Document orphan detection methodology for non-FK tables
- [x] Generate idempotent ALTER TABLE statements

## Phase 2: Migration Creation ⏸️ PENDING

- [ ] Create migration file via `supabase migration new add_missing_org_fk_constraints`
- [ ] Add idempotent ALTER TABLE statements for:
  - [ ] `impersonation_sessions_projection.target_org_id`
  - [ ] `cross_tenant_access_grants_projection.provider_org_id`
  - [ ] `cross_tenant_access_grants_projection.consultant_org_id`
- [ ] Add verification query as SQL comment
- [ ] Test migration locally with `supabase db push --linked --dry-run`

## Phase 3: Staging Deployment ⏸️ PENDING

- [ ] Deploy migration via `supabase db push --linked`
- [ ] Run verification query to confirm constraints exist
- [ ] Test CASCADE behavior:
  - [ ] Create test organization
  - [ ] Create impersonation session referencing test org
  - [ ] Create cross-tenant grant referencing test org (both columns)
  - [ ] Delete test organization
  - [ ] Verify related records were cascaded

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

**Phase**: Phase 1 - Analysis & Preparation
**Status**: ✅ COMPLETE
**Last Updated**: 2026-01-09
**Next Step**: Create migration file via `supabase migration new add_missing_org_fk_constraints`

## Tables Summary

| Table | Column | Status | Action |
|-------|--------|--------|--------|
| `impersonation_sessions_projection` | `target_org_id` | Missing FK | Add FK ON DELETE CASCADE |
| `cross_tenant_access_grants_projection` | `provider_org_id` | Missing FK | Add FK ON DELETE CASCADE |
| `cross_tenant_access_grants_projection` | `consultant_org_id` | Missing FK | Add FK ON DELETE CASCADE |
| `domain_events` | `stream_id` | Missing FK | Keep as-is (polymorphic) |
| `workflow_queue_projection` | `stream_id` | Missing FK | Keep as-is (polymorphic) |
| `unprocessed_events` | `stream_id` | Missing FK | Keep as-is (polymorphic) |

## Quick Reference: Migration SQL

```sql
-- Run: cd infrastructure/supabase && supabase migration new add_missing_org_fk_constraints

-- 1. impersonation_sessions_projection.target_org_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_impersonation_sessions_target_org'
      AND table_name = 'impersonation_sessions_projection'
  ) THEN
    ALTER TABLE impersonation_sessions_projection
    ADD CONSTRAINT fk_impersonation_sessions_target_org
    FOREIGN KEY (target_org_id)
    REFERENCES organizations_projection(id)
    ON DELETE CASCADE;
  END IF;
END $$;

-- 2. cross_tenant_access_grants_projection.provider_org_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_cross_tenant_grants_provider_org'
      AND table_name = 'cross_tenant_access_grants_projection'
  ) THEN
    ALTER TABLE cross_tenant_access_grants_projection
    ADD CONSTRAINT fk_cross_tenant_grants_provider_org
    FOREIGN KEY (provider_org_id)
    REFERENCES organizations_projection(id)
    ON DELETE CASCADE;
  END IF;
END $$;

-- 3. cross_tenant_access_grants_projection.consultant_org_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_cross_tenant_grants_consultant_org'
      AND table_name = 'cross_tenant_access_grants_projection'
  ) THEN
    ALTER TABLE cross_tenant_access_grants_projection
    ADD CONSTRAINT fk_cross_tenant_grants_consultant_org
    FOREIGN KEY (consultant_org_id)
    REFERENCES organizations_projection(id)
    ON DELETE CASCADE;
  END IF;
END $$;
```

## Notes

- Orphan cleanup was completed on 2026-01-09 before this documentation
- 7 orphaned records were deleted (3 auth.users, 4 domain_events)
- Event store tables (domain_events, workflow_queue_projection, unprocessed_events) intentionally lack FKs due to polymorphic stream_id pattern
