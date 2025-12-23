# Context: Organization Unit Fixes

## Decision Record

**Date**: 2025-12-23
**Feature**: Organization Unit UI and Backend Fixes
**Goal**: Fix edit bug, add cascade deactivation, add tree view to Edit page, add delete functionality
**Status**: ✅ COMPLETE - All 4 issues resolved and deployed

### Key Decisions

1. **SQL Array Conversion**: Use `to_jsonb()` wrapper for TEXT[] arrays in `jsonb_build_object()` calls. PostgreSQL requires explicit conversion to embed arrays in JSONB.

2. **Cascade Deactivation Strategy**: Single event with descendant metadata, batch update in processor using ltree path containment (`<@`). No cascade on reactivation - each child reactivated individually for more control.

3. **Tree View Reuse**: Exact same `OrganizationTree` component on Edit page as Manage page. Interactive - clicking another unit navigates to its edit page.

4. **Delete Flow**: Require deactivation before deletion. Two different dialogs based on active status. Parent selection after deletion on both pages.

5. **Accessibility**: Maintain existing WCAG 2.1 Level AA compliance. New dialogs use `role="alertdialog"` for destructive actions. Added `role="alert"` to field-level error messages.

6. **Migration Strategy**: Created new migration file `20251223182421_ou_cascade_deactivation_fix.sql` rather than modifying baseline directly for production deployment. Baseline also updated to keep source of truth consistent.

## Technical Context

### Architecture

Organization Units use CQRS/Event Sourcing pattern:
- `domain_events` table stores all state changes as immutable events
- `organization_units_projection` is the read model derived from events
- RPC functions in `api` schema emit events, triggers update projections
- ltree extension provides hierarchical path queries

### Tech Stack

- **Backend**: PostgreSQL with ltree extension, Supabase RPC functions
- **Frontend**: React 19, TypeScript, MobX, Tailwind CSS
- **Components**: OrganizationTree (WAI-ARIA tree pattern), ConfirmDialog

### Dependencies

- Supabase CLI for migrations (`supabase db push --linked`)
- OrganizationUnitsViewModel for tree state management
- IOrganizationUnitService interface (deleteUnit already exists)

## File Structure

### Files Modified - 2025-12-23

- `infrastructure/supabase/supabase/migrations/20240101000000_baseline.sql`
  - Line ~2014: Added `to_jsonb(v_updated_fields)` in update_organization_unit
  - Line ~2952: Added `to_jsonb(ARRAY['partial_resource_cleanup'])` in handle_bootstrap_workflow
  - Lines ~488-501: Added descendant collection to deactivate RPC
  - Lines ~5115-5131: Batch cascade update in event processor using ltree

- `frontend/src/pages/organization-units/OrganizationUnitsManagePage.tsx`
  - Added delete button in actions panel (enabled only for inactive units)
  - Added delete confirmation dialog with ConfirmDialog component
  - Changed deactivate dialog variant from "danger" to "warning" (orange color)
  - Updated deactivation dialog message to mention cascade behavior
  - Added `aria-describedby` to dialog for accessibility

- `frontend/src/pages/organization-units/OrganizationUnitEditPage.tsx`
  - Major refactor: converted to split layout (grid cols-3)
  - Left panel (col-span-2): OrganizationTree with current unit highlighted
  - Right panel (col-span-1): Edit form card
  - Added tree ViewModel and tree loading state
  - Added unsaved changes confirmation dialog
  - Added Danger Zone section at bottom (only for non-root orgs)
  - Implemented two-step delete flow (active vs inactive dialogs)
  - Navigate to Manage page with parent selected after delete
  - Added `role="alert"` to field-level error messages

- `frontend/src/viewModels/organization/OrganizationUnitsViewModel.ts`
  - Added `deleteUnit(unitId: string)` method (lines ~280-310)
  - Tracks parent ID before delete operation
  - On success: Reloads tree and selects parent node

### New Files Created - 2025-12-23

