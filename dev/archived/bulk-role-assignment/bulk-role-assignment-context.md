# Context: Bulk Role Assignment UI

## Decision Record

**Date**: 2026-01-21
**Feature**: Bulk Role Assignment UI
**Goal**: Enable administrators to assign multiple users to a role in a single operation, streamlining onboarding and role management.

### Relationship to Parent Architecture

This implementation depends on decisions made in:
- **Architecture Reference**: `dev/active/multi-role-authorization-context.md`
- **Architecture Plan**: `dev/active/multi-role-authorization-plan.md`

This was the **original feature request** that prompted the multi-role authorization investigation. The investigation revealed that the single-role JWT structure was a blocker, leading to the effective permissions architecture.

**Dependency Note (2026-01-22)**: This feature depends ONLY on Phase 2 (JWT Restructure + Effective Permissions).
It does NOT depend on Phase 3 (Direct Care Infrastructure - schedule/assignment tables for Temporal routing).

### Key Decisions

1. **Enhance Existing Routes**: Add bulk assignment to `/roles/manage` rather than creating new routes
2. **Single Role Per Operation**: Bulk assign users to ONE role at a time (simpler UX)
3. **Scope Selection Required**: User must specify scope when assigning (supports multi-scope architecture)
4. **Atomic Per-User**: Each user assignment is atomic; partial failures allowed
5. **Event-Sourced**: Each assignment emits a domain event for audit trail

### Why Bulk Assignment?

**Current Workflow** (tedious):
1. Navigate to user profile
2. Open role management
3. Select role to add
4. Select scope
5. Save
6. Repeat for each user (N times)

**New Workflow** (efficient):
1. Navigate to role detail
2. Click "Bulk Assign Users"
3. Select N users from list
4. Confirm scope
5. Submit (one operation)

## Technical Context

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       FRONTEND                                       │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ RoleManagePage                                                  ││
│  │   └── BulkAssignmentDialog                                      ││
│  │         ├── UserSelectionList (multi-select)                    ││
│  │         ├── ScopeSelector                                       ││
│  │         └── AssignmentResultDisplay                             ││
│  │                                                                  ││
│  │ BulkRoleAssignmentViewModel ← UserSelectionViewModel            ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                              │ Supabase RPC
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       DATABASE                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ api.bulk_assign_role(role_id, user_ids[], scope_path)         │  │
│  │   → Loops through user_ids                                     │  │
│  │   → Calls existing role assignment logic                       │  │
│  │   → Emits user.role.assigned event per user                   │  │
│  │   → Returns {success: uuid[], failed: {uuid, reason}[]}       │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ user_roles_projection (updated by event processor)            │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Tech Stack

- **Frontend**: React 19 + TypeScript + MobX
- **UI Components**: Tailwind CSS + existing A4C component library
- **State Management**: MobX ViewModels (MVVM pattern)
- **API**: Supabase RPC functions in `api` schema
- **Multi-select**: Custom or library (react-select, downshift)

### Dependencies

- Multi-role JWT infrastructure (effective permissions)
- `user_roles_projection` table
- `roles_projection` table
- Existing role assignment API (`api.modify_user_roles`)
- Existing `/roles` and `/roles/manage` routes

## File Structure

### New Files to Create

**Frontend Components:**
- `frontend/src/components/roles/BulkAssignmentDialog.tsx`
- `frontend/src/components/roles/UserSelectionList.tsx`
- `frontend/src/components/roles/AssignmentResultDisplay.tsx`
- `frontend/src/components/common/ScopeSelector.tsx` (reusable)

**ViewModels:**
- `frontend/src/viewModels/roles/BulkRoleAssignmentViewModel.ts`
- `frontend/src/viewModels/roles/UserSelectionViewModel.ts`

**Types:**
- `frontend/src/types/bulk-assignment.types.ts`

**Backend (SQL):**
- `infrastructure/supabase/sql/03-functions/api/0XX-bulk-role-assignment.sql`

### Existing Files to Modify

- `frontend/src/pages/roles/RoleManagePage.tsx` - Add bulk assign button
- `frontend/src/viewModels/roles/RoleManageViewModel.ts` - Integrate bulk assignment
- `frontend/src/services/roles/IRoleService.ts` - Add bulk assign method
- `frontend/src/services/roles/SupabaseRoleService.ts` - Implement bulk assign

## Related Components

### Existing Role Management

The current role management system includes:
- `RolesListPage` - Lists all roles
- `RoleManagePage` - Manage single role (view assignments, edit)
- `RoleManageViewModel` - State management for role detail
- `api.modify_user_roles(user_id, role_ids_to_add, role_ids_to_remove, scope_path)`

### User Management

The current user management includes:
- `UsersManagePage` - Lists all users
- `api.list_users()` - Returns users in organization

## Key Patterns and Conventions

### Bulk Operation Pattern

