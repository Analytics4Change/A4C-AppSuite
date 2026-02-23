# Tasks: Fix Organization Unit Delete Silent Failure

## Phase 1: SQL Migration ✅ COMPLETE

- [x] Create migration: `supabase migration new fix_delete_org_unit_projection_guard`
- [x] Write `CREATE OR REPLACE FUNCTION api.delete_organization_unit()` with:
  - [x] `v_result RECORD` and `v_processing_error TEXT` in DECLARE
  - [x] Read-back guard after INSERT INTO domain_events (`deleted_at IS NOT NULL`)
  - [x] NOT FOUND handler that fetches `processing_error` from `domain_events`
  - [x] Response key changed from `deletedUnit` to `unit`
  - [x] Full unit fields in success response (matching deactivate/reactivate pattern)
- [x] Deploy migration: `supabase db push --linked`
- [x] Verify function exists in production via MCP `execute_sql`

## Phase 2: Frontend Service Fix ✅ COMPLETE

- [x] Add `deletedUnit` property to `MutationResponse` interface (line 77)
- [x] Edit `SupabaseOrganizationUnitService.ts:583` — add `response.deletedUnit` fallback
- [x] TypeScript check passes (`npx tsc --noEmit`)

## Phase 3: Verification and Cleanup ✅ COMPLETE

- [x] Check for failed `organization_unit.deleted` events in `domain_events` — **none found**
- [x] Retry any failed events if found — **N/A, none to retry**
- [x] Handler reference file verified — no changes needed (handler is correct)
- [x] Commit and push: `b30b4cd9`
- [x] All 3 GitHub Actions workflows passed:
  - Deploy Database Migrations: success (43s)
  - Deploy Frontend: success (3m18s)
  - Validate Frontend Documentation: success (2m19s)

## Phase 4: Documentation ✅ COMPLETE

- [x] Update dev-docs (context, tasks, plan) to reflect completion
- [ ] Update MEMORY.md with fix details
- [ ] Archive dev-docs to `dev/archived/fix-org-unit-delete/`

## Success Validation Checkpoints

### Immediate Validation
- [x] `api.delete_organization_unit()` returns `{success: true, unit: {id, ..., deletedAt}}` for valid delete
- [x] Frontend `deleteUnit()` accepts both `unit` and `deletedUnit` response keys
- [x] Migration deployed and all CI workflows green

### Feature Complete Validation (manual, post-deploy)
- [ ] Deactivated org unit deleted via UI disappears from tree immediately
- [ ] Parent node auto-selected after deletion
- [ ] Error banner appears if deletion fails for any reason
- [ ] Constraint dialogs (HAS_CHILDREN, HAS_ROLES) still function correctly
- [ ] No regression in create/update/deactivate/reactivate flows

## Current Status

**Phase**: Phase 4 (Documentation)
**Status**: ✅ COMPLETE — code deployed, awaiting manual UI validation
**Last Updated**: 2026-02-23
**Next Step**: Archive dev-docs to `dev/archived/fix-org-unit-delete/`, update MEMORY.md
