# Role Management Feature - Tasks

## Current Status

**Phase**: 13 - UX Improvements
**Status**: ✅ COMPLETE
**Last Updated**: 2024-12-28
**Completed**: 6 UX improvements - permission filtering, inactive role banner, display names, org_type filtering, role duplication, tree expansion fix
**Final Commit**: `65051ba6` - feat(rbac): Role management UX improvements

**Feature Status**: Role Management is fully complete and deployed. All 13 phases implemented.

---

## Phase 1: AsyncAPI Contracts ✅ COMPLETE

- [x] Add `role.updated` event schema
- [x] Add `role.deactivated` event schema
- [x] Add `role.reactivated` event schema
- [x] Add `role.deleted` event schema (already existed, verified)

## Phase 2: Database Migration ✅ COMPLETE

- [x] Create `api.get_roles` function
- [x] Create `api.get_role_by_id` function
- [x] Create `api.get_permissions` function
- [x] Create `api.get_user_permissions` function
- [x] Create `api.create_role` function with subset-only enforcement
- [x] Create `api.update_role` function with subset-only enforcement
- [x] Create `api.deactivate_role` function
- [x] Create `api.reactivate_role` function
- [x] Create `api.delete_role` function
- [x] Add event processor CASE branches for new events
- [x] Add RLS policies for roles_projection

## Phase 3: Types ✅ COMPLETE

- [x] Create `role.types.ts` with Role, RoleWithPermissions types
- [x] Add Permission, PermissionGroup types
- [x] Add request/response types (CreateRoleRequest, UpdateRoleRequest, etc.)
- [x] Add validation functions (validateRoleName, validateRoleDescription)
- [x] Add helper functions (groupPermissionsByApplet, canGrantPermission)

## Phase 4: Service Layer ✅ COMPLETE

- [x] Create `IRoleService` interface
- [x] Create `SupabaseRoleService` implementation
- [x] Create `MockRoleService` implementation with sample data
- [x] Create `RoleServiceFactory` with singleton pattern
- [x] Create `index.ts` exports

## Phase 5: ViewModels ✅ COMPLETE

- [x] Create `RolesViewModel` for list state management
- [x] Create `RoleFormViewModel` for form/permission state
- [x] Implement subset-only enforcement helpers (canGrant, isAppletFullySelected)
- [x] Implement dirty tracking and validation

## Phase 6: UI Components ✅ COMPLETE

- [x] Create `PermissionSelector` with grouped checkboxes
- [x] Implement "Select All" per applet with indeterminate state
- [x] Create `RoleList` with search and status filter
- [x] Create `RoleFormFields` for name, description, scope

## Phase 7: Page & Routing ✅ COMPLETE

- [x] Create `RolesManagePage` with split-view layout
- [x] Implement create mode
- [x] Implement edit mode with permission selection
- [x] Add deactivate/reactivate/delete operations
- [x] Add unsaved changes warning dialogs
- [x] Add route in App.tsx (`/roles/manage`)
- [x] Build and deploy successfully

## Phase 8: Testing ✅ COMPLETE

- [x] Unit tests for RoleFormViewModel (57 tests)
- [x] Unit tests for RolesViewModel (58 tests)
- [x] Unit tests for validation functions (33 tests)
- [x] E2E tests for role CRUD operations
- [x] E2E tests for permission selection
- [x] Accessibility audit (keyboard navigation, ARIA) - E2E tests include accessibility checks
- [ ] Manual testing with real Supabase data (deferred to integration testing)

### Additional Features Completed in Phase 8

- [x] Created `RolesPage.tsx` - Card-based role listing (`/roles`)
- [x] Created `RoleCard.tsx` - Glass-morphism card component with quick actions
- [x] Added `/roles` route with card grid layout
- [x] Added status filter buttons and search on card view

---

## Deployment Status

| Commit | Description | Date | Status |
|--------|-------------|------|--------|
| `164d325b` | feat(rbac): Implement role management UI and API | 2024-12-24 | ✅ Deployed |
| `df6de3c7` | feat(rbac): Add role card page, unit tests, and E2E tests | 2024-12-25 | ✅ Deployed |
| `474afe1c` | fix(rbac): Resolve statement timeout and global roles visibility | 2024-12-25 | ✅ Deployed |
| `b89b9bf6` | feat(rbac): Add OU scope tree dropdown for role management | 2024-12-25 | ✅ Deployed |
| `57196ae9` | refactor(ou): Align organization-units UI with roles pattern | 2024-12-26 | ✅ Deployed |
| `78a6a1c9` | fix(rbac): Hide canonical roles from Role Management UI | 2024-12-26 | ✅ Deployed |
| `65051ba6` | feat(rbac): Role management UX improvements | 2024-12-28 | ✅ Deployed |

