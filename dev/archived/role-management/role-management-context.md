# Role Management Feature - Context

## Overview

Role management UI for CRUD operations on roles and their permissions. Follows the Organization Units pattern with split-view layout and MVVM architecture.

**Created**: 2024-12-24
**Last Updated**: 2024-12-29
**Status**: ✅ COMPLETE - All 14 phases implemented, tested, deployed. Full UX improvements including permission filtering, role duplication, display names, org_type filtering, tree expansion fix, and visual hierarchy bug fix.

## Key Decisions

1. **Split-view Layout**: List panel (1/3) + form panel (2/3) - permission selector needs more space than tree view
2. **Permission UI**: Grouped checkboxes by applet with "Select All" per group
3. **Subset-only Delegation**: Users can only grant permissions they possess - enforced in both API and UI
4. **SECURITY DEFINER Pattern**: API functions `api.get_roles` and `api.get_user_permissions` use SECURITY DEFINER to bypass RLS per-row overhead, with authorization logic inside the function (checked once, not per row) - Updated 2024-12-25
5. **Scope Field**: Optional ltree path for organizational unit scope - TreeSelectDropdown with OU hierarchy tree - Updated 2024-12-25
6. **Card-based Listing Page**: Added `/roles` route with card grid layout matching `/clients` pattern - Added 2024-12-25
7. **Comprehensive Testing**: 148 unit tests (ViewModels + types) + 189 E2E tests (27 tests × 7 browser configs) - Added 2024-12-25
8. **Global Roles Visibility**: Global roles (organization_id IS NULL) only visible to platform_owner org type, not all authenticated users - Added 2024-12-25
9. **Canonical Roles Hidden**: System roles (`super_admin`, `provider_admin`) completely hidden from Role Management UI using `isCanonicalRole()` helper - Added 2024-12-26
10. **Permission Display Names**: Added `display_name` column to permissions for human-readable labels instead of technical names - Added 2024-12-28
11. **Org Type Permission Filtering**: `api.get_permissions()` filters by JWT `org_type` claim - global permissions hidden for non-platform_owner - Added 2024-12-28
12. **Permission Selector Filtering**: "Show only grantable" toggle (default ON), search input, collapse/expand per applet - Added 2024-12-28
13. **Role Duplication**: "Duplicate" button clones role with "(Copy)" suffix, `clonedFromRoleId` in event metadata for audit trail - Added 2024-12-28
14. **Tree Expansion Fix**: OrganizationTreeNode accepts `expandedIds` Set prop for proper recursive expansion - Added 2024-12-28
15. **Section Dividers Not Collapsible**: Permission scope sections (Global/Organization) use horizontal dividers with centered labels, NOT h4 headers, to avoid visual confusion with collapsible AppletGroups - Added 2024-12-29

## Architecture

### Frontend Structure

```
frontend/src/
├── types/role.types.ts                    # Role, Permission, PermissionGroup types + validation
├── services/roles/
│   ├── IRoleService.ts                    # Service interface
│   ├── SupabaseRoleService.ts             # Production implementation (RPC calls)
│   ├── MockRoleService.ts                 # Development mock (localStorage)
│   ├── RoleServiceFactory.ts              # Factory with singleton pattern
│   └── index.ts                           # Exports
├── viewModels/roles/
│   ├── RolesViewModel.ts                  # List state, filtering, CRUD operations
│   └── RoleFormViewModel.ts               # Form state, permission selection, validation
├── components/roles/
│   ├── PermissionSelector.tsx             # Grouped checkbox selector
│   ├── RoleList.tsx                       # Filterable role cards
│   ├── RoleFormFields.tsx                 # Name, description, scope fields
│   ├── RoleCard.tsx                       # Glass-morphism card with quick actions - Added 2024-12-25
│   └── index.ts                           # Exports
├── components/ui/
│   └── TreeSelectDropdown.tsx             # Dropdown with embedded OrganizationTree - Added 2024-12-25
├── pages/roles/
│   ├── RolesManagePage.tsx                # Main split-view page
│   ├── RolesPage.tsx                      # Card-based listing page (/roles) - Added 2024-12-25
│   └── index.ts                           # Exports
├── types/
│   └── role.types.test.ts                 # 33 validation tests - Added 2024-12-25
├── viewModels/roles/__tests__/
│   ├── RolesViewModel.test.ts             # 58 list/CRUD tests - Added 2024-12-25
│   └── RoleFormViewModel.test.ts          # 57 form/permission tests - Added 2024-12-25
└── e2e/
    └── role-management.spec.ts            # 27 E2E tests - Added 2024-12-25
```

### Infrastructure

