# Implementation Plan: Fix Organization Unit Delete Silent Failure

## Executive Summary

Deleting a deactivated organization unit appears to succeed (confirmation dialog closes) but the unit remains in the hierarchy tree with no error feedback. The root cause is a missing projection read-back guard in `api.delete_organization_unit()` — the exact same bug pattern fixed for the other 4 org unit RPCs in migration `20260221173821`. A contributing factor is a response key mismatch (`deletedUnit` vs `unit`) between the RPC and the frontend service's defense-in-depth check.

This is a focused, low-risk fix: one SQL migration following an established pattern, plus a one-line frontend change.

## Phase 1: SQL Migration (Backend Fix)

### 1.1 Create Migration File
- `supabase migration new fix_delete_org_unit_projection_guard`
- Replace `api.delete_organization_unit()` with a version that includes the read-back guard
- Follow the exact pattern from migration `20260221173821` (lines 379-400 for deactivate)

### 1.2 Key Changes in the RPC
- Add `v_result RECORD` and `v_processing_error TEXT` to DECLARE block
- After INSERT INTO domain_events, read back: `SELECT * INTO v_result FROM organization_units_projection WHERE id = p_unit_id AND deleted_at IS NOT NULL`
- If NOT FOUND, fetch `processing_error` from `domain_events`, return `{success: false, code: 'PROCESSING_ERROR'}`
- Change response key from `deletedUnit` to `unit` for consistency with all other RPCs
- Include full unit fields (`id`, `name`, `displayName`, `path`, `parentPath`, `timeZone`, `isActive`, `isRootOrganization`, `createdAt`, `updatedAt`, `deletedAt`) in the success response

### 1.3 Deploy and Verify
- Dry-run: `supabase db push --linked --dry-run`
- Apply: `supabase db push --linked`
- Verify via SQL Editor or MCP: call `api.delete_organization_unit()` on a test unit

## Phase 2: Frontend Service Fix

### 2.1 Backward-Compatible Key Fallback
- File: `frontend/src/services/organization/SupabaseOrganizationUnitService.ts:583`
- Add fallback: `const unitData = response.unit || response.deletedUnit;`
- Use `unitData` for the defense-in-depth check and `mapResponseToUnit()`
- Handles both old (pre-migration) and new (post-migration) RPC responses

## Phase 3: Verification and Cleanup

### 3.1 Retry Failed Events
- Query `domain_events` for any `organization_unit.deleted` events with `processing_error IS NOT NULL`
- Retry by clearing `processed_at` and `processing_error`

### 3.2 Update Handler Reference File
- Verify `infrastructure/supabase/handlers/organization_unit/handle_organization_unit_deleted.sql` matches deployed version
- No handler changes expected — handler is correct

### 3.3 End-to-End Validation
- Delete a deactivated org unit via the UI
- Confirm it disappears from the tree
- Confirm parent is auto-selected
- Test constraint dialogs (HAS_CHILDREN, HAS_ROLES) still work

## Success Metrics

### Immediate
- [ ] `api.delete_organization_unit()` returns `{success: true, unit: {..., deletedAt: ...}}` after successful delete
- [ ] `api.delete_organization_unit()` returns `{success: false, code: 'PROCESSING_ERROR'}` when handler fails

### Medium-Term
- [ ] UI deletes deactivated org units and tree updates immediately
- [ ] Error banner appears for any delete failure
- [ ] Constraint dialogs (HAS_CHILDREN, HAS_ROLES) still function correctly

### Long-Term
- [ ] All 5 org unit RPCs (create, update, deactivate, reactivate, delete) have consistent read-back guards
- [ ] All 5 RPCs use the `unit` response key consistently

## Implementation Schedule

| Phase | Scope | Estimate |
|-------|-------|----------|
| Phase 1 | SQL migration | 15 minutes |
| Phase 2 | Frontend service fix | 5 minutes |
| Phase 3 | Verification and cleanup | 10 minutes |
| **Total** | | **~30 minutes** |

## Risk Mitigation

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Migration breaks existing RPCs | Very Low | Only replaces `delete_organization_unit`; other RPCs unchanged |
| Frontend key fallback misses edge case | Very Low | `response.unit \|\| response.deletedUnit` covers both old and new |
| Handler has undiscovered bug | Low | Handler is validated by plpgsql_check; soft-delete logic is simple |

## Next Steps After Completion

1. Update MEMORY.md with fix details and handler counts
2. Archive dev-docs to `dev/archived/fix-org-unit-delete/`
3. Consider adding a plpgsql_check or CI rule to detect missing read-back guards in future RPCs
