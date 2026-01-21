# Implementation Plan: Missing FK Constraints

## Executive Summary

During staging environment cleanup operations, analysis revealed several tables with organization-related columns that lack foreign key constraints to `organizations_projection`. This creates orphaned records when organizations are deleted. This plan addresses adding the missing FK constraints while documenting which missing FKs are intentional (by design) versus oversights.

Three tables require FK constraint additions:
1. `impersonation_sessions_projection.target_org_id` (oversight)
2. `cross_tenant_access_grants_projection.provider_org_id` (recommended)
3. `cross_tenant_access_grants_projection.consultant_org_id` (recommended)

Three tables intentionally lack FKs (event store pattern):
- `domain_events.stream_id` - polymorphic reference to multiple aggregate types
- `workflow_queue_projection.stream_id` - same pattern
- `unprocessed_events.stream_id` - same pattern

## Phase 1: Migration Creation

### 1.1 Create Supabase Migration File
- Use `supabase migration new add_missing_org_fk_constraints`
- Write idempotent ALTER TABLE statements using DO blocks
- Include verification queries as comments

### 1.2 Test Migration Locally
- Run `supabase db push --linked --dry-run` to preview
- Verify no existing data violates proposed constraints
- Confirm idempotency by running migration twice

**Time estimate**: 30 minutes

## Phase 2: Staging Deployment

### 2.1 Deploy to Staging
- Apply migration via `supabase db push --linked`
- Verify constraints exist via information_schema query
- Test organization deletion cascades correctly

### 2.2 Validate Cascade Behavior
- Create test organization
- Create impersonation session and cross-tenant grants referencing it
- Delete organization and confirm related records are cascaded

**Time estimate**: 1 hour

## Phase 3: Documentation Update

### 3.1 Update Schema Documentation
- Document intentionally missing FKs in table docs
- Add FK relationships to affected table documentation
- Update AGENT-INDEX.md keywords if needed

### 3.2 Update Orphan Detection Tooling
- Document orphan detection methodology for non-FK tables
- Add to /org-cleanup and /org-cleanup-dryrun skills

**Time estimate**: 1 hour

## Success Metrics

### Immediate
- [ ] Migration file created with idempotent SQL
- [ ] Dry-run succeeds without errors
- [ ] All three FK constraints added successfully

### Medium-Term
- [ ] Cascade delete works correctly for all three relationships
- [ ] No orphaned records created during normal operations
- [ ] Documentation updated to reflect FK relationships

### Long-Term
- [ ] Future org deletions automatically clean up related records
- [ ] Orphan cleanup operations find zero orphans in these tables

## Implementation Schedule

| Phase | Task | Duration |
|-------|------|----------|
| Phase 1 | Migration creation and local testing | 30 min |
| Phase 2 | Staging deployment and validation | 1 hour |
| Phase 3 | Documentation updates | 1 hour |
| **Total** | | **2.5 hours** |

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Existing orphaned data blocks FK creation | Run orphan cleanup first (already done) |
| CASCADE deletes too much data | Use explicit CASCADE; document behavior |
| Migration not idempotent | Use DO blocks with IF NOT EXISTS checks |

## Next Steps After Completion

1. Consider adding similar FK audit to CI/CD pipeline
2. Create scheduled job for staging environment orphan detection
3. Add FK constraint validation to schema review checklist
