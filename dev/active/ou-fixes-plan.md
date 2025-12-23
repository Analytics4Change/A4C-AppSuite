# Implementation Plan: Organization Unit Fixes

## Executive Summary

This feature addresses four critical issues with the Organization Units management system: a SQL bug preventing edits, missing cascade behavior for deactivation, missing UI functionality for tree view and deletion, and accessibility compliance verification.

The scope includes backend SQL fixes in the baseline migration, frontend UI enhancements to both the Manage and Edit pages, and WCAG 2.1 Level AA compliance verification.

## Phase 1: Backend SQL Fixes

### 1.1 Fix "malformed array literal" Error
- Apply `to_jsonb()` wrapper at line 1996 (`update_organization_unit` function)
- Apply `to_jsonb()` wrapper at line 2934 (`bootstrap.cancelled` trigger)
- Expected: Edit operations succeed without array conversion errors

### 1.2 Implement Cascade Deactivation
- Modify `deactivate_organization_unit` RPC to collect descendant metadata
- Modify event processor to batch update using ltree path containment
- Expected: Deactivating parent cascades to all descendants

## Phase 2: Frontend Manage Page Updates

### 2.1 Add Delete Functionality
- Add "Delete Unit" button (enabled only when unit is inactive)
- Add delete confirmation dialog
- Implement parent selection after deletion
- Expected: Users can delete inactive OUs from Manage page

### 2.2 Update Deactivation Warnings
- Update dialog message to mention cascade behavior
- Differentiate messaging for units with/without children
- Expected: Clear user understanding of cascade deactivation

## Phase 3: Frontend Edit Page Refactor

### 3.1 Split Layout with Tree View
- Convert to grid layout (2/3 tree, 1/3 form)
- Integrate OrganizationTree component (same as Manage page)
- Pre-select and expand to current unit
- Enable interactive navigation with unsaved changes dialog
- Expected: Full tree context visible while editing

### 3.2 Add Danger Zone Section
- Add section at bottom of form with delete button
- Implement two-step delete flow (deactivate first)
- Navigate to Manage page with parent selected after delete
- Expected: Safe deletion workflow from Edit page

## Phase 4: Accessibility Verification

### 4.1 ARIA Compliance
- Verify new dialogs have proper ARIA attributes
- Add `role="alertdialog"` for destructive actions
- Ensure focus trap and return-focus behavior
- Expected: Screen reader compatible dialogs

### 4.2 Keyboard Navigation
- Verify tab order through new UI elements
- Confirm arrow keys work in tree on Edit page
- Test Escape key closes dialogs
- Expected: Full keyboard accessibility

## Success Metrics

### Immediate
- [ ] Edit operation succeeds without array error
- [ ] Cascade deactivation updates all descendants
- [ ] Delete button visible on Manage page for inactive units

### Medium-Term
- [ ] Edit page shows tree with interactive navigation
- [ ] Delete workflow completes with parent selection
- [ ] All dialogs pass axe-core audit

### Long-Term
- [ ] Zero accessibility violations in production
- [ ] User feedback confirms improved UX for OU management

## Implementation Schedule

| Phase | Description | Effort |
|-------|-------------|--------|
| 1 | Backend SQL Fixes | Small |
| 2 | Manage Page Updates | Medium |
| 3 | Edit Page Refactor | Medium |
| 4 | Accessibility Verification | Small |

## Risk Mitigation

1. **SQL Migration Risk**: Baseline migration is idempotent by design; test in dev first
2. **Tree State Complexity**: Reuse existing ViewModel to avoid state duplication
3. **Focus Management**: Follow existing ConfirmDialog patterns for consistency

## Next Steps After Completion

1. Manual verification of all 4 issue verification checklists
2. Run axe DevTools audit on both pages
3. Deploy to production via `supabase db push --linked`
4. Archive dev-docs to `dev/archived/`
