# Implementation Plan: Bulk Role Assignment UI

## Executive Summary

This feature implements the administrative user interface for assigning multiple users to roles in bulk. This was the **original feature request** that prompted the multi-role authorization architecture investigation. Administrators will be able to select multiple users and assign them to a role (or multiple roles) at a specific scope, streamlining the onboarding and role management process.

This is a **dependent implementation** that requires the core infrastructure from the Multi-Role Authorization architecture (see `multi-role-authorization-context.md` for architectural decisions, particularly the effective permissions computation and JWT restructure).

## Prerequisites

Before implementing this UI, the following infrastructure must be in place:

- [ ] Multi-role JWT structure (`effective_permissions`) deployed
- [ ] `permission_implications` table populated
- [ ] `compute_effective_permissions()` function deployed
- [ ] `has_effective_permission()` RLS helper deployed
- [ ] Updated `custom_access_token_hook` with effective permissions

## Phase 1: Existing Route Analysis

### 1.1 Current /roles Implementation
- Review existing `/roles` and `/roles/manage` routes
- Document current role management capabilities
- Identify extension points for bulk assignment
- Assess current ViewModel structure

### 1.2 Existing API Assessment
- Review `api.modify_user_roles()` function
- Confirm support for `roleIdsToAdd` array
- Identify any limitations for bulk operations
- Plan batch size limits if needed

## Phase 2: Bulk Assignment API

### 2.1 Batch Role Assignment Function
- Create `api.bulk_assign_role(role_id, user_ids[], scope_path)` function
- Emit individual domain events per assignment (audit trail)
- Return success/failure per user
- Handle partial failures gracefully

### 2.2 User Selection API
- Create `api.list_users_for_role_assignment(org_id, scope_path)` function
- Return users eligible for assignment (not already assigned)
- Include pagination for large user bases
- Support search/filter by name, email

## Phase 3: UI Components

### 3.1 User Selection Component
- Multi-select user picker with search
- Checkbox list with "Select All" option
- Show user name, email, current roles
- Filter already-assigned users

### 3.2 Role Assignment Dialog
- Modal or slide-out panel
- Role selector (single role for bulk assign)
- Scope selector (dropdown of available scopes)
- Preview of changes before submission
- Progress indicator for bulk operation

### 3.3 Assignment Result Display
- Success/failure summary
- List of failed assignments with reasons
- "Retry Failed" option
- Confirmation of completion

## Phase 4: MVVM Implementation

### 4.1 BulkRoleAssignmentViewModel
- Selected users collection
- Target role state
- Target scope state
- Assignment progress state
- `selectUser()` / `deselectUser()` actions
- `assignRole()` action with batch processing
- Error handling and retry logic

### 4.2 UserSelectionViewModel
- Available users collection (paginated)
- Search/filter state
- Loading states
- `loadUsers()` action
- `searchUsers()` action

## Phase 5: Route Integration

### 5.1 Enhance /roles/manage Route
- Add "Bulk Assign Users" button to role detail view
- Open bulk assignment dialog
- Refresh role assignments after completion

### 5.2 Alternative Entry Points
- Consider bulk assignment from /users route
- "Assign Role to Selected" action on user list

## Phase 6: Testing & Validation

### 6.1 Unit Tests
- ViewModel logic tests
- Batch processing tests
- Error handling tests

### 6.2 Integration Tests
- API function tests with various user counts
- Partial failure scenarios
- Permission verification after assignment

### 6.3 E2E Tests
- Select multiple users flow
- Assign role flow
- Verify JWT updates after re-auth

## Success Metrics

### Immediate
- [ ] Administrator can select multiple users
- [ ] Administrator can assign selected users to a role
- [ ] Assignments appear in user_roles_projection

### Medium-Term
- [ ] Bulk operations handle 50+ users efficiently
- [ ] Partial failures don't block successful assignments
- [ ] JWT correctly reflects new roles after re-auth

### Long-Term
- [ ] Feature used regularly for onboarding
- [ ] Reduced time for role management tasks
- [ ] No orphaned or incorrect role assignments

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Performance with large user lists | Pagination, batch processing limits |
| Partial failure confusion | Clear success/failure display per user |
| JWT not updating | Force re-auth or session refresh after changes |
| Scope selection errors | Validate scope against user's permission |

## Next Steps After Completion

1. Bulk role **removal** feature (inverse of this)
2. Role assignment templates (predefined role sets)
3. Role assignment approval workflow
4. Import role assignments from CSV