```
infrastructure/supabase/
├── contracts/asyncapi/domains/rbac.yaml   # Added 4 new events
└── supabase/migrations/
    ├── 20251224220822_role_management_api.sql     # API functions + event processor
    ├── 20251224192708_fix_get_roles_performance.sql  # Bug fix: N+1 query + missing index
    ├── 20251225120000_fix_role_api_security_definer.sql  # SECURITY DEFINER fix for timeout
    ├── 20251225130000_fix_global_roles_visibility.sql    # org_type check for global roles
    ├── 20251228120000_permission_display_names.sql       # display_name column - Added 2024-12-28
    ├── 20251228130000_filter_permissions_by_org_type.sql # org_type filtering - Added 2024-12-28
    └── 20251228140000_role_duplication_support.sql       # cloned_from_role_id - Added 2024-12-28
```

### API Functions (api schema)

| Function | Purpose |
|----------|---------|
| `api.get_roles(p_status, p_search_term)` | List roles with filters |
| `api.get_role_by_id(p_role_id)` | Get role with permissions |
| `api.get_permissions()` | List all available permissions |
| `api.get_user_permissions()` | Get current user's permission IDs |
| `api.create_role(...)` | Create role + grant permissions |
| `api.update_role(...)` | Update role + sync permissions |
| `api.deactivate_role(p_role_id)` | Freeze role |
| `api.reactivate_role(p_role_id)` | Unfreeze role |
| `api.delete_role(p_role_id)` | Soft delete (requires inactive + no users) |

### AsyncAPI Events Added

- `role.updated` - Role name/description changed
- `role.deactivated` - Role frozen
- `role.reactivated` - Role unfrozen
- `role.deleted` - Role soft-deleted (deleted_at set)

## Important Constraints

1. **RLS Scoping**: All queries automatically scoped to user's org_id JWT claim
2. **Subset-only in API**: `api.create_role` and `api.update_role` validate that user has all permissions being granted
3. **Delete Requirements**: Role must be inactive AND have zero user assignments
4. **Mock Service**: Uses localStorage with 4 sample roles and 20+ permissions for development

## Reference Files

- `frontend/src/pages/organization-units/OrganizationUnitsManagePage.tsx` - UI pattern reference
- `frontend/src/viewModels/organization/OrganizationUnitsViewModel.ts` - ViewModel pattern
- `frontend/src/services/organization/SupabaseOrganizationUnitService.ts` - Service pattern
- `infrastructure/supabase/supabase/migrations/20240101000000_baseline.sql` - Existing RBAC schema

## Routes

| Path | Component | Permission | Description |
|------|-----------|------------|-------------|
| `/roles` | `RolesPage` | `role.create` | Card-based listing with quick actions |
| `/roles/manage` | `RolesManagePage` | `role.create` | Split-view management page |

## Test Coverage

| Test File | Count | Coverage |
|-----------|-------|----------|
| `role.types.test.ts` | 33 | Validation functions (name, description, canGrant, groupPermissions) |
| `RolesViewModel.test.ts` | 58 | List state, filtering, CRUD operations, computed properties |
| `RoleFormViewModel.test.ts` | 57 | Form state, validation, permission selection, dirty tracking |
| `role-management.spec.ts` | 27 × 7 = 189 | E2E across Chromium, Firefox, WebKit, Edge, tablets |

## Deployment History

| Commit | Description | Date |
|--------|-------------|------|
| `164d325b` | Initial UI and API implementation (Phases 1-7) | 2024-12-24 |
| `df6de3c7` | Card page, unit tests, E2E tests (Phase 8) | 2024-12-25 |
| `ca67664b` | Bug fixes: Nav item + api.get_roles performance | 2024-12-25 |
| `b89b9bf6` | OU scope tree dropdown for role management | 2024-12-25 |
| `474afe1c` | SECURITY DEFINER + global roles visibility fix | 2024-12-25 |
| `57196ae9` | Align organization-units UI with roles pattern | 2024-12-26 |
| `78a6a1c9` | Hide canonical roles from Role Management UI | 2024-12-26 |
| `65051ba6` | UX improvements (Phase 13) - filtering, duplication, display names | 2024-12-28 |
| `4bab347e` | Visual hierarchy bug fix (Phase 14) - section dividers | 2024-12-29 |

## Bug Fixes (2024-12-24 - 2024-12-25)

### Issue 1: Roles not in navigation
**Problem**: The `/roles` route was accessible but no navigation item existed in the sidebar.
**Fix**: Added Roles nav item to `MainLayout.tsx` with Shield icon, `role.create` permission, and `showForOrgTypes: ['provider']`.
**Commit**: `ca67664b`

### Issue 2: api.get_roles statement timeout (First Attempt)
**Problem**: Correlated subqueries for `permission_count` and `user_count` caused N+1 query pattern.
**Root cause**:
- Missing index on `role_permissions_projection.role_id`
- Correlated subqueries executed per row instead of using JOINs
**Fix**:
- Created `idx_role_permissions_role_id` index
- Rewrote `api.get_roles` to use LEFT JOIN with pre-aggregated counts
- Migration: `20251224192708_fix_get_roles_performance.sql`
**Result**: Still timed out - RLS per-row overhead was the real problem.

