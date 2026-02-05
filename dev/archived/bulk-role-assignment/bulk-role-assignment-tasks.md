# Tasks: Bulk Role Assignment UI

## Prerequisites (from multi-role-authorization Phase 2) ✅ COMPLETE

> These prerequisites were completed as part of multi-role authorization work.

- [x] Multi-role JWT structure (`effective_permissions`) deployed
- [x] `permission_implications` table populated
- [x] `compute_effective_permissions()` function deployed
- [x] `has_effective_permission()` RLS helper deployed
- [x] Updated `custom_access_token_hook` with effective permissions (v4)

## Phase 1: Existing Code Analysis ✅ COMPLETE

- [x] Review `/roles` route implementation
- [x] Review `/roles/manage` route implementation
- [x] Review `RolesManageViewModel` structure
- [x] Review `api.modify_user_roles()` function
- [x] Document extension points for bulk operations
- [x] Identify reusable components

## Phase 2: Backend API ✅ COMPLETE

- [x] Create `api.bulk_assign_role(p_role_id, p_user_ids[], p_scope_path)` function
  - [x] Validate caller has `user.role_assign` permission
  - [x] Validate scope_path is within caller's scope
  - [x] Loop through user_ids
  - [x] Skip users already assigned to role at scope
  - [x] Emit `user.role.assigned` event per successful assignment
  - [x] Return `{successful: uuid[], failed: {user_id, reason}[]}`
- [x] Create `api.list_users_for_bulk_assignment(p_role_id, p_scope_path)` function
  - [x] Return users NOT already assigned to role at scope
  - [x] Include pagination (limit/offset)
  - [x] Include search by name/email
  - [x] Return user details (id, display_name, email, current_roles)
- [x] Add batch size limit (max 100 users per call)

**Migration files created:**
- `20260203190007_bulk_role_assignment.sql` - Initial implementation
- `20260203204826_fix_bulk_assign_deleted_at.sql` - Fix: user_roles_projection uses hard deletes
- `20260203205138_fix_bulk_assign_users_table.sql` - Fix: Use `users` table (not `users_projection`)

## Phase 3: Types and Service Layer ✅ COMPLETE

- [x] Create `frontend/src/types/bulk-assignment.types.ts`
  - [x] `BulkAssignmentResult` interface
  - [x] `SelectableUser` interface
- [x] Add to `frontend/src/services/roles/IRoleService.ts`
  - [x] `bulkAssignRole(roleId, userIds, scopePath): Promise<BulkAssignmentResult>`
  - [x] `listUsersForBulkAssignment(roleId, scopePath, search?, pagination?): Promise<SelectableUser[]>`
- [x] Implement in `SupabaseRoleService.ts`
- [x] Implement in `MockRoleService.ts`

## Phase 4: ViewModels ✅ COMPLETE

- [x] Create `BulkRoleAssignmentViewModel.ts`
  - [x] `@observable users: SelectableUser[]`
  - [x] `@observable searchTerm: string`
  - [x] `@observable selectedUserIds: Set<string>`
  - [x] `@observable isLoading: boolean`
  - [x] `@observable isAssigning: boolean`
  - [x] `@observable result: BulkAssignmentResult | null`
  - [x] `@computed get selectedCount()`
  - [x] `@computed get filteredUsers()`
  - [x] `@action loadUsers(roleId, scopePath)`
  - [x] `@action toggleUser(userId)`
  - [x] `@action selectAll()`
  - [x] `@action deselectAll()`
  - [x] `@action assignRole()`
  - [x] `@action reset()`

## Phase 5: UI Components ✅ COMPLETE

### User Selection List
- [x] Create `UserSelectionList.tsx`
  - [x] Search input
  - [x] "Select All" / "Deselect All" buttons
  - [x] Checkbox list of users
  - [x] Show current roles for each user
  - [x] Disable checkbox for already-assigned users
  - [x] Loading state
  - [x] Empty state

### Bulk Assignment Dialog
- [x] Create `BulkAssignmentDialog.tsx`
  - [x] Modal container (Radix Dialog)
  - [x] Role name display (read-only, passed in)
  - [x] Scope path display (read-only, uses role's scope)
  - [x] User selection list
  - [x] Selected count display
  - [x] Cancel / Submit buttons
  - [x] Loading state during submission
  - [x] Result display (success/failure breakdown)
  - [x] Correlation ID for support reference

## Phase 6: Route Integration ✅ COMPLETE

- [x] Modify `RolesManagePage.tsx`
  - [x] Add "Bulk Assign Users" button
  - [x] Wire up dialog open/close
  - [x] Pass role ID and scope to dialog
  - [x] Refresh assignments after dialog closes
- [x] Fix role loading from URL param (roleId query param)

**Bug fixes during integration:**
- `5ac9eace` - Fix role not loading when navigating from /roles with roleId param

## Phase 7: Testing ✅ COMPLETE (UAT)

### User Acceptance Testing
- [x] Open bulk assignment dialog from role detail
- [x] Users load correctly with search filtering
- [x] Select multiple users works
- [x] Submit assignment completes successfully
- [x] Result display shows success/failure breakdown
- [x] Assignments visible in role's user list

### Bug Fixes During UAT
- [x] Fix `deleted_at` column error (user_roles_projection uses hard deletes)
- [x] Fix `users_projection` table not found (should be `users` table)
- [x] Fix column name mismatches (`name` not `display_name`, `current_organization_id` not `organization_id`)

## Phase 8: Documentation ⏸️ DEFERRED

- [ ] Add bulk assignment to admin user guide
- [ ] Document batch size limits
- [ ] Document JWT refresh requirement
- [ ] Add troubleshooting section

> Documentation deferred until feature stabilizes in production use.

## Success Validation Checkpoints ✅ ALL PASSED

### API Complete
- [x] Bulk assign function handles multiple users
- [x] Partial failures return proper error details
- [x] Permission checks prevent unauthorized assignment
- [x] Events emitted for each assignment (user.role.assigned)

### UI Complete
- [x] Dialog opens from role manage page
- [x] Users load with search and filtering
- [x] Selection state works correctly
- [x] Result display shows success/failure breakdown

### Integration Complete
- [x] Assigned users appear in role list
- [x] Domain events recorded in domain_events
- [x] Works in mock mode for development

## Current Status

**Phase**: COMPLETE
**Status**: ✅ UAT PASSED
**Last Updated**: 2026-02-03
**Next Step**: Archive to `dev/archived/bulk-role-assignment/`

## Notes

- **`users` vs `users_projection`**: The `users` table is synced from `auth.users`, NOT a CQRS projection. This differs from other `*_projection` tables.
- **Hard deletes**: `user_roles_projection` uses hard deletes (no `deleted_at` column), unlike `roles_projection` which uses soft deletes.
- **Correlation ID**: Bulk operations share a correlation_id across all emitted events for traceability.
