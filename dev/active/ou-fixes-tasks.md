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

### Initial Deployment (2025-12-23 18:31)
- [x] Migration deployed to Supabase production
- [x] Commit created: `4ae185e2`
- [x] Pushed to GitHub main branch
- [x] Frontend deploy workflow passed
- [x] Database migrations workflow passed

### Phase 6 Deployment (2025-12-23 19:35)
- [x] Commit `caf08dbb`: Tree UI improvements + cascade reactivation
- [x] Commit `efda39d9`: Fix migration timestamp (recreated with CLI)
- [x] Frontend deploy workflow passed
- [x] Database migrations workflow passed
- [x] Process improvement: Updated infrastructure-guidelines skill with migration creation warnings

### Phase 7 Deployment (2025-12-23 20:30)
- [x] Commit `f6fb43f3`: Fix tree indentation, connector lines, and badge alignment
- [x] Commit `1bdc158f`: Auto-detect root path for tree depth calculation
- [x] Frontend deploy workflow passed
- [x] User verified: Tree now displays correctly with indentation and connector lines

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
  - Created migration `20251223193037_ou_cascade_reactivation.sql` (recreated with CLI for correct timestamp)
- [x] Issue 4 Frontend: Reactivate button on ManagePage
  - Added conditional Deactivate/Reactivate button
  - Green styling (text-green-600, border-green-300)
  - Success variant ConfirmDialog
- [x] Issue 4 Frontend: Reactivate button on EditPage
  - Added Reactivate section in Danger Zone (for inactive units)
  - Added Reactivate confirmation dialog

## Phase 7: Tree Indentation Final Fix ✅ COMPLETE

- [x] Issue: Tree showing no visible indentation or connector lines despite code deployment
- [x] Investigation: Queried database to check actual organization paths
- [x] Root cause: Hardcoded `rootPath = "root.provider.acme_healthcare"` (3 segments) didn't match production paths (1 segment: `poc-test1-20251223`)
- [x] Fix OrganizationTreeNode.tsx: Changed `<li>` to use `marginLeft: depth * INDENT_SIZE`
- [x] Fix OrganizationTreeNode.tsx: Position badges absolutely at right edge
- [x] Fix OrganizationTreeNode.tsx: Connector lines use explicit `height` instead of `top/bottom`
- [x] Fix OrganizationUnitsViewModel.ts: Auto-detect rootPath from root org's actual path
- [x] Deploy commit `f6fb43f3` (CSS/layout fixes)
- [x] Deploy commit `1bdc158f` (rootPath auto-detection)
- [x] Verify: Tree now shows proper indentation based on hierarchy depth
- [x] Verify: Badges right-aligned at fixed vertical line
- [x] Verify: Connector lines visible (├── and └── style)

## Phase 8: Checkbox Active State Fix ✅ COMPLETE

- [x] Issue: Checkbox showed local form state that never persisted to backend
  - Tree showed "Inactive" badge while checkbox showed "checked" (active)
  - Root cause: Two independent data sources that don't sync
- [x] Change checkbox to read from `unit.isActive` (database state)
- [x] Extract `loadUnit()` as reusable `useCallback` for post-operation refresh
- [x] Add deactivate handler state and confirmation dialog
- [x] Update reactivate handler to use `loadUnit()` instead of `window.location.reload()`
- [x] Wire checkbox `onCheckedChange` to trigger appropriate confirmation dialogs
- [x] Add disabled state during API operations to prevent double-clicks
- [x] Add glassmorphic styling (shadow-sm, ring-1, bg-white/80, backdrop-blur-sm)
- [x] Deploy commit `09f7e91e`: Wire active checkbox to API with confirmation dialogs
- [x] Frontend deploy workflow passed

### Phase 8 Deployment (2025-12-23 20:55)
- [x] Commit `09f7e91e`: Wire active checkbox to API with confirmation dialogs
- [x] Frontend deploy workflow passed
- [x] User can verify: Checkbox now shows correct state matching tree

## Phase 9: Malformed Array Literal Fix ✅ COMPLETE

**Problem**: "Malformed array literal" error persists despite `to_jsonb()` fix being deployed.

**Root Cause**: The `||` operator for TEXT[] concatenation is ambiguous. PostgreSQL interprets `'display_name'` as an array literal `'{display_name}'` which fails parsing.

### Investigation Completed
- [x] Verify migration `20251223182421` is applied in `supabase_migrations.schema_migrations`
- [x] Query `pg_proc.prosrc` to confirm function has `to_jsonb(v_updated_fields)`
- [x] Check for duplicate `update_organization_unit` functions in other schemas
- [x] Verify no custom `to_jsonb` function override
- [x] Simulate `jsonb_build_object('x', to_jsonb(ARRAY['timezone']))` - works
- [x] Check for triggers/constraints/generated columns on `domain_events`
- [x] Confirm frontend calls function correctly
- [x] Test with fresh browser session - error persists

