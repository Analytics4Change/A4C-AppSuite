# Tasks: Schedule Assignment Management

## Phase 1: Backend (SQL Migration) ✅ COMPLETE

- [x] Create migration via `supabase migration new schedule_assignment_management`
- [x] Add UNIQUE constraint `(user_id, organization_id)` on `schedule_user_assignments_projection`
- [x] Create `api.list_users_for_schedule_management` RPC (permission check, org scoping, current_schedule info)
- [x] Create `api.sync_schedule_assignments` RPC (auto-transfer, event emission, JSONB result)
- [x] Apply migration via MCP `apply_migration`
- [x] Verify UNIQUE constraint via `execute_sql`
- [x] Test `list_users_for_schedule_management` via `execute_sql`
- [x] Test `sync_schedule_assignments` via `execute_sql`

## Phase 2: Shared Types ✅ COMPLETE

- [x] Create `frontend/src/types/assignment.types.ts` with base types
- [x] Refactor `bulk-assignment.types.ts` to extend base types + add schedule types
- [x] Verify `npm run typecheck` passes

## Phase 3: Shared UI Sub-Components ✅ COMPLETE

- [x] Create `components/ui/assignment/AssignmentAlert.tsx` (extract from RoleAssignmentDialog lines 56-79)
- [x] Create `components/ui/assignment/ManageableUserList.tsx` (extract from lines 85-213, add renderUserContext prop)
- [x] Create `components/ui/assignment/SyncResultDisplay.tsx` (extract from lines 218-360, add extraSections + footerNote props)
- [x] Create `components/ui/assignment/index.ts` barrel

## Phase 4: Refactor RoleAssignmentDialog ✅ COMPLETE

- [x] Refactor `RoleAssignmentDialog.tsx` to consume shared sub-components (588 -> 311 lines)
- [x] Pass `renderUserContext` for currentRoles display
- [x] Pass `footerNote` for JWT refresh note
- [x] Verify `npm run typecheck` passes
- [ ] **REGRESSION CHECK**: Roles assignment dialog opens, shows users, delta tracking works, save works, result display works

## Phase 5: Schedule Service Layer ✅ COMPLETE

- [x] Add `listUsersForScheduleManagement()` to `IScheduleService`
- [x] Add `syncScheduleAssignments()` to `IScheduleService`
- [x] Implement both methods in `SupabaseScheduleService`
- [x] Implement both methods in `MockScheduleService` (with auto-transfer logic)
- [x] Verify `npm run typecheck` passes

## Phase 6: Schedule ViewModel ✅ COMPLETE

- [x] Create `viewModels/schedule/ScheduleAssignmentViewModel.ts`
- [x] Implement state machine, delta tracking, transfer tracking
- [x] Implement `usersToTransfer` computed, enhanced `changesSummary`
- [x] Verify `npm run typecheck` passes

## Phase 7: Schedule Dialog + Page Wiring ✅ COMPLETE

- [x] Create `components/schedules/ScheduleAssignmentDialog.tsx` composing shared components
- [x] Add `renderUserContext` for transfer tags (amber "Transferring from: X")
- [x] Add `extraSections` for transferred users in result display
- [x] Update `components/schedules/index.ts` barrel
- [x] Wire into `SchedulesManagePage.tsx`: button, dialog, ViewModel, handlers
- [x] Memoize ViewModel on `currentTemplate?.id` only

## Phase 8: Final Verification ✅ COMPLETE

- [x] `npm run typecheck` passes
- [x] `npm run lint` passes
- [x] `npm run build` succeeds
- [x] Update handler reference files if needed (no handler changes in this feature — N/A)
- [x] Update MEMORY.md with completion notes

## Phase 9: UX Alignment with Roles ✅ COMPLETE

- [x] Remove mandatory user assignment from schedule create form
- [x] Delete `ScheduleUserAssignmentDialog.tsx` (no remaining consumers)
- [x] Remove barrel export from `components/schedules/index.ts`
- [x] Change "Manage User Assignments" button to always-visible + disabled when inactive (with tooltip)
- [x] Remove user count subtitle from edit card header
- [x] Fix pre-existing lint error (unused `/* eslint-disable */` in `generated-events.ts`)
- [x] `npm run typecheck && npm run lint && npm run build` all pass
- [x] Committed and deployed (`35d8a953`)

## Success Validation Checkpoints

### Immediate Validation (after Phase 1)
- [ ] UNIQUE constraint exists on `(user_id, organization_id)`
- [ ] `list_users_for_schedule_management` returns users with correct `is_assigned` and `current_schedule_*`
- [ ] `sync_schedule_assignments` correctly assigns, unassigns, and auto-transfers

### Roles Regression (after Phase 4)
- [ ] `/roles/manage` -> select role -> "Manage User Assignments" opens dialog
- [ ] Users show correct assignment status with currentRoles
- [ ] Delta tracking (add/remove tags) works
- [ ] Save produces correct result display

### Feature Complete Validation (after Phase 7)
- [ ] `/schedules/manage` -> select active template -> "Manage User Assignments" button visible
- [ ] Dialog opens, shows all org users with correct assignment status
- [ ] Users on different template show "On: Template Name" context
- [ ] Checking a user on another template shows amber "Transferring from: X" tag
- [ ] Save correctly assigns/unassigns/transfers
- [ ] Result display shows transferred section in amber
- [ ] All builds and checks pass

## Current Status

**Phase**: 9 — UX Alignment with Roles
**Status**: ✅ COMPLETE
**Last Updated**: 2026-02-18
**Next Step**: Manual regression testing (roles + schedule dialogs), then archive to `dev/archived/`
