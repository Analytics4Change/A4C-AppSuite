# Context: Schedule Assignment Management

## Decision Record

**Date**: 2026-02-18
**Feature**: Schedule User Assignment Management (Edit Mode)
**Goal**: Add "Manage User Assignments" to schedule template edit mode with full delta tracking, auto-transfer for the 0-or-1 constraint, and shared sub-components extracted from the roles implementation.

### Key Decisions

1. **0-or-1 schedule constraint**: A user may only be assigned to at most ONE schedule template per organization. Enforced by `UNIQUE (user_id, organization_id)` on `schedule_user_assignments_projection`. The existing `(template_id, user_id)` constraint stays for fast lookups.

2. **Auto-transfer behavior**: When assigning a user already on another template, automatically unassign from old + assign to new in a single transaction. The UI shows an amber "Transferring from: X" tag. This was chosen over blocking (requires explicit unassign first) or confirmation dialogs (too many clicks).

3. **Shared sub-component extraction**: ~83% of the roles assignment ViewModel and Dialog code is domain-agnostic. Instead of cloning 800+ lines, we extract `ManageableUserList`, `SyncResultDisplay`, and `AssignmentAlert` into `components/ui/assignment/`. Domain-specific rendering via render props (`renderUserContext`, `extraSections`, `footerNote`).

4. **Refactor roles first, then build schedules**: The roles dialog is refactored to consume shared components BEFORE building the schedule feature. This validates the extraction doesn't break roles UX and ensures schedules build on proven shared code.

5. **No shared ViewModel**: Despite ~82% overlap, the ViewModel stays domain-specific (roles vs schedules) because transfer tracking, scope validation, and result types diverge enough that a generic ViewModel would need too many generics and configuration.

## Technical Context

### Architecture
- **CQRS**: Frontend queries via `api.` schema RPC functions only
- **Event Sourcing**: Assignment changes emit `schedule.user_assigned` / `schedule.user_unassigned` domain events
- **MobX MVVM**: ScheduleAssignmentViewModel with `makeAutoObservable`, delta tracking via two Sets
- **Render props**: Domain-specific user context rendering in shared list component

### Tech Stack
- **Backend**: PostgreSQL RPC functions in `api` schema, domain events trigger → router → handler
- **Frontend**: React 19, TypeScript strict, MobX, Tailwind CSS, Radix UI primitives
- **State machine**: `idle → loading → managing → confirming → saving → completed → error`

### Dependencies
- `schedule_user_assignments_projection` table (exists, needs new UNIQUE constraint)
- `schedule_templates_projection` table (exists, used for template name lookups)
- `process_schedule_event()` router (exists, already handles `schedule.user_assigned/unassigned`)
- `handle_schedule_user_assigned()` / `handle_schedule_user_unassigned()` handlers (exist)
- `SupabaseScheduleService` (exists, needs two new methods)
- `RoleAssignmentDialog` (exists, will be refactored to consume shared components)
- `RoleAssignmentViewModel` (exists, minimal type import changes only)

## File Structure

### Existing Files Modified
- `frontend/src/types/bulk-assignment.types.ts` — Refactor to extend base types, append schedule types
- `frontend/src/components/roles/RoleAssignmentDialog.tsx` — Refactor from 588 to ~200 lines using shared components
- `frontend/src/viewModels/roles/RoleAssignmentViewModel.ts` — Minor type import changes
- `frontend/src/services/schedule/IScheduleService.ts` — Add 2 new method signatures
- `frontend/src/services/schedule/SupabaseScheduleService.ts` — Add 2 new method implementations
- `frontend/src/services/schedule/MockScheduleService.ts` — Add 2 new mock implementations
- `frontend/src/components/schedules/index.ts` — Add barrel export
- `frontend/src/pages/schedules/SchedulesManagePage.tsx` — Wire button, dialog, ViewModel

