# Tasks: Fix Organization Unit Delete Silent Failure

## Phase 1: SQL Migration ⏸️ PENDING

- [ ] Create migration: `supabase migration new fix_delete_org_unit_projection_guard`
- [ ] Write `CREATE OR REPLACE FUNCTION api.delete_organization_unit()` with:
  - [ ] `v_result RECORD` and `v_processing_error TEXT` in DECLARE
  - [ ] Read-back guard after INSERT INTO domain_events (`deleted_at IS NOT NULL`)
  - [ ] NOT FOUND handler that fetches `processing_error` from `domain_events`
  - [ ] Response key changed from `deletedUnit` to `unit`
  - [ ] Full unit fields in success response (matching deactivate/reactivate pattern)
- [ ] Deploy migration: `supabase db push --linked`
- [ ] Verify via MCP `execute_sql`: call RPC on a test deactivated unit

## Phase 2: Frontend Service Fix ⏸️ PENDING

- [ ] Edit `SupabaseOrganizationUnitService.ts:583` — add `response.deletedUnit` fallback
- [ ] Verify `mapResponseToUnit()` handles the full response fields correctly

## Phase 3: Verification and Cleanup ⏸️ PENDING

- [ ] Check for failed `organization_unit.deleted` events in `domain_events`
- [ ] Retry any failed events if found
- [ ] Update handler reference file if handler was changed (expected: no changes)
- [ ] End-to-end UI test: delete deactivated unit → tree updates → parent selected
- [ ] Regression test: create, update, deactivate, reactivate still work
- [ ] Test constraint dialogs: HAS_CHILDREN, HAS_ROLES

## Phase 4: Documentation ⏸️ PENDING

- [ ] Update MEMORY.md with fix details
- [ ] Archive dev-docs to `dev/archived/fix-org-unit-delete/`

## Success Validation Checkpoints

### Immediate Validation
- [ ] `api.delete_organization_unit()` returns `{success: true, unit: {id, ..., deletedAt}}` for valid delete
- [ ] `api.delete_organization_unit()` returns `{success: false, code: 'PROCESSING_ERROR'}` when handler fails
- [ ] Frontend `deleteUnit()` returns `{success: true}` with mapped unit data

### Feature Complete Validation
- [ ] Deactivated org unit deleted via UI disappears from tree immediately
- [ ] Parent node auto-selected after deletion
- [ ] Error banner appears if deletion fails for any reason
- [ ] Constraint dialogs (HAS_CHILDREN, HAS_ROLES) still function correctly
- [ ] No regression in create/update/deactivate/reactivate flows

## Current Status

**Phase**: Phase 1 (SQL Migration)
**Status**: ⏸️ PENDING (awaiting plan approval)
**Last Updated**: 2026-02-23
**Next Step**: Create SQL migration following pattern from `20260221173821`
