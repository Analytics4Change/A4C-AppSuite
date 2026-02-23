# Context: Fix Organization Unit Delete Silent Failure

## Decision Record

**Date**: 2026-02-23
**Feature**: Fix organization unit delete silent failure
**Goal**: Ensure `api.delete_organization_unit()` returns accurate success/failure status by adding a projection read-back guard, and fix the frontend response key mismatch so the UI correctly reflects deletion.

### Key Decisions

1. **Follow established pattern**: Use the exact same read-back guard pattern from migration `20260221173821` that was applied to create/deactivate/reactivate/update. This is not a new pattern — it's filling a gap where delete was missed.

2. **Normalize response key to `unit`**: The delete RPC uniquely uses `deletedUnit` while all other 4 RPCs use `unit`. Standardizing to `unit` eliminates the frontend mismatch and follows the convention.

3. **Add backward-compat in frontend**: The service should accept both `response.unit` and `response.deletedUnit` to handle any in-flight requests or cached RPC definitions during rollout.

4. **Keep handler as-is**: `handle_organization_unit_deleted()` correctly sets `deleted_at` and uses `RAISE WARNING` for idempotent no-ops. The WARNING (not EXCEPTION) is appropriate here because re-processing a delete event should be a silent no-op, not a failure.

5. **No frontend page changes needed**: The `handleDeleteConfirm` callback already has a proper final `else` branch (lines 563-566) that sets `operationError`. Once the backend returns consistent data, this path handles errors correctly.

## Technical Context

### Architecture
- **CQRS event-sourced system**: RPC functions emit events to `domain_events` table; BEFORE INSERT trigger fires handler synchronously; handler updates projection
- **Read-back guard pattern**: After emitting event, RPC reads projection to verify handler succeeded. If NOT FOUND, fetches `processing_error` from `domain_events` and returns structured error
- **Soft-delete model**: Org units are never physically deleted. `deleted_at` timestamp is set, and all queries filter `WHERE deleted_at IS NULL`

### The Bug Chain
1. User clicks Delete → types DELETE → confirms
2. Frontend calls `api.delete_organization_unit(unitId)`
3. RPC validates constraints (no children, no roles) → passes
4. RPC inserts event into `domain_events`
5. BEFORE INSERT trigger fires → handler sets `deleted_at` on projection (this works correctly)
6. RPC returns `{success: true, deletedUnit: {id, name, path}}` using **pre-event snapshot** — never verifies handler ran
7. Frontend checks `response.unit?.id` → `undefined` (key is `deletedUnit`, not `unit`)
8. Defense-in-depth returns `{success: false, code: 'UNKNOWN'}`
9. Page hits `else` branch → closes dialog + sets `operationError` → error banner appears but is not prominent
10. `viewModel.loadUnits()` is **never called** (only called in `result.success` branch)
11. Tree is never refreshed → unit remains visible

### Prior Fix (Migration 20260221173821)
- Fixed `create_organization_unit`: event_data had wrong field names (`root_organization_id` instead of `organization_id`, missing `slug`)
- Added projection read-back guards to create, deactivate, reactivate, and update
- **Did not touch delete** — the function was already "working" (no field mismatches), so it was overlooked
- The read-back guard pattern catches a broader class of failures beyond field mismatches

## File Structure

### Files to Modify

- **New migration** `infrastructure/supabase/supabase/migrations/YYYYMMDDHHMMSS_fix_delete_org_unit_projection_guard.sql`
  - `CREATE OR REPLACE FUNCTION api.delete_organization_unit()` with read-back guard
  - Pattern source: migration `20260221173821` lines 379-400

- **`frontend/src/services/organization/SupabaseOrganizationUnitService.ts`** (line 583)
  - Add `response.deletedUnit` fallback for backward-compat

### Reference Files (read-only, verify after deploy)

- `infrastructure/supabase/handlers/organization_unit/handle_organization_unit_deleted.sql` — handler is correct, no changes
- `infrastructure/supabase/handlers/routers/process_organization_unit_event.sql` — router has CASE for `organization_unit.deleted`, correct

### Files That Established the Pattern

- `infrastructure/supabase/supabase/migrations/20260221173821_fix_org_unit_create_and_projection_guards.sql` — **THE** reference for the read-back guard pattern (380 lines, covers 4 RPCs)
- `infrastructure/supabase/supabase/migrations/20260212010625_baseline_v4.sql:1300-1417` — current broken `delete_organization_unit()` to be replaced

### Frontend Flow (unchanged, for reference)

- `frontend/src/pages/organization-units/OrganizationUnitsManagePage.tsx:521-571` — `handleDeleteConfirm` callback
- `frontend/src/services/organization/SupabaseOrganizationUnitService.ts:551-611` — `deleteUnit()` method
- `frontend/src/services/organization/IOrganizationUnitService.ts` — interface (no changes)

## Key Patterns and Conventions

### Read-Back Guard Pattern (from 20260221173821)
```sql
-- After INSERT INTO domain_events:
SELECT * INTO v_result
FROM organization_units_projection
WHERE id = p_unit_id
  AND deleted_at IS NOT NULL;  -- For delete: verify deleted_at was SET

IF NOT FOUND THEN
  SELECT processing_error INTO v_processing_error
  FROM domain_events
  WHERE stream_id = p_unit_id
    AND event_type = 'organization_unit.deleted'
  ORDER BY sequence_number DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'success', false,
    'error', COALESCE(v_processing_error, 'Projection not updated after delete event'),
    'errorDetails', jsonb_build_object(
      'code', 'PROCESSING_ERROR',
      'message', 'The event was recorded but the handler failed. Check domain_events for details.'
    )
  );
END IF;
```

### Response Key Convention
All org unit RPCs return `unit` (not `deletedUnit`, `createdUnit`, etc.):
```sql
RETURN jsonb_build_object(
  'success', true,
  'unit', jsonb_build_object('id', ..., 'name', ..., ...)
);
```

## Important Constraints

1. **Migration must be idempotent**: `CREATE OR REPLACE FUNCTION` handles this automatically
2. **Handler reference file must stay in sync**: After deploying, verify reference file matches
3. **Frontend fallback covers transition period**: Both `unit` and `deletedUnit` keys accepted
4. **No changes to handler, router, or trigger**: Only the RPC function is replaced
5. **The BEFORE INSERT trigger runs synchronously**: Read-back guard works because handler executes within the same transaction before the RPC continues

## Why This Approach?

**Why not just fix the frontend key check?** That would make the dialog close and tree refresh work, but it wouldn't catch the broader class of handler failures. The read-back guard is the correct architectural pattern (already established for the other 4 RPCs) and ensures the RPC only reports success when the projection is actually updated.

**Why not add error handling in the handler?** The handler is correct — it sets `deleted_at` and logs a warning for already-deleted rows. The issue is that the RPC doesn't verify the handler ran. Fixing the RPC is the right layer.

**Why backward-compat for `deletedUnit` key?** During deployment, there's a brief window where the frontend may have the new code but the old RPC is still deployed (or vice versa). The fallback prevents breakage during this transition.