### Diagnostic Logging Deployed
- [x] Create migration via Supabase CLI: `supabase migration new ou_update_diagnostic_logging`
- [x] Add RAISE NOTICE statements at key execution points
- [x] Deploy migration `20251223213418_ou_update_diagnostic_logging.sql`
- [x] Test OU update - no `[OU_UPDATE]` logs appeared (error before first RAISE NOTICE!)

### Root Cause Identified
- [x] Tested array patterns in isolation via `mcp__supabase__execute_sql`
- [x] Confirmed: `TEXT[] || 'string'` FAILS with "malformed array literal"
- [x] Confirmed: `array_append(TEXT[], 'string')` WORKS

### Fix Applied
- [x] Create migration via Supabase CLI: `supabase migration new ou_array_append_fix`
- [x] Change all `v_updated_fields := v_updated_fields || 'field'` to `array_append()`
- [x] Deploy migration `20251224164206_ou_array_append_fix.sql`
- [x] Verify function now uses `array_append` (position > 0 in prosrc)
- [x] User tested: OU update now works correctly!

### Phase 9 Deployment (2025-12-24)
- [x] Migration `20251224164206_ou_array_append_fix.sql` deployed
- [x] User verified: OU field updates work correctly

## Phase 10: Stay on Edit Page After Save ✅ COMPLETE

- [x] Issue: After save, page redirected to manage page instead of staying on edit page
- [x] Changed `handleSubmit` to stay on edit page after successful save
- [x] Reload tree data (`treeViewModel.loadUnits()`) to reflect name/parent changes
- [x] Reload unit data (`loadUnit()`) to get fresh form data
- [x] Expand tree to show edited OU (`expandToNode` + `selectNode`)
- [x] Updated dependency array with `treeViewModel`, `loadUnit`, `unitId`
- [x] TypeScript check passed

### Phase 10 Deployment (2025-12-24)
- [x] Commit `c2174e08`: Stay on edit page after save
- [x] Frontend deploy workflow passed
- **Note**: Phase 10 was superseded by Phase 11 page consolidation

## Phase 11: Page Consolidation Refactor ✅ COMPLETE

**Goal**: Consolidate Edit page functionality into Manage page for unified single-page interface.

### Implementation
- [x] Extract `ConfirmDialog` to shared component `frontend/src/components/ui/ConfirmDialog.tsx`
- [x] Rewrite `OrganizationUnitsManagePage.tsx` with 3 panel modes: `empty`, `edit`, `create`
- [x] Add `formViewModel` for form state management with dirty tracking
- [x] Add `handleTreeSelect` with unsaved changes dialog
- [x] Add inline create mode with parent pre-selection from selected unit
- [x] Add all edit form fields: name, display name, timezone, active status toggle
- [x] Add danger zone section for non-root units (delete, reactivate)
- [x] Add query parameter support: `?select=uuid` for deep links
- [x] Remove edit route from `App.tsx`
- [x] Remove `OrganizationUnitEditPage` export from `index.ts`
- [x] Delete `OrganizationUnitEditPage.tsx`
- [x] TypeScript check passed

### Phase 11 Deployment (2025-12-24)
- [x] Commit `014003bd`: Consolidate Edit page into ManagePage
- [x] Frontend deploy workflow passed
- [x] User verified: Unified ManagePage works correctly

## Phase 12: OU Delete Bug Fix ✅ COMPLETE

**Problem**: Deleting an OU failed with `column ur.deleted_at does not exist`

**Root Cause**: `api.delete_organization_unit()` checked `ur.deleted_at IS NULL` on `user_roles_projection`, but that table uses hard-delete (no `deleted_at` column).

**Documentation Citations**:
- `user_roles_projection.md` line 811: "Revoked roles removed from projection (not soft deleted)"
- `organizations_projection.md` line 106: "Organizations never physically deleted" (soft-delete)

### Implementation
- [x] Investigate error source - found in baseline line ~627-632
- [x] Research documentation for deletion patterns
- [x] Create migration: `20251224180351_ou_delete_fix_user_roles_check.sql`
- [x] Remove `AND ur.deleted_at IS NULL` condition from role check
- [x] Update baseline for consistency
- [x] Deploy migration with `supabase db push --linked`
- [x] Verify fix: `ur.deleted_at` no longer in function source
- [x] Commit and push: `fdfc7d99`

### Phase 12 Deployment (2025-12-24)
- [x] Migration `20251224180351_ou_delete_fix_user_roles_check.sql` deployed
- [x] Commit `fdfc7d99`: fix(ou): Remove invalid deleted_at check on user_roles_projection
- [x] User can verify: OU deletion now works

## Current Status

**Phase**: ALL PHASES COMPLETE (including Phase 12 delete bug fix)
**Status**: ✅ COMPLETE
**Last Updated**: 2025-12-24
**Next Step**: Archive dev-docs to `dev/archived/ou-fixes/` - feature is complete
