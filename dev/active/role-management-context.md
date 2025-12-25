# Role Management Feature - Context

## Overview

Role management UI for CRUD operations on roles and their permissions. Follows the Organization Units pattern with split-view layout and MVVM architecture.

**Created**: 2024-12-24
**Last Updated**: 2024-12-24
**Status**: ✅ COMPLETE - All phases implemented, tested, deployed, and bug fixes applied

## Key Decisions

1. **Split-view Layout**: List panel (1/3) + form panel (2/3) - permission selector needs more space than tree view
2. **Permission UI**: Grouped checkboxes by applet with "Select All" per group
3. **Subset-only Delegation**: Users can only grant permissions they possess - enforced in both API and UI
4. **SECURITY INVOKER Pattern**: API functions use RLS for authorization, emit events via SECURITY DEFINER function
5. **Scope Field**: Optional ltree path for organizational unit scope - text input for now, could be dropdown later
6. **Card-based Listing Page**: Added `/roles` route with card grid layout matching `/clients` pattern - Added 2024-12-25
7. **Comprehensive Testing**: 148 unit tests (ViewModels + types) + 189 E2E tests (27 tests × 7 browser configs) - Added 2024-12-25

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
    └── 20251224192708_fix_get_roles_performance.sql  # Bug fix: N+1 query + missing index
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
| TBD | Bug fixes: Nav item + api.get_roles performance | 2024-12-24 |

## Bug Fixes (2024-12-24)

### Issue 1: Roles not in navigation
**Problem**: The `/roles` route was accessible but no navigation item existed in the sidebar.
**Fix**: Added Roles nav item to `MainLayout.tsx` with Shield icon, `role.create` permission, and `showForOrgTypes: ['provider']`.

### Issue 2: api.get_roles statement timeout
**Problem**: Correlated subqueries for `permission_count` and `user_count` caused N+1 query pattern. Combined with RLS policy overhead, this triggered statement timeouts.
**Root cause**:
- Missing index on `role_permissions_projection.role_id`
- Correlated subqueries executed per row instead of using JOINs
**Fix**:
- Created `idx_role_permissions_role_id` index
- Rewrote `api.get_roles` to use LEFT JOIN with pre-aggregated counts
- Migration: `20251224192708_fix_get_roles_performance.sql`