### Issue 3: api.get_roles statement timeout (Root Cause Fix)
**Problem**: Even with index + JOINs, statement timeout persisted. HAR analysis showed TWO functions timing out: `api.get_roles` (13.3s) and `api.get_user_permissions` (15.3s).
**Root cause**: RLS policies call expensive functions (`is_org_admin()`, `is_super_admin()`) for EVERY ROW:
- Each function executes 2-3 JOINs per call
- N rows = N function calls = 2N-3N extra JOINs
- Combined with 8s statement_timeout = TIMEOUT
**Fix**: Convert to SECURITY DEFINER to bypass RLS, implement authorization logic inside function (checked once, not per row):
```sql
-- Before: SECURITY INVOKER → RLS evaluated per row
-- After: SECURITY DEFINER → Authorization inside function (O(1))
v_user_id := public.get_current_user_id();
v_org_id := public.get_current_org_id();
v_is_super_admin := public.is_super_admin(v_user_id);
-- Filter in WHERE clause, not via RLS
```
**Migration**: `20251225120000_fix_role_api_security_definer.sql`
**Commit**: `474afe1c`

### Issue 4: Global roles visible to all organizations
**Problem**: After SECURITY DEFINER fix, provider org users could see global roles like `super_admin`.
**Root cause**: Authorization logic allowed `organization_id IS NULL` for all authenticated users.
**Fix**: Add `org_type` check - global roles only visible to `platform_owner` org type:
```sql
v_org_type := (auth.jwt()->>'org_type')::text;
AND (
  (r.organization_id IS NULL AND v_org_type = 'platform_owner')
  OR r.organization_id = v_org_id
  OR v_is_super_admin
)
```
**Migration**: `20251225130000_fix_global_roles_visibility.sql`
**Commit**: `474afe1c`

## UX Enhancements (2024-12-25)

### OU Scope Tree Dropdown
**Feature**: Replace text input for "Organizational Unit Scope" with dropdown showing OU hierarchy tree.
**Implementation**:
- Created `TreeSelectDropdown.tsx` - reusable dropdown with embedded OrganizationTree
- Updated `RoleFormFields.tsx` to use TreeSelectDropdown instead of text input
- Updated `RolesManagePage.tsx` to load OU tree data on mount
**UX Behavior**:
- Collapsed: Shows selected OU display name or placeholder
- Expanded: Full OrganizationTree with expand/collapse, keyboard navigation
- Clear button to remove selection (organization-wide access)
**Accessibility**: WCAG 2.1 Level AA compliant - full keyboard navigation, proper ARIA attributes
**Commit**: `b89b9bf6`

## UI Pattern Standardization (2024-12-26)

### Roles as Canonical UI Pattern
**Context**: The roles UI patterns have been established as the canonical reference for all admin management pages.

**Organization-units routes aligned to roles pattern** (`57196ae9`):
- Removed standalone `/organization-units/create` route (inline create in ManagePage)
- Added status filter tabs with counts (All/Active/Inactive)
- Added search bar with icon
- Updated form field styling (labels: `text-sm font-medium`, errors: icon + text)
- Updated spacing (forms: `space-y-6`, actions: `gap-3 pt-4`)
- Updated empty state (icon: `w-16 h-16`, padding: `p-12`)
- Fixed height for list panels (`h-[calc(100vh-280px)]`)

**Pattern Reference Files** (use for future admin pages):
- `frontend/src/pages/roles/RolesPage.tsx` - Card-based list page
- `frontend/src/pages/roles/RolesManagePage.tsx` - Split-view manage page
- `frontend/src/components/roles/RoleFormFields.tsx` - Form field styling with FieldWrapper
- `frontend/src/components/roles/RoleList.tsx` - Filterable list with search

## Canonical Roles Protection (2024-12-26)

### Hide System Roles from Management UI
**Problem**: Navigating to `/roles/manage?roleId=<canonical-role-id>` showed "Failed to load role details". Canonical roles (`super_admin`, `provider_admin`) should never be visible or manageable through the UI.

**Solution**: Frontend-only filtering using existing `roles.config.ts` `isSystemRole` flag.

**Implementation**:
- Added `isCanonicalRole(roleName)` helper in `roles.config.ts`
- Filter canonical roles in `RolesViewModel.loadRoles()` - primary filtering point
- Added guard in `RolesManagePage.selectAndLoadRole()` with clear error message
- Defense-in-depth filter in `RolesPage.filteredRoles`
- Renamed mock role from "Provider Administrator" to "Organization Admin" to avoid confusion