### New Files Created
- `infrastructure/supabase/supabase/migrations/TIMESTAMP_schedule_assignment_management.sql` — Constraint + 2 RPCs
- `frontend/src/types/assignment.types.ts` — Shared base types
- `frontend/src/components/ui/assignment/AssignmentAlert.tsx` — Alert sub-component
- `frontend/src/components/ui/assignment/ManageableUserList.tsx` — Checkbox list with render prop
- `frontend/src/components/ui/assignment/SyncResultDisplay.tsx` — Result display with render props
- `frontend/src/components/ui/assignment/index.ts` — Barrel export
- `frontend/src/viewModels/schedule/ScheduleAssignmentViewModel.ts` — MobX ViewModel
- `frontend/src/components/schedules/ScheduleAssignmentDialog.tsx` — Dialog composing shared components

## Related Components

- **RolesManagePage** (`pages/roles/RolesManagePage.tsx`) — Reference for page wiring pattern (lines 111-129 for ViewModel memoization, 776-790 for button placement)
- **RoleAssignmentViewModel** (`viewModels/roles/RoleAssignmentViewModel.ts`) — Structure template for ScheduleAssignmentViewModel
- **SupabaseRoleService** (`services/roles/SupabaseRoleService.ts` lines 763-877) — Pattern for service implementation
- **Role assignment migration** (`migrations.archived/.../20260204003918_role_assignment_management.sql`) — SQL pattern for RPCs

## Key Patterns and Conventions

- **Delta tracking**: Two Sets — `initialAssignedUserIds` (snapshot at load) and current selection. Computed `usersToAdd` = selected but not initial. Computed `usersToRemove` = initial but not selected.
- **ViewModel memoization**: `useMemo` keyed on entity ID only (not full object) to prevent recreation bug. ESLint disable comment required.
- **Render props for domain specifics**: `renderUserContext?: (user) => ReactNode` for per-user display, `extraSections?: ReactNode` for result display additions, `footerNote?: ReactNode` for domain-specific notes.
- **Event metadata**: All RPCs include `p_event_metadata` with `user_id` (from `auth.uid()`) and `organization_id` (from `get_current_org_id()`).
- **Handler reference files**: After migration, update files at `infrastructure/supabase/handlers/schedule/`.

## Reference Materials

- Plan file: `/home/lars/.claude/plans/crystalline-stargazing-spring.md`
- Role assignment migration SQL: `infrastructure/supabase/supabase/migrations.archived/2026-february-cleanup/20260204003918_role_assignment_management.sql`
- Handler reference files: `infrastructure/supabase/handlers/schedule/`
- Table docs: `documentation/infrastructure/reference/database/tables/schedule_templates_projection.md`
- Table docs: `documentation/infrastructure/reference/database/tables/schedule_user_assignments_projection.md`

## Important Constraints

- **CQRS**: Never query tables directly — always use `api.` schema RPC functions
- **Event routing**: Never create per-event-type triggers — use existing router CASE dispatch
- **Handler refs**: Always read reference file before modifying a handler, update after migration
- **0-or-1 rule**: UNIQUE `(user_id, organization_id)` — auto-transfer handles conflicts
- **MobX**: Components reading observables MUST be wrapped with `observer()`. Never spread observable arrays.
- **Accessibility**: WCAG 2.1 Level AA — full keyboard nav, ARIA labels, focus management

## Why This Approach?

**Shared sub-components** was chosen over two alternatives:
1. **No abstraction** (clone and adapt): Would produce ~800 lines of duplication. Any future bug fix or UX change would need updates in two places.
2. **Fully generic ViewModel + Dialog**: Too many generics and configuration parameters. Transfer tracking, scope validation, and result types diverge enough that a generic ViewModel would be over-engineered.
3. **Shared sub-components** (chosen): Extracts the 83% that's identical (checkbox list, result display, alert) as composable pieces with render props for the 17% that differs. Roles code is refactored (not duplicated), schedules compose the same pieces. ~712 net new lines vs ~1,175 without sharing.