```typescript
interface BulkAssignmentResult {
  successful: string[];  // user_ids that succeeded
  failed: Array<{
    userId: string;
    reason: string;
  }>;
  totalRequested: number;
  totalSucceeded: number;
  totalFailed: number;
}

// ViewModel handles partial success
class BulkRoleAssignmentViewModel {
  @observable result: BulkAssignmentResult | null = null;
  @observable isProcessing = false;

  @action
  async assignRole(): Promise<void> {
    this.isProcessing = true;
    try {
      this.result = await this.roleService.bulkAssignRole(
        this.selectedRoleId,
        this.selectedUserIds,
        this.selectedScopePath
      );
    } finally {
      this.isProcessing = false;
    }
  }
}
```

### User Selection Pattern

```typescript
interface SelectableUser {
  id: string;
  displayName: string;
  email: string;
  currentRoles: string[];  // For display
  isSelected: boolean;
  isAlreadyAssigned: boolean;  // Can't re-assign same role
}

class UserSelectionViewModel {
  @observable users: SelectableUser[] = [];
  @observable searchTerm = '';
  @observable isLoading = false;

  @computed
  get selectedUsers(): SelectableUser[] {
    return this.users.filter(u => u.isSelected);
  }

  @computed
  get filteredUsers(): SelectableUser[] {
    return this.users.filter(u =>
      u.displayName.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(this.searchTerm.toLowerCase())
    );
  }

  @action
  toggleUser(userId: string): void {
    const user = this.users.find(u => u.id === userId);
    if (user && !user.isAlreadyAssigned) {
      user.isSelected = !user.isSelected;
    }
  }

  @action
  selectAll(): void {
    this.filteredUsers
      .filter(u => !u.isAlreadyAssigned)
      .forEach(u => u.isSelected = true);
  }
}
```

## Important Constraints

1. **Permission Gating**: Only users with `user.role_assign` permission can bulk assign
2. **Scope Validation**: Selected scope must be within assignor's scope_path
3. **Role Visibility**: Only roles visible at selected scope can be assigned
4. **Duplicate Prevention**: Can't assign role user already has at same scope
5. **Batch Limits**: Consider limiting to 100 users per operation for performance
6. **JWT Refresh**: Users must re-authenticate to see new roles in their JWT

## Reference Materials

- **Architecture Decisions**: `dev/active/multi-role-authorization-context.md`
- **Effective Permissions**: See "Effective Permissions Computation" section in architecture context
- **A4C MVVM Patterns**: `frontend/CLAUDE.md`
- **Existing Role Pages**: `frontend/src/pages/roles/` for UI patterns

## UI Mockup (Conceptual)

### Bulk Assignment Dialog

```
┌─────────────────────────────────────────────────────────────────────┐
│ Assign Users to Role: Clinician                              [X]    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ Scope: [acme.pediatrics ▼]                                          │
│                                                                      │
│ Select Users:                              [Search users...]         │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ [x] Select All (15 eligible)                                    │ │
│ ├─────────────────────────────────────────────────────────────────┤ │
│ │ [x] Alice Johnson (alice@example.com) - viewer                  │ │
│ │ [x] Bob Smith (bob@example.com) - viewer                        │ │
│ │ [ ] Carol Davis (carol@example.com) - viewer                    │ │
│ │ [—] Dan Wilson (dan@example.com) - clinician (already assigned) │ │
│ │ [x] Eve Brown (eve@example.com) - viewer                        │ │
│ │ ...                                                              │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ 3 users selected                                                     │
│                                                                      │
│                               [Cancel] [Assign 3 Users to Clinician] │
└─────────────────────────────────────────────────────────────────────┘
```

### Assignment Result

```
┌─────────────────────────────────────────────────────────────────────┐
│ Assignment Complete                                          [X]    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ ✅ Successfully assigned 2 of 3 users                               │
│                                                                      │
│ Successful:                                                          │
│   • Alice Johnson                                                    │
│   • Bob Smith                                                        │
│                                                                      │
│ ⚠️ Failed (1):                                                       │
│   • Eve Brown - User no longer active                               │
│                                                                      │
│ Note: Users must log out and back in to see new permissions.        │
│                                                                      │
│                                           [Close] [Retry Failed]    │
└─────────────────────────────────────────────────────────────────────┘
```

## Why This Approach?

### Alternatives Considered

1. **Bulk assign from User List**: Selected "Assign Role" on multiple selected users
   - Rejected: Would need to select role AND scope in a more complex UI

2. **CSV Import**: Upload CSV of user-role assignments
   - Deferred: Good for bulk onboarding, but overkill for day-to-day

3. **Role Templates**: Assign predefined sets of roles
   - Deferred: Natural extension after single-role bulk assign works

### Selected Approach Rationale

- **From Role View**: User is already in context of the role they want to assign
- **Single Role**: Simpler UX, clear intent
- **Scope Required**: Aligns with multi-scope architecture
- **Partial Success**: Real-world bulk operations often have some failures