All GitHub Actions workflows passed:
- Deploy Frontend: Build + Docker push + k8s rollout
- Validate Frontend Documentation: Passed

## Feature Complete Summary

The Role Management feature is **100% complete**:
- ✅ 13 phases implemented
- ✅ 148 unit tests passing
- ✅ 189 E2E tests passing (27 tests × 7 browser configs)
- ✅ TypeScript compilation passes
- ✅ Deployed to production
- ✅ Statement timeout issues resolved
- ✅ OU scope tree dropdown implemented
- ✅ Established as canonical UI pattern for admin pages

### Remaining Work (Deferred)
- [x] Manual testing with real Supabase data (integration testing) - Discovered bugs, all fixed
- [ ] User documentation / help text

---

## Phase 9: Bug Fixes ✅ COMPLETE

**Date**: 2024-12-24
**Status**: ✅ COMPLETE

### Bug 1: Missing Navigation Item
- [x] Add Roles nav item to `MainLayout.tsx` allNavItems array
- [x] Import Shield icon from lucide-react
- [x] Configure: `roles: ['super_admin', 'provider_admin'], permission: 'role.create', showForOrgTypes: ['provider']`

### Bug 2: api.get_roles Statement Timeout (First Attempt)
- [x] Create migration `20251224192708_fix_get_roles_performance.sql`
- [x] Add index: `CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions_projection(role_id)`
- [x] Rewrite `api.get_roles` to use LEFT JOINs with pre-aggregated counts instead of correlated subqueries
- [x] Deploy migration to Supabase
- Note: This fix was insufficient - RLS per-row overhead was the real problem

**Files Modified**:
- `frontend/src/components/layouts/MainLayout.tsx` (import + nav item)
- `infrastructure/supabase/supabase/migrations/20251224192708_fix_get_roles_performance.sql` (new)

---

## Phase 10: Performance & UX Enhancements ✅ COMPLETE

**Date**: 2024-12-25
**Status**: ✅ COMPLETE

### Bug 3: api.get_roles Statement Timeout (Root Cause Fix)
- [x] Analyze HAR file - identified TWO functions timing out: `api.get_roles` and `api.get_user_permissions`
- [x] Identify root cause: RLS policies calling `is_org_admin()`, `is_super_admin()` per row
- [x] Convert `api.get_user_permissions` to SECURITY DEFINER
- [x] Convert `api.get_roles` to SECURITY DEFINER
- [x] Move authorization logic inside functions (checked once, not per row)
- [x] Create migration `20251225120000_fix_role_api_security_definer.sql`
- [x] Deploy and verify

### Bug 4: Global Roles Visible to All Organizations
- [x] Identify bug: provider org users could see `super_admin` role
- [x] Add `org_type` check - global roles only visible to `platform_owner`
- [x] Create migration `20251225130000_fix_global_roles_visibility.sql`
- [x] Deploy and verify

### UX Enhancement: OU Scope Tree Dropdown
- [x] Create `TreeSelectDropdown.tsx` component
- [x] Embed OrganizationTree for hierarchy display
- [x] Add full keyboard navigation (Arrow keys, Enter, Escape)
- [x] Update `RoleFormFields.tsx` to use TreeSelectDropdown
- [x] Update `RolesManagePage.tsx` to load OU tree data on mount
- [x] WCAG 2.1 Level AA compliance verified

**Files Added**:
- `frontend/src/components/ui/TreeSelectDropdown.tsx`
- `infrastructure/supabase/supabase/migrations/20251225120000_fix_role_api_security_definer.sql`
- `infrastructure/supabase/supabase/migrations/20251225130000_fix_global_roles_visibility.sql`

**Files Modified**:
- `frontend/src/components/roles/RoleFormFields.tsx`
- `frontend/src/pages/roles/RolesManagePage.tsx`

**Commits**:
- `b89b9bf6` - feat(rbac): Add OU scope tree dropdown for role management
- `474afe1c` - fix(rbac): Resolve statement timeout and global roles visibility

---

## Phase 11: UI Pattern Standardization ✅ COMPLETE

**Date**: 2024-12-26
**Status**: ✅ COMPLETE

### Organization-Units UI Alignment
- [x] Remove standalone `/organization-units/create` route
- [x] Delete `OrganizationUnitCreatePage.tsx` (functionality moved to ManagePage)
- [x] Update `OrganizationUnitsListPage.tsx` - responsive header, status filter tabs, search bar
- [x] Update `OrganizationUnitsManagePage.tsx` - fixed height, spacing, empty state
- [x] Update `OrganizationUnitFormFields.tsx` - label/error styling with AlertCircle icon
- [x] Update parent dropdown styling to match roles pattern

