---
status: current
last_updated: 2026-04-22
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Frontend reference for role management — split-view CRUD, data-driven permission selector (no hardcoded UI list), subset-only delegation, and bulk/unified user assignment.

**When to read**:
- Modifying role list, form, or manage pages
- Adding a new permission and wanting to know the frontend impact
- Understanding how the permission checkbox list is populated
- Debugging subset-only delegation or the `/roles` route

**Key topics**: `roles`, `role-management`, `role-form`, `permission-selector`, `role-assignment`, `adding-permission`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# Role Management Frontend Reference

## Architecture

The role management feature follows the MVVM + CQRS pattern. Roles bundle permissions and are assigned to users; the permission checkbox list rendered in the role form is **loaded dynamically from the database** via `api.get_permissions()` — there is no hardcoded permission list in the UI.

| Concern | Component | Notes |
|---------|-----------|-------|
| List ViewModel | `RolesViewModel` | Loads roles + permissions, delete/reactivate actions |
| Form ViewModel | `RoleFormViewModel` | Selected-permission state, `canGrant()`, dirty tracking |
| Unified Assignment ViewModel | `RoleAssignmentViewModel` | Add/remove users with delta tracking |
| Bulk Assignment ViewModel | `BulkRoleAssignmentViewModel` | Scoped bulk assign to many users |
| List Component | `RoleList` | Filterable list with search + status tabs |
| Card Component | `RoleCard` | Card in list view |
| Form Fields | `RoleFormFields` | Name, description, permission selector |
| Permission Selector | `PermissionSelector` | Grouped checkboxes with subset-only enforcement |
| Assignment Dialogs | `RoleAssignmentDialog`, `BulkAssignmentDialog` | Modal user pickers |
| List Page | `RolesPage` | `/roles` overview |
| Manage Page | `RolesManagePage` | `/roles/manage` split-view CRUD |

## File Structure

```
frontend/src/
  types/role.types.ts                   # Role, Permission, PermissionGroup, RoleWithPermissions
  services/roles/
    IRoleService.ts                     # Service interface
    SupabaseRoleService.ts              # Real implementation (api.* RPCs)
    MockRoleService.ts                  # Mock for npm run dev:mock
    RoleServiceFactory.ts               # DI factory
  viewModels/roles/
    RolesViewModel.ts                   # List + permissions state, CRUD actions
    RoleFormViewModel.ts                # Form state, grouping, canGrant(), dirty tracking
    RoleAssignmentViewModel.ts          # Unified add/remove with delta tracking
    BulkRoleAssignmentViewModel.ts      # Bulk assign to many users
  components/roles/
    RoleCard.tsx
    RoleList.tsx
    RoleFormFields.tsx
    PermissionSelector.tsx              # Grouped checkboxes, data-driven
    RoleAssignmentDialog.tsx
    BulkAssignmentDialog.tsx
    UserSelectionList.tsx
    index.ts                            # Barrel exports
  pages/roles/
    RolesPage.tsx                       # /roles
    RolesManagePage.tsx                 # /roles/manage
    index.ts
```

## Routes

| Path | Page | Permission |
|------|------|-----------|
| `/roles` | `RolesPage` | `role.view` |
| `/roles/manage` | `RolesManagePage` | `role.create`, `role.update` |
| `/roles/manage?roleId=<uuid>` | Pre-selects role for editing | `role.update` |

## Key Concepts

### Data-Driven Permission List

The `PermissionSelector` iterates over a `permissionGroups` prop — it contains no hardcoded permission list. New permissions defined in `permissions_projection` appear automatically as selectable checkboxes.

**Flow**:

```
permissions_projection  (DB)
  → api.get_permissions()  RPC
  → SupabaseRoleService.getPermissions()
  → RolesViewModel.loadPermissions()  → allPermissions[]
  → RoleFormViewModel  groups by applet prefix
  → PermissionSelector  renders grouped checkboxes
```

