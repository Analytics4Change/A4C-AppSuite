# Implementation Plan: Organization Unit Fixes

## Executive Summary

This feature addresses four critical issues with the Organization Units management system: a SQL bug preventing edits, missing cascade behavior for deactivation, missing UI functionality for tree view and deletion, and accessibility compliance verification.

**Status**: ✅ COMPLETE - All phases implemented and deployed (2025-12-23)

The scope includes backend SQL fixes in the baseline migration, frontend UI enhancements to both the Manage and Edit pages, and WCAG 2.1 Level AA compliance verification.

## Phase 1: Backend SQL Fixes ✅ COMPLETE

### 1.1 Fix "malformed array literal" Error
- Applied `to_jsonb()` wrapper at line ~2014 (`update_organization_unit` function)
- Applied `to_jsonb()` wrapper at line ~2952 (`bootstrap.cancelled` trigger)
- Result: Edit operations succeed without array conversion errors

### 1.2 Implement Cascade Deactivation
- Modified `deactivate_organization_unit` RPC to collect descendant metadata
- Modified event processor to batch update using ltree path containment
- Result: Deactivating parent cascades to all descendants

## Phase 2: Frontend Manage Page Updates ✅ COMPLETE

### 2.1 Add Delete Functionality
- Added "Delete Unit" button (enabled only when unit is inactive)
- Added delete confirmation dialog
- Implemented parent selection after deletion
- Result: Users can delete inactive OUs from Manage page

### 2.2 Update Deactivation Warnings
- Updated dialog message to mention cascade behavior
- Differentiated messaging for units with/without children
- Changed dialog variant from "danger" to "warning" (orange)
- Result: Clear user understanding of cascade deactivation

## Phase 3: Frontend Edit Page Refactor ✅ COMPLETE

### 3.1 Split Layout with Tree View
- Converted to grid layout (col-span-2 tree, col-span-1 form)
- Integrated OrganizationTree component (same as Manage page)
- Pre-select and expand to current unit
- Enabled interactive navigation with unsaved changes dialog
- Result: Full tree context visible while editing

### 3.2 Add Danger Zone Section
- Added section at bottom of form with delete button
- Implemented two-step delete flow (deactivate first)
- Navigate to Manage page with parent selected after delete
- Result: Safe deletion workflow from Edit page

## Phase 4: ViewModel Updates ✅ COMPLETE

### 4.1 Delete Method
- Added `deleteUnit(unitId: string)` method to OrganizationUnitsViewModel
- Track parent ID before delete operation
- On success: Reload tree and select parent
- Result: Both pages use ViewModel method for delete

## Phase 5: Accessibility Verification ✅ COMPLETE

### 5.1 ARIA Compliance
- Verified new dialogs have proper ARIA attributes
- Added `role="alertdialog"` for destructive actions
- Added `aria-describedby` for dialog descriptions
- Added `role="alert"` to field-level error messages
- Result: Screen reader compatible dialogs

### 5.2 Keyboard Navigation
- Verified tab order through new UI elements
- Confirmed arrow keys work in tree on Edit page
- Tested Escape key closes dialogs
- Result: Full keyboard accessibility

## Success Metrics

### Immediate ✅
- [x] Edit operation succeeds without array error
- [x] Cascade deactivation updates all descendants
- [x] Delete button visible on Manage page for inactive units

### Medium-Term ✅
- [x] Edit page shows tree with interactive navigation
- [x] Delete workflow completes with parent selection
- [x] All dialogs pass manual accessibility review

### Long-Term
- [ ] axe-core audit: Zero violations on both pages (optional)
- [ ] User feedback confirms improved UX for OU management

## Implementation Schedule

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Backend SQL Fixes | ✅ COMPLETE |
| 2 | Manage Page Updates | ✅ COMPLETE |
| 3 | Edit Page Refactor | ✅ COMPLETE |
| 4 | ViewModel Updates | ✅ COMPLETE |
| 5 | Accessibility Verification | ✅ COMPLETE |

## Risk Mitigation

1. **SQL Migration Risk**: ✅ Mitigated - Baseline migration is idempotent; created separate migration file for production
2. **Tree State Complexity**: ✅ Mitigated - Reused existing ViewModel to avoid state duplication
3. **Focus Management**: ✅ Mitigated - Followed existing ConfirmDialog patterns for consistency

## Deployment Summary

- **Commit**: `4ae185e2`
- **Migration**: `20251223182421_ou_cascade_deactivation_fix.sql`
- **GitHub Actions**: Frontend deploy ✅, Database migrations ✅

## Next Steps After Completion

1. ✅ Manual verification of all 4 issue verification checklists
2. Optional: Run axe DevTools audit on both pages
3. ✅ Deployed to production via `supabase db push --linked`
4. Archive dev-docs to `dev/archived/ou-fixes/`
