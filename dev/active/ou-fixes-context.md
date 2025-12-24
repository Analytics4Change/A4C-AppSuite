# Context: Organization Unit Fixes

## Decision Record

**Date**: 2025-12-23
**Feature**: Organization Unit UI and Backend Fixes
**Goal**: Fix edit bug, add cascade deactivation, add tree view to Edit page, add delete functionality
**Status**: ✅ COMPLETE - All issues resolved including page consolidation and delete bug fix (2025-12-24)

### Key Decisions

1. **SQL Array Conversion**: Use `to_jsonb()` wrapper for TEXT[] arrays in `jsonb_build_object()` calls. PostgreSQL requires explicit conversion to embed arrays in JSONB.

2. **Cascade Deactivation Strategy**: Single event with descendant metadata, batch update in processor using ltree path containment (`<@`).

7. **Cascade Reactivation** (Updated 2025-12-23): User changed mind from "no cascade" to full cascade. Reactivating parent now reactivates all inactive descendants. Mirrors deactivation behavior for symmetry. Both use ltree containment for efficient batch updates.

3. **Tree View Reuse**: Exact same `OrganizationTree` component on Edit page as Manage page. Interactive - clicking another unit navigates to its edit page.

4. **Delete Flow**: Require deactivation before deletion. Two different dialogs based on active status. Parent selection after deletion on both pages.

5. **Accessibility**: Maintain existing WCAG 2.1 Level AA compliance. New dialogs use `role="alertdialog"` for destructive actions. Added `role="alert"` to field-level error messages.

6. **Migration Strategy**: Created new migration file `20251223182421_ou_cascade_deactivation_fix.sql` rather than modifying baseline directly for production deployment. Baseline also updated to keep source of truth consistent.

8. **RootPath Auto-Detection** (Added 2025-12-23): Never hardcode paths like `root.provider.acme_healthcare`. Production subdomains vary (e.g., `poc-test1-20251223`). ViewModel now auto-detects rootPath from root organization's actual path in the database.

9. **Stay on Edit Page After Save** (Added 2025-12-24): After saving changes, stay on the edit page instead of redirecting to manage page. Reload tree and unit data to reflect changes (name, parent), expand tree to show the edited OU.

10. **Page Consolidation Refactor** (Added 2025-12-24): Merged Edit page functionality into Manage page for unified single-page interface. Select unit → immediately editable form. Create also inline. No separate edit route.
   - Deleted `OrganizationUnitEditPage.tsx`
   - Removed `/organization-units/:unitId/edit` route
   - ManagePage now has 3 panel modes: `empty`, `edit`, `create`
   - Unsaved changes warning when switching between units
   - Extracted `ConfirmDialog` to shared component

11. **Hard-Delete vs Soft-Delete Semantics** (Added 2025-12-24): Different projection tables use different deletion strategies:
   - `organization_units_projection`: **Soft-delete** with `deleted_at` column (organizations never physically deleted)
   - `user_roles_projection`: **Hard-delete** (row removal on revocation, no `deleted_at` column)
   - When checking for role assignments, don't filter by `deleted_at` - if role is revoked, row is gone

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

### Files Modified - 2025-12-23 (Phase 6: Tree UI Improvements)

- `frontend/src/components/organization-units/OrganizationTree.tsx`
  - Added `isLastChild` prop to root-level nodes

- `frontend/src/components/organization-units/OrganizationTreeNode.tsx`
  - Added `isLastChild` prop to interface
  - Replaced `paddingLeft` with dedicated spacer element (fixes indentation layout)
  - Added tree connector lines (vertical + horizontal) for non-root nodes
  - L-shape for last child, continuing line for others

- `frontend/src/viewModels/organization/OrganizationUnitsViewModel.ts`
  - Added `reactivateUnit(unitId: string)` method
  - Added `canReactivate` computed property
  - Fixed cascade deactivation UI refresh: added `loadUnits()` after deactivation

- `frontend/src/pages/organization-units/OrganizationUnitsManagePage.tsx`
  - Added conditional Deactivate/Reactivate button (green styling for reactivate)
  - Added `success` variant to ConfirmDialog with green styling
  - Added reactivate confirmation dialog

