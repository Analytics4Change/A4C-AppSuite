# Implementation Plan: Schedule Assignment Management (Edit Mode)

## Executive Summary

Add a "Manage User Assignments" button to the schedule template edit mode that mirrors the exact UX from the roles manage page: full delta tracking (add/remove), result display with success/partial/failure states, and identical visual indicators and accessibility. A key business constraint is that users can be on 0 or 1 schedule at a time, requiring auto-transfer behavior when assigning a user already on another template.

To avoid ~800 lines of duplication, we extract shared sub-components from the existing roles assignment dialog into `components/ui/assignment/`, then refactor roles to consume them, and finally build the schedule assignment feature on the same foundation.

## Phase 1: Backend (SQL Migration)

### 1.1 UNIQUE Constraint for 0-or-1 Rule
- Add `UNIQUE (user_id, organization_id)` on `schedule_user_assignments_projection`
- Keep existing `(template_id, user_id)` constraint for fast lookups
- Verify via `execute_sql`

### 1.2 `api.list_users_for_schedule_management` RPC
- Permission check: `get_permission_scope('user.schedule_manage')`
- Returns: `(id, email, display_name, is_active, is_assigned, current_schedule_id, current_schedule_name)`
- Users assigned to THIS template get `is_assigned = TRUE`, `current_schedule_*` = NULL
- Users assigned to a DIFFERENT template get `is_assigned = FALSE`, `current_schedule_*` populated
- ORDER: assigned-to-this first, then by display_name
- Reference: `migrations.archived/.../20260204003918_role_assignment_management.sql` lines 12-102

### 1.3 `api.sync_schedule_assignments` RPC
- Auto-transfer: if user is on another template, emit `schedule.user_unassigned` for old + `schedule.user_assigned` for new
- Returns JSONB with `added`, `removed`, `transferred`, `correlationId`
- Reference: same migration lines 110-363

## Phase 2: Shared Types + UI Sub-Components

### 2.1 Shared Types (`types/assignment.types.ts`)
- Extract `BaseManageableUser`, `BaseSyncResult`, `AssignmentDialogState`, `FailedAssignment`
- Refactor `bulk-assignment.types.ts` to extend base types
- Add schedule-specific types: `ScheduleManageableUser`, `SyncScheduleAssignmentsResult`, `TransferredUser`

### 2.2 Shared UI Components (`components/ui/assignment/`)
- `AssignmentAlert.tsx` — extracted from RoleAssignmentDialog lines 56-79
- `ManageableUserList.tsx` — extracted from lines 85-213, with `renderUserContext` render prop
- `SyncResultDisplay.tsx` — extracted from lines 218-360, with `extraSections` + `footerNote` props
- Barrel `index.ts`

### 2.3 Refactor RoleAssignmentDialog
- Consume shared sub-components (588 -> ~200 lines)
- Pass `renderUserContext` for currentRoles display
- Pass `footerNote` for JWT refresh note
- **Zero UX changes** — roles page looks and behaves identically

## Phase 3: Schedule Service Layer

### 3.1 Service Interface + Implementations
- Add `listUsersForScheduleManagement()` and `syncScheduleAssignments()` to `IScheduleService`
- Implement in `SupabaseScheduleService` (follow `SupabaseRoleService` pattern)
- Implement in `MockScheduleService` with auto-transfer logic

## Phase 4: Schedule ViewModel + Dialog + Page Wiring

### 4.1 ScheduleAssignmentViewModel
- Same structure as `RoleAssignmentViewModel` but with transfer tracking
- Constructor: `(service, template: {id, name})` — no scopePath
- Additional computed: `usersToTransfer`, enhanced `changesSummary`

### 4.2 ScheduleAssignmentDialog
- Composes shared sub-components with transfer UI
- `renderUserContext` shows "Transferring from: X" amber tag
- `extraSections` shows transferred users in result display

### 4.3 SchedulesManagePage Wiring
- "Manage User Assignments" button in edit mode card header
- ViewModel memoized on `currentTemplate?.id` only
- Handlers: open, close, success (refresh template data + list)

## Success Metrics

### Immediate
- [x] UNIQUE constraint verified via `execute_sql`
- [x] Both RPCs return correct data via MCP
- [x] TypeScript typecheck passes after shared type refactor
- [ ] Roles assignment dialog works identically after refactor (manual check pending)

### Feature Complete
- [x] Schedule assignment dialog opens from edit mode
- [x] Users show correct assignment status and transfer tags (code complete, manual check pending)
- [x] Save correctly assigns/unassigns/transfers (code complete, manual check pending)
- [x] Result display shows transferred section (code complete, manual check pending)
- [x] `npm run typecheck && npm run lint && npm run build` all pass

### Long-Term
- [x] Shared components reusable for future entity assignment patterns
- [x] 0-or-1 constraint prevents data integrity issues

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Roles refactor breaks existing UX | Step 4 validates roles before building schedules |
| Auto-transfer race condition | Single transaction in `sync_schedule_assignments` |
| ViewModel recreation on each render | Memoize on ID only, not full object reference |
| Missing event metadata audit fields | RPCs include `p_event_metadata` with `user_id` + `organization_id` |

## Next Steps After Completion
- ~~Update handler reference files at `infrastructure/supabase/handlers/schedule/`~~ — Not needed (no handler changes)
- ~~Update AsyncAPI contracts if new event shapes~~ — Not needed (no new event shapes)
- Archive dev-docs to `dev/archived/schedule-assignment-management/`
- Manual regression testing (roles dialog + schedule dialog)