**Files Modified**:
- `frontend/src/App.tsx` - Removed create route
- `frontend/src/pages/organization-units/index.ts` - Updated exports
- `frontend/src/pages/organization-units/OrganizationUnitsListPage.tsx` - Major refactor
- `frontend/src/pages/organization-units/OrganizationUnitsManagePage.tsx` - Spacing updates
- `frontend/src/components/organization-units/OrganizationUnitFormFields.tsx` - Styling updates

**Files Deleted**:
- `frontend/src/pages/organization-units/OrganizationUnitCreatePage.tsx`

**Commit**: `57196ae9` - refactor(ou): Align organization-units UI with roles pattern

---

## Phase 12: Canonical Roles Protection ✅ COMPLETE

**Date**: 2024-12-26
**Status**: ✅ COMPLETE

### Hide System Roles from Management UI
- [x] Add `isCanonicalRole(roleName)` helper in `roles.config.ts`
- [x] Filter canonical roles in `RolesViewModel.loadRoles()`
- [x] Add guard in `RolesManagePage.selectAndLoadRole()` with error message
- [x] Add defense-in-depth filter in `RolesPage.filteredRoles`
- [x] Rename mock role to avoid canonical name confusion
- [x] TypeScript compilation passes
- [x] Production build succeeds

**Files Modified**:
- `frontend/src/config/roles.config.ts`
- `frontend/src/viewModels/roles/RolesViewModel.ts`
- `frontend/src/pages/roles/RolesManagePage.tsx`
- `frontend/src/pages/roles/RolesPage.tsx`
- `frontend/src/services/roles/MockRoleService.ts`

**Commit**: `78a6a1c9` - fix(rbac): Hide canonical roles from Role Management UI

---

## Phase 13: UX Improvements ✅ COMPLETE

**Date**: 2024-12-28
**Status**: ✅ COMPLETE

### Issue 1: Permission Selector Cognitive Load
- [x] Add "Show only grantable" toggle (default: ON) - hides permissions user can't grant
- [x] Add search input to filter permissions by name/description/displayName
- [x] Add permission group collapse/expand functionality
- [x] Add expand all / collapse all buttons

### Issue 2: Inactive Role UX Clarity
- [x] Add info banner at top of form when role is inactive
- [x] Message: "This role is inactive. Reactivate it to make changes."
- [x] Add "Reactivate" button in the banner for quick action

### Issue 3: Role Duplication Feature
- [x] Add "Duplicate" button in RolesManagePage edit mode header
- [x] Implement `initializeFromRole()` in RoleFormViewModel
- [x] Clone creates new role with same permissions, name suffixed with "(Copy)"
- [x] Opens in create mode with pre-filled data
- [x] On save, include `clonedFromRoleId` in create request for audit trail
- [x] Update `api.create_role` to accept `p_cloned_from_role_id` parameter
- [x] Include `cloned_from_role_id` in event metadata

### Issue 4: Organization vs OU Permission Visibility
- [x] Modify `api.get_permissions()` to filter by org_type from JWT
- [x] Non-platform_owner orgs only see `scope_type IN ('org', 'facility', 'program', 'client')`
- [x] Global permissions (`scope_type = 'global'`) hidden for provider/provider_partner
- [x] Add `display_name` column to permissions_projection

### Issue 5: Human-Readable Permission Names
- [x] Add `display_name` column to permissions_projection
- [x] Update `api.get_permissions()` to return `display_name`
- [x] Update frontend Permission type to include `displayName`
- [x] Update PermissionSelector to use `displayName` for labels

### Issue 6: OU Hierarchy Tree Expansion Bug
- [x] Add `expandedIds: Set<string>` prop to OrganizationTreeNodeProps
- [x] Pass `expandedIds` from OrganizationTree to OrganizationTreeNode
- [x] Fix recursive children render to use `expandedIds.has(childNode.id)`
- [x] Pass `expandedIds` down to child OrganizationTreeNode recursively

**Files Added**:
- `infrastructure/supabase/supabase/migrations/20251228120000_permission_display_names.sql`
- `infrastructure/supabase/supabase/migrations/20251228130000_filter_permissions_by_org_type.sql`
- `infrastructure/supabase/supabase/migrations/20251228140000_role_duplication_support.sql`

**Files Modified**:
- `frontend/src/components/roles/PermissionSelector.tsx` - Filter toolbar, collapse/expand
- `frontend/src/viewModels/roles/RoleFormViewModel.ts` - Filter state, initializeFromRole
- `frontend/src/pages/roles/RolesManagePage.tsx` - Duplicate button, inactive banner, filter props
- `frontend/src/types/role.types.ts` - Added displayName, clonedFromRoleId
- `frontend/src/services/roles/SupabaseRoleService.ts` - Pass clonedFromRoleId
- `frontend/src/components/organization-units/OrganizationTree.tsx` - Pass expandedIds
- `frontend/src/components/organization-units/OrganizationTreeNode.tsx` - Accept expandedIds prop

**Commit**: `65051ba6` - feat(rbac): Role management UX improvements