- `infrastructure/supabase/supabase/migrations/20251223182421_ou_cascade_deactivation_fix.sql`
  - Contains `CREATE OR REPLACE FUNCTION` statements for all 4 modified functions
  - Idempotent migration for production deployment

- `dev/active/ou-fixes-context.md` - This file
- `dev/active/ou-fixes-plan.md` - Implementation plan
- `dev/active/ou-fixes-tasks.md` - Task tracking

### Existing Files (No Changes Needed)

- `frontend/src/components/organization-units/OrganizationTree.tsx` - Reused as-is
- `frontend/src/components/organization-units/OrganizationTreeNode.tsx` - Reused as-is
- `frontend/src/services/organization/SupabaseOrganizationUnitService.ts` - deleteUnit already existed

## Related Components

- `OrganizationTree` - WAI-ARIA compliant tree with full keyboard navigation
- `OrganizationTreeNode` - Individual tree item with ARIA attributes
- `OrganizationUnitsViewModel` - MobX observable for tree state
- `ConfirmDialog` - Existing dialog pattern on Manage page

## Key Patterns and Conventions

### Event Sourcing Pattern
```sql
INSERT INTO domain_events (event_type, stream_type, stream_id, event_data)
VALUES ('organization_unit.updated', 'organization_unit', p_unit_id, jsonb_build_object(...));
```

### ARIA Tree Pattern
- Container: `role="tree"` with `aria-label`
- Items: `role="treeitem"` with `aria-selected`, `aria-expanded`, `aria-level`
- Groups: `role="group"` for children

### Dialog Pattern
- `role="dialog"` or `role="alertdialog"` (destructive)
- `aria-modal="true"`
- `aria-labelledby` pointing to title
- `aria-describedby` pointing to description

### Cascade Deactivation SQL Pattern
```sql
-- In event processor: batch update using ltree containment
UPDATE organization_units_projection
SET is_active = false, deactivated_at = p_event.created_at
WHERE path <@ (p_event.event_data->>'path')::ltree  -- Parent + all descendants
  AND is_active = true
  AND deleted_at IS NULL;
```

## Reference Materials

- Plan file: `/home/lars/.claude/plans/foamy-orbiting-lampson.md`
- WAI-ARIA Tree Pattern: https://www.w3.org/WAI/ARIA/apg/patterns/treeview/
- Existing Tree implementation: `frontend/src/components/organization-units/`
- Supabase migration docs: `documentation/infrastructure/guides/supabase/DAY0-MIGRATION-GUIDE.md`

## Important Constraints

1. **Root Organization**: Cannot be deleted or deactivated (isRootOrganization check)
2. **Children Block Delete**: Cannot delete OU with active children (HAS_CHILDREN error)
3. **Roles Block Delete**: Cannot delete OU with role assignments (HAS_ROLES error)
4. **RLS Scope**: All operations scoped to user's JWT scope_path claim
5. **Migration Naming**: Supabase CLI uses `YYYYMMDDHHMMSS` timestamp format

## Why This Approach?

**Cascade Deactivation**: Chosen over "block deactivation if has children" because:
- Role assignments are already blocked by `validate_role_scope_path_active` trigger
- Children appear active in UI despite being effectively frozen - confusing UX
- Single event with metadata provides complete audit trail

**Require Deactivation Before Delete**: Chosen over direct delete because:
- Built-in confirmation step prevents accidental deletions
- Deactivation is reversible; deletion is permanent
- Consistent with enterprise UX patterns for destructive actions

**Interactive Tree on Edit Page**: Chosen over read-only because:
- Quick editing workflow across multiple OUs
- Unsaved changes dialog prevents data loss
- Consistent with Manage page behavior

## Deployment Summary

| Commit | Description | Status |
|--------|-------------|--------|
| `4ae185e2` | feat(ou): Fix edit bug, add cascade deactivation, and improve UI | ✅ Deployed |

- **Migration**: `20251223182421_ou_cascade_deactivation_fix.sql` applied
- **Frontend**: Deployed via GitHub Actions
- **Database**: Migrations workflow passed
