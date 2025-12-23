# Tasks: Organization Unit Fixes

## Phase 1: Backend SQL Fixes ✅ IN PROGRESS

- [ ] Apply `to_jsonb()` wrapper at line 1996 in baseline migration
- [ ] Apply `to_jsonb()` wrapper at line 2934 in baseline migration
- [ ] Add descendant collection to `deactivate_organization_unit` RPC
- [ ] Modify event processor for batch update using ltree
- [ ] Deploy SQL changes with `supabase db push --linked`
- [ ] Verify: Edit OU saves without error

## Phase 2: Manage Page Updates

- [ ] Add "Delete Unit" button in actions panel (below deactivate)
- [ ] Add delete confirmation dialog (reuse ConfirmDialog pattern)
- [ ] Implement `handleDeleteClick` and `handleDeleteConfirm` handlers
- [ ] Update deactivation dialog message for cascade (with/without children)
- [ ] Implement parent selection after delete (`viewModel.selectNode(parentId)`)
- [ ] Verify: Delete inactive unit, selection moves to parent

## Phase 3: Edit Page Refactor

- [ ] Import OrganizationTree and OrganizationUnitsViewModel
- [ ] Convert layout to grid cols-3 (2/3 tree, 1/3 form)
- [ ] Add tree panel with highlighted current unit
- [ ] Implement `onSelect` to navigate to clicked unit's edit page
- [ ] Add unsaved changes confirmation dialog
- [ ] Add "Danger Zone" section with delete button
- [ ] Implement two-step delete flow (active vs inactive dialogs)
- [ ] Navigate to Manage page with parent selected after delete
- [ ] Update deactivation warning text for cascade
- [ ] Verify: Tree shows, navigation works, delete works

## Phase 4: ViewModel Updates

- [ ] Add `deleteUnit(unitId: string)` method to OrganizationUnitsViewModel
- [ ] Track parent ID before delete operation
- [ ] On success: Reload tree and select parent
- [ ] Verify: Delete from both pages uses ViewModel method

## Phase 5: Accessibility Verification

- [ ] Add `role="alertdialog"` to delete confirmation dialogs
- [ ] Add `aria-describedby` for dialog descriptions
- [ ] Verify focus trap in all dialogs
- [ ] Verify focus returns to trigger button on close
- [ ] Add `aria-labelledby` to Danger Zone section
- [ ] Keyboard test: Tab through Manage page
- [ ] Keyboard test: Tab through Edit page with tree
- [ ] Keyboard test: Arrow keys in tree on Edit page
- [ ] Run axe DevTools audit on both pages

## Success Validation Checkpoints

### Immediate Validation
- [ ] Edit OU: Change name, save - no error
- [ ] Verify `domain_events` has `updated_fields` as JSON array
- [ ] Cascade: Deactivate parent with children - all show inactive

### Feature Complete Validation
- [ ] Edit page: Tree shows on left, form on right
- [ ] Edit page: Click different unit navigates with unsaved warning
- [ ] Delete: Inactive unit deletes, parent selected
- [ ] Delete: Active unit shows "deactivate first" dialog

### Accessibility Validation
- [ ] Keyboard-only: Complete flow without mouse
- [ ] Screen reader: Tree announces correctly
- [ ] axe-core: Zero violations on both pages

## Current Status

**Phase**: 1 - Backend SQL Fixes
**Status**: ✅ IN PROGRESS
**Last Updated**: 2025-12-23
**Next Step**: Apply `to_jsonb()` wrapper at line 1996 in baseline migration
