# Context: Bulk Role Assignment UI

## Decision Record

**Date**: 2026-01-21
**Completed**: 2026-02-03
**Feature**: Bulk Role Assignment UI
**Goal**: Enable administrators to assign multiple users to a role in a single operation, streamlining onboarding and role management.

### Relationship to Parent Architecture

This implementation depends on decisions made in:
- **Architecture Reference**: `dev/archived/multi-role-authorization/` (completed)
- **JWT Claims v4**: effective_permissions structure deployed

This was the **original feature request** that prompted the multi-role authorization investigation. The investigation revealed that the single-role JWT structure was a blocker, leading to the effective permissions architecture.

### Key Decisions

1. **Enhance Existing Routes**: Add bulk assignment to `/roles/manage` rather than creating new routes
2. **Single Role Per Operation**: Bulk assign users to ONE role at a time (simpler UX)
3. **Scope Selection Required**: User must specify scope when assigning (supports multi-scope architecture)
4. **Atomic Per-User**: Each user assignment is atomic; partial failures allowed
5. **Event-Sourced**: Each assignment emits a domain event for audit trail
6. **Use existing event type**: Reuse `user.role.assigned` with `correlation_id` linking bulk operations - Added 2026-02-03
7. **Query `users` table directly**: The `users` table is auth-synced, NOT a projection - Added 2026-02-03

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
│  │ RolesManagePage                                                 ││
│  │   └── BulkAssignmentDialog                                      ││
│  │         ├── UserSelectionList (multi-select)                    ││
│  │         └── Result display (success/failure)                    ││
│  │                                                                  ││
│  │ BulkRoleAssignmentViewModel                                     ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                              │ Supabase RPC
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       DATABASE                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ api.bulk_assign_role(role_id, user_ids[], scope_path)         │  │
│  │   → Permission check (user.role_assign)                        │  │
│  │   → Scope validation (within caller's scope)                   │  │
│  │   → Loops through user_ids                                     │  │
│  │   → Emits user.role.assigned event per user                   │  │
│  │   → Returns {successful: uuid[], failed: {uuid, reason}[]}    │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ api.list_users_for_bulk_assignment(role_id, scope_path)       │  │
│  │   → Queries `users` table (NOT users_projection!)             │  │
│  │   → Joins user_roles_projection for current roles             │  │
│  │   → Filters already-assigned users                             │  │
│  │   → Supports search and pagination                             │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Tech Stack

- **Frontend**: React 19 + TypeScript + MobX
- **UI Components**: Tailwind CSS + Radix UI Dialog
- **State Management**: MobX ViewModels (MVVM pattern)
- **API**: Supabase RPC functions in `api` schema
- **Multi-select**: Custom checkbox list component

## File Structure

### Files Created

**Frontend Components:**
- `frontend/src/components/roles/BulkAssignmentDialog.tsx` - Modal with user selection and results
- `frontend/src/components/roles/UserSelectionList.tsx` - Checkbox list with search

**ViewModels:**
- `frontend/src/viewModels/roles/BulkRoleAssignmentViewModel.ts` - All bulk assignment state and logic

**Types:**
- `frontend/src/types/bulk-assignment.types.ts` - BulkAssignmentResult, SelectableUser interfaces

**Backend (SQL Migrations):**
- `infrastructure/supabase/supabase/migrations/20260203190007_bulk_role_assignment.sql` - Initial API functions
- `infrastructure/supabase/supabase/migrations/20260203204826_fix_bulk_assign_deleted_at.sql` - Fix hard delete handling
- `infrastructure/supabase/supabase/migrations/20260203205138_fix_bulk_assign_users_table.sql` - Fix table/column names

### Files Modified

- `frontend/src/pages/roles/RolesManagePage.tsx` - Added bulk assign button and dialog
- `frontend/src/services/roles/IRoleService.ts` - Added bulk assign methods
- `frontend/src/services/roles/SupabaseRoleService.ts` - Implemented bulk assign RPCs
- `frontend/src/services/roles/MockRoleService.ts` - Mock implementation for dev mode

## Important Constraints & Gotchas

### 1. `users` vs `users_projection` - CRITICAL

The `users` table is **NOT** a CQRS projection. It's synced from `auth.users` via database triggers.

| Table | Type | Source |
|-------|------|--------|
| `users` | Sync table | Mirrors `auth.users` |
| `users_projection` | Does NOT exist | Common misconception |
| `user_roles_projection` | CQRS projection | From domain events |
| `roles_projection` | CQRS projection | From domain events |
| `organizations_projection` | CQRS projection | From domain events |

**Columns in `users`:**
- `name` (not `display_name`)
- `current_organization_id` (not `organization_id`)
- `email`, `is_active`, `deleted_at`

### 2. Hard Deletes vs Soft Deletes

| Table | Delete Strategy |
|-------|----------------|
| `user_roles_projection` | **Hard delete** (no `deleted_at` column) |
| `roles_projection` | Soft delete (`deleted_at` column) |
| `users` | Soft delete (`deleted_at` column) |
| `organizations_projection` | Soft delete (`deleted_at` column) |

This caused the "column ur.deleted_at does not exist" error when querying user_roles_projection.

### 3. Correlation ID for Bulk Operations

All events from a bulk operation share the same `correlation_id`:

```sql
v_event_metadata := jsonb_build_object(
  'correlation_id', p_correlation_id,
  'bulk_operation', true,
  'bulk_operation_id', p_correlation_id::TEXT,
  'user_index', v_user_index,
  'total_users', v_total_users
);
```

Query all events from a bulk operation:
```sql
SELECT * FROM domain_events
WHERE correlation_id = 'abc-123'::uuid
ORDER BY created_at;
```

### 4. Role Loading from URL

When navigating from `/roles` to `/roles/manage?roleId=xxx`, the role must be loaded:

```typescript
// RolesManagePage.tsx
const initialRoleId = searchParams.get('roleId');

useEffect(() => {
  if (initialRoleId && !viewModel.isLoading && viewModel.roles.length > 0 && panelMode === 'empty') {
    selectAndLoadRole(initialRoleId);
  }
}, [initialRoleId, viewModel.isLoading, viewModel.roles.length, panelMode, selectAndLoadRole]);
```

## Reference Materials

- **Multi-role Authorization**: `dev/archived/multi-role-authorization/` (completed)
- **JWT Claims v4**: `documentation/infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md`
- **A4C MVVM Patterns**: `frontend/CLAUDE.md`
- **Existing Role Pages**: `frontend/src/pages/roles/`

## Commits

| Commit | Description |
|--------|-------------|
| `eb41125d` | feat(roles): Add bulk role assignment feature |
| `4fd69dbb` | fix(roles): Fix role creation/selection silent failures |
| `5ac9eace` | fix(roles): Load role from URL param when navigating from /roles |
| `a3be15c1` | fix(db): Remove invalid deleted_at refs from bulk assign functions |
| `f503e43c` | fix(db): Use correct users table and column names in bulk assign |

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