For the full end-to-end "add a new permission" checklist (seed, role templates, mock mode, applet prefixes), see [Adding a New Permission](../../architecture/authorization/permissions-reference.md#adding-a-new-permission-end-to-end).

### Subset-Only Delegation

A user cannot grant a permission they do not themselves possess. `RoleFormViewModel.canGrant(permissionId)` compares `userPermissionIds` (from the user's JWT `effective_permissions`) against each permission; `PermissionSelector` disables non-grantable rows and shows a "You don't have this permission" hint.

### Applet Display Labels

Group headers use `permission.displayName` (DB column) when set, otherwise fall back to the hardcoded map `APPLET_DISPLAY_NAMES` at `components/roles/PermissionSelector.tsx:88-97`. Unknown applet prefixes still render, using an auto-generated label like `"Foo Management"`. Adding a new applet prefix is the only cosmetic reason to edit this file.

### Scope Bands (Global vs Organization)

For `platform_owner` users, `PermissionSelector` splits groups into two labeled sections via horizontal dividers: **Global Scope** and **Organization Scope**. The split is driven entirely by each permission's `scopeType` column (`global` or `org`). Non-platform users see a flat list with no divider.

### Mock Mode Hardcoding

`MockRoleService.MOCK_PERMISSIONS` at `services/roles/MockRoleService.ts:83-116` is a static array used when running `npm run dev:mock` or tests against the mock service. New permissions must be mirrored here for mock-mode development; production does not use this list.

### Unified User Assignment

`RoleAssignmentViewModel` tracks `initialAssignedUserIds` and `selectedUserIds`, then computes `toAdd`/`toRemove` deltas on save and calls `api.sync_role_assignments()` with a shared `correlation_id` (see [rbac-architecture.md](../../architecture/authorization/rbac-architecture.md#unified-role-assignment-management)).

## Service Layer (CQRS)

All data access goes through `api.*` schema RPCs — no direct table queries.

| Method | RPC Function | Purpose |
|--------|-------------|---------|
| `getRoles` | `api.get_roles` | List roles with filters |
| `getRoleById` | `api.get_role_by_id` | Role detail + permissions + assigned users |
| `getPermissions` | `api.get_permissions` | **Permission catalog (powers /roles UI)** |
| `getUserPermissions` | `api.get_user_permissions` | Current user's grantable permissions |
| `createRole` | `api.create_role` | Create role + initial permission grants |
| `updateRole` | `api.update_role` | Update name, description, permission set |
| `deactivateRole` | `api.deactivate_role` | Soft-deactivate |
| `reactivateRole` | `api.reactivate_role` | Reactivate |
| `deleteRole` | `api.delete_role` | Hard-delete (must be inactive + 0 users) |
| `listUsersForRoleManagement` | `api.list_users_for_role_management` | Unified add/remove dialog data |
| `syncRoleAssignments` | `api.sync_role_assignments` | Apply add/remove deltas atomically |
| `listUsersForBulkAssignment` | `api.list_users_for_bulk_assignment` | Bulk dialog data |
| `bulkAssignRole` | `api.bulk_assign_role` | Bulk assign role to many users |

## Related Documentation

- [Adding a New Permission](../../architecture/authorization/permissions-reference.md#adding-a-new-permission-end-to-end) — end-to-end workflow
- [permissions-reference.md](../../architecture/authorization/permissions-reference.md) — canonical permission catalog
- [rbac-architecture.md](../../architecture/authorization/rbac-architecture.md) — RBAC model, event schemas, unified assignment
- [permissions_projection](../../infrastructure/reference/database/tables/permissions_projection.md) — permission DB table
- [schedule-management.md](./schedule-management.md) — parallel frontend reference pattern
- [frontend/CLAUDE.md](../../../frontend/CLAUDE.md) — frontend development rules (CQRS, MobX, accessibility)