**Files Modified**:
- `frontend/src/config/roles.config.ts` - Added `isCanonicalRole()` helper
- `frontend/src/viewModels/roles/RolesViewModel.ts` - Filter in `loadRoles()`
- `frontend/src/pages/roles/RolesManagePage.tsx` - Guard in `selectAndLoadRole()`
- `frontend/src/pages/roles/RolesPage.tsx` - Filter in `filteredRoles`
- `frontend/src/services/roles/MockRoleService.ts` - Renamed mock role

## Phase 13 UX Improvements (2024-12-28)

### Permission Selector Simplification
**Problem**: 50+ permissions displayed at once creates cognitive overload.

**Solution**: Added filtering and search to PermissionSelector:
- "Show only grantable" toggle (default: ON) - hides permissions user can't grant
- Search input to filter permissions by name/description/displayName
- Permission group collapse/expand functionality with expand all/collapse all buttons

**Implementation**:
- Added `showOnlyGrantable`, `permissionSearchTerm`, `collapsedApplets` state to `RoleFormViewModel`
- Added computed `filteredPermissions` and `filteredPermissionGroups`
- Updated `PermissionSelector` with filter toolbar and collapsible `AppletGroup`

### Inactive Role UX Clarity
**Problem**: When a role is inactive, the form becomes read-only without clear explanation.

**Solution**: Added info banner at top of form:
- Message: "This role is inactive. Reactivate it to make changes."
- "Reactivate" button in banner for quick action
- Blue/amber styling to draw attention

### Role Duplication Feature
**Problem**: No way to create new roles based on existing ones.

**Solution**: Added "Duplicate" action:
- "Duplicate" button in RolesManagePage edit mode header (Copy icon)
- `initializeFromRole()` method in RoleFormViewModel
- Clones role with same permissions, name suffixed with "(Copy)"
- `clonedFromRoleId` included in create request for audit trail
- Database migration adds `p_cloned_from_role_id` parameter to `api.create_role`

### Permission Display Names
**Problem**: Permissions show technical names like "organization.create" instead of "Create Organization".

**Solution**: Database schema update:
- Added `display_name` column to `permissions_projection`
- Updated `api.get_permissions()` to return `display_name`
- Frontend uses `displayName` for labels, `description` for tooltips

### Org Type Permission Filtering
**Problem**: Non-platform_owner users see global scope permissions they shouldn't manage.

**Solution**: API-level filtering by org_type:
- `api.get_permissions()` checks `org_type` from JWT
- Non-platform_owner orgs only see `scope_type IN ('org', 'facility', 'program', 'client')`
- Global permissions hidden for provider/provider_partner org types

### Tree Expansion Bug Fix
**Problem**: Cannot expand tree nodes past level 2 in TreeSelectDropdown.

**Root Cause**: `OrganizationTreeNode` used `childNode.isExpanded ?? false` instead of `expandedIds` Set.

**Solution**:
- Added `expandedIds: Set<string>` prop to `OrganizationTreeNodeProps`
- Pass `expandedIds` from `OrganizationTree` to `OrganizationTreeNode`
- Recursive children use `expandedIds.has(childNode.id)` for expansion state

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

## Phase 14 Visual Hierarchy Bug Fix (2024-12-29)

### Permission Grouping False Hierarchy
**Problem**: Permission selector showed false nested hierarchy where "Organization Unit Management" appeared as a collapsible parent container wrapping Client, Medication, Organization, Role, and User applet groups. Screenshot analysis revealed:
```
▶ Organization Management (Global)    0/1 selected
▶ Role Management                     0/1 selected
▼ Organization Unit Management                     ← Bug: Looked like parent!
  ├── Client Records                  0/3 selected
  ├── Medication Management           0/2 selected
  ...
```

**Root Cause**: h4-based section headers in `PermissionSelector.tsx` (lines 548-581) visually merged with AppletGroup components, creating the illusion of nested hierarchy when all groups should be FLAT.

**Solution**: Replaced h4 headers with horizontal divider pattern:
```tsx
<div className="flex items-center gap-3 py-1" role="separator" aria-label="Global scope permissions">
  <div className="h-px flex-1 bg-purple-200"></div>
  <span className="text-xs font-semibold uppercase tracking-wider text-purple-600 whitespace-nowrap">
    Global Scope
  </span>
  <div className="h-px flex-1 bg-purple-200"></div>
</div>
```

**Changes**:
- Renamed sections: "Organization Management (Global)" → "Global Scope", "Organization Unit Management" → "Organization Scope"
- Removed confusing subtitle text
- Added ARIA attributes for accessibility (`role="separator"`, `aria-label`)
- Purple styling for global scope, blue styling for organization scope

**Files Modified**:
- `frontend/src/components/roles/PermissionSelector.tsx`

**Commit**: `4bab347e` - fix(rbac): Fix permission grouping visual hierarchy bug
