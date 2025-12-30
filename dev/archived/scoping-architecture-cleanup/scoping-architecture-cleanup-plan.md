# Implementation Plan: RBAC Scoping Architecture Cleanup

## Executive Summary

This initiative addresses critical event sourcing integrity issues and simplifies the RBAC scoping architecture. We discovered that 19 permissions, 5 users, 6 user role assignments, and 2 invitations exist as "orphaned projections" without corresponding domain events - breaking the CQRS invariant that all projections should be derivable from the event store.

Additionally, the `role.create` permission has incorrect `scope_type='global'` when it should be `scope_type='org'`, causing the UI to incorrectly display "Role Management" in both Global and Organization scope sections. This plan regenerates all permissions from an authoritative seed file, backfills missing events, simplifies `scope_type` values, and optionally generates a new clean Day 0 baseline.

## Phase 1: Event Sourcing Integrity

### 1.1 Permissions Seed File Creation
- Create authoritative seed file with all 42 permissions
- Define correct `scope_type` values (fixing `role.create` to `org`)
- Use proper event sourcing pattern (INSERT INTO domain_events)
- Expected outcome: Single source of truth for permission definitions

### 1.2 Permissions Regeneration
- TRUNCATE permissions_projection CASCADE
- DELETE existing permission.defined events
- Execute seed file to emit fresh events
- Verify projections rebuilt from events
- Expected outcome: All 42 permissions have matching domain events

### 1.3 Backfill Other Orphaned Events
- Generate user.registered events for 5 orphaned users
- Generate user.role.assigned events for orphaned role assignments
- Generate invitation.created events for 2 orphaned invitations
- Expected outcome: All projections have corresponding events

## Phase 2: Documentation

### 2.1 Scoping Architecture Documentation
- Create new `scoping-architecture.md` explaining three mechanisms
- Document how `scope_type`, `organization_id`, and `org_type` interact
- Add architecture diagram

### 2.2 Update Existing Documentation
- Remove references to unused scope_type values (facility, program, client)
- Update permissions_projection.md with simplified constraint
- Update rbac-architecture.md

## Phase 3: Schema Simplification

### 3.1 Simplify scope_type Constraint
- Update CHECK constraint to only allow 'global' and 'org'
- Remove references to facility/program/client from docs
- Update frontend ScopeType type definition

### 3.2 Test Data Cleanup
- Remove user_roles with fake org_id 'aaaaaaaa-...'
- Verify remaining data integrity

## Phase 4: Day 0 Baseline (Optional)

### 4.1 Verification
- Run audit queries to confirm 0 orphaned projections
- Verify UI displays correctly
- Confirm no authorization regressions

### 4.2 Baseline Generation
- Backup current state
- Generate new baseline via `supabase db dump`
- Archive old migrations
- Mark new baseline as applied

## Success Metrics

### Immediate
- [ ] All 42 permissions have corresponding domain events
- [ ] `role.create` has `scope_type='org'`
- [ ] UI shows "Role Management" only in Organization Scope section

### Medium-Term
- [ ] All projections have corresponding events (0 orphaned)
- [ ] scope_type simplified to only 'global' and 'org'
- [ ] Test data cleaned up
- [ ] Documentation updated

### Long-Term
- [ ] New Day 0 baseline captures clean state
- [ ] No event sourcing integrity issues in future

## Implementation Schedule

- Phase 1: 1-2 hours (seed file creation + regeneration + backfill)
- Phase 2: 30-60 minutes (documentation)
- Phase 3: 30 minutes (schema simplification + cleanup)
- Phase 4: 30 minutes (optional baseline regeneration)

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Projection rebuild fails | Use ON CONFLICT DO NOTHING, verify counts before/after |
| Authorization breaks | Test in dev environment first, verify RLS policies |
| Missing permissions | Verify all 42 permissions present after regeneration |
| Event processor issues | Check process_rbac_event function handles permission.defined |

## Next Steps After Completion

1. Verify UI displays correctly in production
2. Consider similar audit for other projection tables
3. Update any CI/CD checks for event sourcing integrity
