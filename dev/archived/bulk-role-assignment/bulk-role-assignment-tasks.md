# Tasks: Bulk Role Assignment UI

## Prerequisites (from multi-role-authorization Phase 2 ONLY) ⏸️ BLOCKED

> These tasks must be completed first. See `multi-role-authorization-tasks.md` Phase 2.
>
> **Note (2026-01-22)**: This feature only depends on Phase 2 (JWT Restructure).
> It does NOT depend on Phase 3 (Direct Care Infrastructure) or Policy-as-Data (which was removed).

- [ ] Multi-role JWT structure (`effective_permissions`) deployed
- [ ] `permission_implications` table populated
- [ ] `compute_effective_permissions()` function deployed
- [ ] `has_effective_permission()` RLS helper deployed
- [ ] Updated `custom_access_token_hook` with effective permissions

## Phase 1: Existing Code Analysis ⏸️ PENDING

- [ ] Review `/roles` route implementation
- [ ] Review `/roles/manage` route implementation
- [ ] Review `RoleManageViewModel` structure
- [ ] Review `api.modify_user_roles()` function
- [ ] Document extension points for bulk operations
- [ ] Identify reusable components

## Phase 2: Backend API ⏸️ PENDING

- [ ] Create `api.bulk_assign_role(p_role_id, p_user_ids[], p_scope_path)` function
  - [ ] Validate caller has `user.role_assign` permission
  - [ ] Validate scope_path is within caller's scope
  - [ ] Loop through user_ids
  - [ ] Skip users already assigned to role at scope
  - [ ] Emit `user.role.assigned` event per successful assignment
  - [ ] Return `{successful: uuid[], failed: {user_id, reason}[]}`
- [ ] Create `api.list_users_for_bulk_assignment(p_org_id, p_role_id, p_scope_path)` function
  - [ ] Return users NOT already assigned to role at scope
  - [ ] Include pagination (limit/offset)
  - [ ] Include search by name/email
  - [ ] Return user details (id, display_name, email, current_roles)
- [ ] Add batch size limit (max 100 users per call)
- [ ] Write API function tests

## Phase 3: Types and Service Layer ⏸️ PENDING

- [ ] Create `frontend/src/types/bulk-assignment.types.ts`
  - [ ] `BulkAssignmentRequest` interface
  - [ ] `BulkAssignmentResult` interface
  - [ ] `SelectableUser` interface
- [ ] Add to `frontend/src/services/roles/IRoleService.ts`
  - [ ] `bulkAssignRole(roleId, userIds, scopePath): Promise<BulkAssignmentResult>`
  - [ ] `listUsersForBulkAssignment(orgId, roleId, scopePath, search?, pagination?): Promise<SelectableUser[]>`
- [ ] Implement in `SupabaseRoleService.ts`
- [ ] Implement in `MockRoleService.ts`

## Phase 4: ViewModels ⏸️ PENDING

- [ ] Create `UserSelectionViewModel.ts`
  - [ ] `@observable users: SelectableUser[]`
  - [ ] `@observable searchTerm: string`
  - [ ] `@observable isLoading: boolean`
  - [ ] `@computed get selectedUsers()`
  - [ ] `@computed get filteredUsers()`
  - [ ] `@action loadUsers(roleId, scopePath)`
  - [ ] `@action toggleUser(userId)`
  - [ ] `@action selectAll()`
  - [ ] `@action deselectAll()`
- [ ] Create `BulkRoleAssignmentViewModel.ts`
  - [ ] `@observable selectedRoleId: string`
  - [ ] `@observable selectedScopePath: string`
  - [ ] `@observable isProcessing: boolean`
  - [ ] `@observable result: BulkAssignmentResult | null`
  - [ ] `userSelectionVM: UserSelectionViewModel`
  - [ ] `@action assignRole()`
  - [ ] `@action retryFailed()`
  - [ ] `@action reset()`

## Phase 5: UI Components ⏸️ PENDING

### User Selection List
- [ ] Create `UserSelectionList.tsx`
  - [ ] Search input
  - [ ] "Select All" / "Deselect All" buttons
  - [ ] Checkbox list of users
  - [ ] Show current roles for each user
  - [ ] Disable checkbox for already-assigned users
  - [ ] Loading state
  - [ ] Empty state

