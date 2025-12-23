# Tasks: Organization Unit Fixes

## Phase 1: Backend SQL Fixes ✅ COMPLETE

- [x] Apply `to_jsonb()` wrapper at line 1996 in baseline migration
- [x] Apply `to_jsonb()` wrapper at line 2934 in baseline migration
- [x] Add descendant collection to `deactivate_organization_unit` RPC
- [x] Modify event processor for batch update using ltree
- [x] Create migration file `20251223182421_ou_cascade_deactivation_fix.sql`
- [x] Deploy SQL changes with `supabase db push --linked`
- [x] Verify: Migration applied successfully

## Phase 2: Manage Page Updates ✅ COMPLETE

- [x] Add "Delete Unit" button in actions panel (below deactivate)
- [x] Add delete confirmation dialog (reuse ConfirmDialog pattern)
- [x] Implement `handleDeleteClick` and `handleDeleteConfirm` handlers
- [x] Update deactivation dialog message for cascade (with/without children)
- [x] Change deactivate dialog variant from "danger" to "warning" (orange)
- [x] Implement parent selection after delete (`viewModel.selectNode(parentId)`)
- [x] Verify: Delete inactive unit, selection moves to parent

## Phase 3: Edit Page Refactor ✅ COMPLETE

- [x] Import OrganizationTree and OrganizationUnitsViewModel
- [x] Convert layout to grid cols-3 (2/3 tree, 1/3 form)
- [x] Add tree panel with highlighted current unit
- [x] Implement `onSelect` to navigate to clicked unit's edit page
- [x] Add unsaved changes confirmation dialog
- [x] Add "Danger Zone" section with delete button
- [x] Implement two-step delete flow (active vs inactive dialogs)
- [x] Navigate to Manage page with parent selected after delete
- [x] Update deactivation warning text for cascade
- [x] Verify: Tree shows, navigation works, delete works

## Phase 4: ViewModel Updates ✅ COMPLETE

- [x] Add `deleteUnit(unitId: string)` method to OrganizationUnitsViewModel
- [x] Track parent ID before delete operation
- [x] On success: Reload tree and select parent
- [x] Verify: Delete from both pages uses ViewModel method

## Phase 5: Accessibility Verification ✅ COMPLETE

- [x] Add `role="alertdialog"` to delete confirmation dialogs
- [x] Add `aria-describedby` for dialog descriptions
- [x] Verify focus trap in all dialogs (existing behavior preserved)
- [x] Verify focus returns to trigger button on close
- [x] Add `aria-labelledby` to Danger Zone section
- [x] Add `role="alert"` to field-level error messages
- [x] Keyboard test: Tab through Manage page
- [x] Keyboard test: Tab through Edit page with tree
- [x] Keyboard test: Arrow keys in tree on Edit page

## Success Validation Checkpoints

### Immediate Validation
- [x] Edit OU: Change name, save - no error
- [x] Verify `domain_events` has `updated_fields` as JSON array
- [x] Cascade: Deactivate parent with children - all show inactive

### Feature Complete Validation
- [x] Edit page: Tree shows on left, form on right
- [x] Edit page: Click different unit navigates with unsaved warning
- [x] Delete: Inactive unit deletes, parent selected
- [x] Delete: Active unit shows "deactivate first" dialog

### Accessibility Validation
- [x] Keyboard-only: Complete flow without mouse
- [x] Screen reader: Tree announces correctly
- [ ] axe-core: Zero violations on both pages (not yet run)

## Deployment

- [x] Migration deployed to Supabase production
- [x] Commit created: `4ae185e2`
- [x] Pushed to GitHub main branch
- [x] Frontend deploy workflow passed
- [x] Database migrations workflow passed

## Phase 6: Tree UI Improvements ✅ COMPLETE

- [x] Issue 1: Fix cascade deactivation UI refresh in ViewModel
  - Added `await this.loadUnits()` after successful deactivation
  - Matches pattern from `deleteUnit()` method
- [x] Issue 2: Fix indentation layout with spacer element
  - Replaced inline `paddingLeft` with dedicated indent spacer element
  - Fixed badges being pushed to wrong side
- [x] Issue 3: Add tree connector lines
  - Added `isLastChild` prop to OrganizationTreeNodeProps
  - Added vertical + horizontal connector lines for non-root nodes
  - L-shape for last child, continuing line for others
- [x] Issue 4 Backend: Cascade reactivation SQL
  - Modified `api.reactivate_organization_unit` to collect inactive descendants
  - Modified `process_organization_unit_event` for cascade reactivation
  - Created migration `20251223120146_ou_cascade_reactivation.sql`
- [x] Issue 4 Frontend: Reactivate button on ManagePage
  - Added conditional Deactivate/Reactivate button
  - Green styling (text-green-600, border-green-300)
  - Success variant ConfirmDialog
- [x] Issue 4 Frontend: Reactivate button on EditPage
  - Added Reactivate section in Danger Zone (for inactive units)
  - Added Reactivate confirmation dialog

## Current Status

**Phase**: ALL PHASES COMPLETE (including Tree UI Improvements)
**Status**: ✅ COMPLETE
**Last Updated**: 2025-12-23
**Next Step**: Archive dev-docs to `dev/archived/ou-fixes/` and optionally run axe-core audit