- `frontend/src/pages/organization-units/OrganizationUnitEditPage.tsx`
  - Added Reactivate section in Danger Zone (for inactive units)
  - Added `success` variant to ConfirmDialog
  - Added reactivate confirmation dialog

- `.claude/skills/infrastructure-guidelines/SKILL.md`
  - Added CRITICAL warning about using `supabase migration new`
  - Updated section 6 with explicit guidance against manual migration creation

### New Files Created - 2025-12-23 (Phase 6)

- `infrastructure/supabase/supabase/migrations/20251223193037_ou_cascade_reactivation.sql`
  - Cascade reactivation for Organization Units
  - Modified `api.reactivate_organization_unit` to collect inactive descendants
  - Modified `process_organization_unit_event` for cascade update via ltree

### Existing Files (No Changes Needed)

- `frontend/src/services/organization/SupabaseOrganizationUnitService.ts` - reactivateUnit already existed

### Files Modified - 2025-12-23 (Phase 7: Tree Indentation Fix)

- `frontend/src/components/organization-units/OrganizationTreeNode.tsx`
  - Changed `<li>` to use `marginLeft: depth * INDENT_SIZE` instead of internal spacer
  - Positioned badges absolutely at right edge with `absolute right-2 top-1/2 -translate-y-1/2`
  - Fixed connector lines: use explicit `height` instead of `top/bottom` positioning
  - Added `pr-40` to node row for badge space reservation

- `frontend/src/viewModels/organization/OrganizationUnitsViewModel.ts`
  - CRITICAL FIX: Removed hardcoded `DEFAULT_ROOT_PATH = 'root.provider.acme_healthcare'`
  - Added auto-detection: `loadUnits()` now finds root org and uses its path as rootPath
  - This fixes depth calculation for any subdomain format (e.g., `poc-test1-20251223`)

### Files Modified - 2025-12-24 (Phase 11: Page Consolidation Refactor)

- `frontend/src/pages/organization-units/OrganizationUnitsManagePage.tsx`
  - Complete rewrite: merged Edit page functionality into Manage page (1161 lines)
  - Added `panelMode` state: `'empty' | 'edit' | 'create'`
  - Added `formViewModel` for form state management
  - Added `handleTreeSelect` with dirty check and unsaved changes dialog
  - Added inline create mode with parent pre-selection
  - Added all edit form fields: name, display name, timezone, active status
  - Added danger zone section for non-root units
  - Added query parameter support: `?select=uuid` for deep links
  - Replaced ConfirmDialog with extracted shared component

- `frontend/src/App.tsx`
  - Removed `OrganizationUnitEditPage` import
  - Removed `/organization-units/:unitId/edit` route

- `frontend/src/pages/organization-units/index.ts`
  - Removed `OrganizationUnitEditPage` export

### Files Created - 2025-12-24 (Phase 11: Page Consolidation Refactor)

- `frontend/src/components/ui/ConfirmDialog.tsx`
  - Extracted shared ConfirmDialog component (110 lines)
  - Supports variants: danger, warning, success, default
  - ARIA accessible with alertdialog role

### Files Deleted - 2025-12-24 (Phase 11: Page Consolidation Refactor)

- `frontend/src/pages/organization-units/OrganizationUnitEditPage.tsx`
  - Functionality merged into ManagePage

### Files Modified - 2025-12-24 (Phase 10: Stay on Edit Page After Save) - SUPERSEDED

- `frontend/src/pages/organization-units/OrganizationUnitEditPage.tsx`
  - Modified `handleSubmit` (lines 263-285) to stay on edit page after save
  - Replaced `navigate('/organization-units/manage')` with tree/unit reload and expand
  - Updated dependency array with `treeViewModel`, `loadUnit`, `unitId`
  - **Note**: This phase was superseded by Phase 11 page consolidation

### Files Modified - 2025-12-23 (Phase 8: Checkbox Active State Fix)

