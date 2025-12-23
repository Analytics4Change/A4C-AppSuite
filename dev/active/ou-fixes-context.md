# Context: Organization Unit Fixes

## Decision Record

**Date**: 2025-12-23
**Feature**: Organization Unit UI and Backend Fixes
**Goal**: Fix edit bug, add cascade deactivation, add tree view to Edit page, add delete functionality

### Key Decisions

1. **SQL Array Conversion**: Use `to_jsonb()` wrapper for TEXT[] arrays in `jsonb_build_object()` calls. PostgreSQL requires explicit conversion to embed arrays in JSONB.

2. **Cascade Deactivation Strategy**: Single event with descendant metadata, batch update in processor using ltree path containment (`<@`). No cascade on reactivation - each child reactivated individually for more control.

3. **Tree View Reuse**: Exact same `OrganizationTree` component on Edit page as Manage page. Interactive - clicking another unit navigates to its edit page.

4. **Delete Flow**: Require deactivation before deletion. Two different dialogs based on active status. Parent selection after deletion on both pages.

5. **Accessibility**: Maintain existing WCAG 2.1 Level AA compliance. New dialogs use `role="alertdialog"` for destructive actions.

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

### Files to Modify

- `infrastructure/supabase/supabase/migrations/20240101000000_baseline.sql`
  - Line 1996: Add `to_jsonb(v_updated_fields)`
  - Line 2934: Add `to_jsonb(ARRAY['partial_resource_cleanup'])`
  - Lines 486-519: Add descendant collection to deactivate RPC
  - Lines 5097-5107: Batch update in event processor

- `frontend/src/pages/organization-units/OrganizationUnitsManagePage.tsx`
  - Add delete button in actions panel
  - Add delete confirmation dialog
  - Update deactivation dialog message for cascade

- `frontend/src/pages/organization-units/OrganizationUnitEditPage.tsx`
  - Convert to split layout (grid cols-3)
  - Add OrganizationTree on left panel
  - Add Danger Zone section with delete button
  - Add unsaved changes confirmation dialog

- `frontend/src/viewModels/organization/OrganizationUnitsViewModel.ts`
  - Add `deleteUnit(unitId: string)` method

### Existing Files (No Changes Needed)

- `frontend/src/components/organization-units/OrganizationTree.tsx` - Reuse as-is
- `frontend/src/components/organization-units/OrganizationTreeNode.tsx` - Reuse as-is
- `frontend/src/services/organization/SupabaseOrganizationUnitService.ts` - deleteUnit exists

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

## Reference Materials

- Plan file: `/home/lars/.claude/plans/foamy-orbiting-lampson.md`
- WAI-ARIA Tree Pattern: https://www.w3.org/WAI/ARIA/apg/patterns/treeview/
- Existing Tree implementation: `frontend/src/components/organization-units/`

## Important Constraints

1. **Root Organization**: Cannot be deleted or deactivated (isRootOrganization check)
2. **Children Block Delete**: Cannot delete OU with active children (HAS_CHILDREN error)
3. **Roles Block Delete**: Cannot delete OU with role assignments (HAS_ROLES error)
4. **RLS Scope**: All operations scoped to user's JWT scope_path claim

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