### Scope Selector (Reusable)
- [ ] Create `ScopeSelector.tsx` (if not already exists)
  - [ ] Dropdown of available scopes
  - [ ] Filter by user's allowed scopes
  - [ ] Show scope hierarchy

### Bulk Assignment Dialog
- [ ] Create `BulkAssignmentDialog.tsx`
  - [ ] Modal container
  - [ ] Role name display (read-only, passed in)
  - [ ] Scope selector
  - [ ] User selection list
  - [ ] Selected count display
  - [ ] Cancel / Submit buttons
  - [ ] Loading state during submission

### Assignment Result Display
- [ ] Create `AssignmentResultDisplay.tsx`
  - [ ] Success count
  - [ ] Success list (collapsible)
  - [ ] Failed count and list with reasons
  - [ ] "Retry Failed" button
  - [ ] "Close" button
  - [ ] Note about JWT refresh

## Phase 6: Route Integration ⏸️ PENDING

- [ ] Modify `RoleManagePage.tsx`
  - [ ] Add "Bulk Assign Users" button
  - [ ] Wire up dialog open/close
  - [ ] Pass role ID to dialog
  - [ ] Refresh assignments after dialog closes
- [ ] Modify `RoleManageViewModel.ts`
  - [ ] Add `bulkAssignmentVM` property
  - [ ] Add `openBulkAssignment()` action
  - [ ] Add `closeBulkAssignment()` action

## Phase 7: Testing ⏸️ PENDING

### Unit Tests
- [ ] UserSelectionViewModel tests
  - [ ] User filtering
  - [ ] Selection toggle
  - [ ] Select all / deselect all
- [ ] BulkRoleAssignmentViewModel tests
  - [ ] Assignment submission
  - [ ] Result handling
  - [ ] Retry logic

### Integration Tests
- [ ] `api.bulk_assign_role` function tests
  - [ ] Successful bulk assign
  - [ ] Partial failure handling
  - [ ] Permission denied
  - [ ] Scope validation
- [ ] `api.list_users_for_bulk_assignment` tests
  - [ ] Pagination
  - [ ] Search filtering
  - [ ] Excludes already-assigned

### E2E Tests
- [ ] Open bulk assignment dialog
- [ ] Select multiple users
- [ ] Submit assignment
- [ ] Verify result display
- [ ] Verify assignments in database
- [ ] Verify JWT after re-auth

## Phase 8: Documentation ⏸️ PENDING

- [ ] Add bulk assignment to admin user guide
- [ ] Document batch size limits
- [ ] Document JWT refresh requirement
- [ ] Add troubleshooting section

## Success Validation Checkpoints

### API Complete
- [ ] Bulk assign function handles 50+ users
- [ ] Partial failures return proper error details
- [ ] Permission checks prevent unauthorized assignment
- [ ] Events emitted for each assignment

### UI Complete
- [ ] Dialog opens from role manage page
- [ ] Users load with search and filtering
- [ ] Selection state works correctly
- [ ] Result display shows success/failure breakdown
- [ ] Retry failed works

### Integration Complete
- [ ] Assigned users appear in role list
- [ ] Domain events recorded in domain_events
- [ ] Users see new permissions after re-auth
- [ ] Works in mock mode for development

## Current Status

**Phase**: Prerequisites
**Status**: ⏸️ BLOCKED - Waiting for multi-role JWT infrastructure
**Last Updated**: 2026-01-21
**Next Step**: Complete JWT restructure in multi-role-authorization Phase 2

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `effective_permissions` JWT structure | multi-role-authorization Phase 2 | Pending |
| `permission_implications` table | multi-role-authorization Phase 2 | Pending |
| `compute_effective_permissions()` | multi-role-authorization Phase 2 | Pending |
| `has_effective_permission()` | multi-role-authorization Phase 2 | Pending |

> **Note (2026-01-22)**: Phase 3 (Direct Care Infrastructure) is NOT a dependency.
> Assignment tables (`user_schedule_policies_projection`, `user_client_assignments_projection`)
> are for Temporal workflow routing, not bulk role assignment.

## Notes

- This was the **original feature request** that started the multi-role authorization investigation
- The JWT restructure is required so that newly assigned roles appear in the user's token
- Users must re-authenticate (or have their session refreshed) to see new permissions
- Consider adding a "force session refresh" mechanism in the future
- Batch size limit of 100 users per operation is a performance safeguard