- `frontend/src/pages/organization-units/OrganizationUnitEditPage.tsx`
  - Changed checkbox to read from `unit.isActive` (database state) instead of `formViewModel.formData.isActive` (local state)
  - Extracted `loadUnit()` as reusable `useCallback` for post-operation refresh
  - Added deactivate dialog state (`showDeactivateDialog`, `isDeactivating`)
  - Added `handleDeactivateClick`, `handleDeactivateConfirm`, `handleDeactivateCancel` handlers
  - Updated `handleReactivateConfirm` to use `loadUnit()` + `treeViewModel.loadUnits()` instead of `window.location.reload()`
  - Wire checkbox `onCheckedChange` to trigger appropriate confirmation dialogs based on current state
  - Added disabled state during API operations to prevent double-clicks
  - Added glassmorphic styling to checkbox: `shadow-sm ring-1 ring-gray-300 bg-white/80 backdrop-blur-sm`
  - Added deactivate confirmation dialog with cascade warning for units with children

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
| `caf08dbb` | feat(ou): Add tree connector lines, cascade reactivation, and UI fixes | ✅ Deployed |
| `efda39d9` | fix(infra): Recreate migration with correct CLI-generated timestamp | ✅ Deployed |
| `f6fb43f3` | fix(ou): Fix tree indentation, connector lines, and badge alignment | ✅ Deployed |
| `1bdc158f` | fix(ou): Auto-detect root path for tree depth calculation | ✅ Deployed |
| `09f7e91e` | fix(ou): Wire active checkbox to API with confirmation dialogs | ✅ Deployed |
| `014003bd` | refactor(ou): Consolidate Edit page into ManagePage | ✅ Deployed |
| `fdfc7d99` | fix(ou): Remove invalid deleted_at check on user_roles_projection | ✅ Deployed |

- **Migrations Applied**:
  - `20251223182421_ou_cascade_deactivation_fix.sql`
  - `20251223193037_ou_cascade_reactivation.sql`
  - `20251223213418_ou_update_diagnostic_logging.sql` - Diagnostic logging (superseded by fix)
  - `20251224164206_ou_array_append_fix.sql` - **THE ACTUAL FIX** - Uses `array_append()` instead of `||`
  - `20251224180351_ou_delete_fix_user_roles_check.sql` - Remove invalid `deleted_at` check on `user_roles_projection`
- **Frontend**: Deployed via GitHub Actions
- **Database**: Migrations workflow passed

### Files Modified - 2025-12-24 (Phase 12: OU Delete Bug Fix)

- `infrastructure/supabase/supabase/migrations/20240101000000_baseline.sql`
  - Line ~627-632: Removed `AND ur.deleted_at IS NULL` from role assignment check
  - Added comment explaining `user_roles_projection` uses hard-delete

### Files Created - 2025-12-24 (Phase 12: OU Delete Bug Fix)

- `infrastructure/supabase/supabase/migrations/20251224180351_ou_delete_fix_user_roles_check.sql`
  - Fixes `api.delete_organization_unit()` function
  - Removes invalid `ur.deleted_at IS NULL` condition
  - References documentation citations for hard-delete vs soft-delete patterns

## Lessons Learned - 2025-12-23

### Migration Timestamp Issue

**Problem**: Migration `20251223120146_ou_cascade_reactivation.sql` was manually created with a timestamp earlier than already-deployed migration `20251223182421`, causing CI/CD failure.

**Root Cause**: Agent manually created the file instead of using `supabase migration new` command.

**Fix**:
1. Deleted manually-created migration
2. Created new migration with `supabase migration new ou_cascade_reactivation`
3. CLI generated correct timestamp: `20251223193037`

**Process Improvement**: Updated `infrastructure-guidelines` skill with explicit warnings:
- ALWAYS use `supabase migration new <name>` to create migrations
- NEVER manually create files with hand-typed timestamps
- CLI generates correct UTC timestamp automatically

### RootPath Mismatch Issue

**Problem**: Tree indentation and connector lines were not visible despite code being deployed correctly.

**Root Cause**: ViewModel had hardcoded `rootPath = "root.provider.acme_healthcare"` (3 segments), but production paths used actual subdomain format (e.g., `poc-test1-20251223` - 1 segment).

**Depth Calculation Bug**:
```typescript
// calculateDepth returns: unitSegments - rootSegments
// With hardcoded 3-segment rootPath:
// - "poc-test1-20251223.aspen" (2 segments): 2 - 3 = -1 ❌
// - "poc-test1-20251223.aspen.downstairs" (3 segments): 3 - 3 = 0 ❌
// All depths were 0 or negative = no margin-left applied!
```

**Fix**: Auto-detect rootPath from the actual root organization's path in `loadUnits()`:
```typescript
const rootOrg = units.find((u) => u.isRootOrganization);
if (rootOrg) {
  this.rootPath = rootOrg.path;  // Uses actual path from database
}
```

**Lesson**: Never hardcode paths that are environment-specific. Always derive them from actual data.

### Checkbox State Mismatch Issue

**Problem**: Checkbox showed "checked" (active) while tree showed "Inactive" badge - confusing UI discrepancy.

**Root Cause**: Two independent data sources that don't sync:
- Tree reads from `OrganizationUnitsViewModel.rawUnits` → `node.isActive` (database state)
- Checkbox read from `OrganizationUnitFormViewModel.formData.isActive` (local form state)
- The `toggleActive()` method only updated local state that was never persisted

**Fix**:
1. Changed checkbox to read from `unit.isActive` (database state via loaded unit)
2. Wired `onCheckedChange` to call `deactivateUnit()`/`reactivateUnit()` APIs with confirmation dialogs
3. After API success, reload both tree (`treeViewModel.loadUnits()`) and unit (`loadUnit()`) without full page refresh

**Lesson**: For state that persists to backend, always read from the source of truth (loaded entity) not local form state, and always use API calls with proper refresh instead of local state toggles.

### Malformed Array Literal Bug - RESOLVED (2025-12-24)

**Problem**: "malformed array literal" error when saving OU field changes (name, display_name, timezone).

**Root Cause**: The `||` operator for TEXT[] concatenation is **ambiguous**.

```sql
-- This FAILS - PostgreSQL tries to parse 'display_name' as array literal '{display_name}'
v_updated_fields := v_updated_fields || 'display_name';

-- This WORKS - Explicit single-element append
v_updated_fields := array_append(v_updated_fields, 'display_name');
```

PostgreSQL error message "malformed array literal: display_name" means it tried to parse `'display_name'` as `'{display_name}'` array syntax, which failed because it doesn't start with `{`.

**Why `to_jsonb()` wasn't the issue**: The error occurred BEFORE the INSERT statement, during the array concatenation step. The `to_jsonb()` fix was correct for embedding TEXT[] in JSONB, but the array was never successfully built.

**Investigation Path**:
1. Deployed diagnostic logging migration - no `[OU_UPDATE]` logs appeared
2. Realized error occurred before function's first RAISE NOTICE
3. Tested array patterns in isolation: `TEXT[] || 'string'` fails, `array_append()` works

**Fix Applied**: Migration `20251224164206_ou_array_append_fix.sql`
- Changed all `v_updated_fields := v_updated_fields || 'field'` to `array_append()`
- User verified: OU update now works correctly

**Lesson**: When appending to TEXT[] arrays in PL/pgSQL, ALWAYS use `array_append(array, element)` instead of `array || 'element'`. The `||` operator is ambiguous and PostgreSQL may interpret the string as an array literal.

### Hard-Delete vs Soft-Delete Mismatch Bug - RESOLVED (2025-12-24)

**Problem**: Deleting an OU failed with `column ur.deleted_at does not exist`

**Root Cause**: `api.delete_organization_unit()` assumed all projection tables use soft-delete with `deleted_at` column. But `user_roles_projection` uses **hard-delete** - when a role is revoked, the row is physically removed.

**SQL with bug**:
```sql
SELECT COUNT(*) INTO v_role_count
FROM user_roles_projection ur
WHERE ur.scope_path IS NOT NULL
  AND ur.scope_path <@ v_existing.path
  AND ur.deleted_at IS NULL;  -- ERROR: column doesn't exist!
```

**Documentation Citations**:
- `user_roles_projection.md` line 811: "Revoked roles removed from projection (not soft deleted)"
- `organizations_projection.md` line 106: "Organizations never physically deleted" (soft-delete)

**Fix**: Remove the invalid `AND ur.deleted_at IS NULL` condition. If a role is revoked, the row is gone - no need to filter by deletion timestamp.

**Lesson**: Different projection tables may use different deletion semantics. Always check the table documentation before assuming `deleted_at` exists. In this codebase:
- Organizations/OUs: soft-delete (`deleted_at` column)
- Role assignments: hard-delete (row removal)
