# Tasks: Phase 7 — Staff Schedules & Client Assignments

## Current Status

**Phase**: 7A complete, 7B not started
**Status**: Phase 7A ✅ COMPLETE (pending commit), Phase 7B ⏸️ PENDING
**Last Updated**: 2026-02-02
**Next Step**: Commit Phase 7A, then begin Phase 7B (Assignment service layer, ViewModels, pages)

## Phase 7 Prerequisites ✅ COMPLETE

- [x] Seed `user.schedule_manage` permission (authoritative seed file + migration)
- [x] Seed `user.client_assign` permission (authoritative seed file + migration)
- [x] Add role_permission_templates for provider_admin
- [x] Deploy permission seed migration (`20260202181252`)
- [x] Add schedule/assignment channel refs to `asyncapi.yaml`
- [x] Regenerate TypeScript types via Modelina (178 interfaces, 12 new)
- [x] Sync generated types to frontend

## Phase 7A: Backend RPCs + Schedules UI ✅ COMPLETE

- [x] Create CRUD RPC migration (`20260202181537_schedule_assignment_crud_rpcs.sql`)
  - [x] `api.create_user_schedule` — emits `user.schedule.created`
  - [x] `api.update_user_schedule` — emits `user.schedule.updated`
  - [x] `api.deactivate_user_schedule` — emits `user.schedule.deactivated`
  - [x] `api.list_user_schedules` — reads projection with user name/email + OU name joins
  - [x] `api.assign_client_to_user` — emits `user.client.assigned`
  - [x] `api.unassign_client_from_user` — emits `user.client.unassigned`
  - [x] `api.list_user_client_assignments` — reads projection with user name/email joins
- [x] Deploy CRUD RPC migration to production
- [x] Create frontend types (`schedule.types.ts`, `client-assignment.types.ts`)
- [x] Create schedule service layer (4 files: interface, Supabase, Mock, Factory)
- [x] Create `ScheduleListViewModel` (list/filter/deactivate)
- [x] Create `ScheduleEditViewModel` (create/edit with dirty checking + reason)
- [x] Create `WeeklyScheduleGrid` component (7-row grid with time inputs + checkboxes)
- [x] Create `ScheduleListPage` (card-based overview with search/filter)
- [x] Create `ScheduleEditPage` (weekly grid editor with save/reset/reason)
- [x] Add `/schedules` and `/schedules/:userId` routes to App.tsx
- [x] Add "Staff Schedules" nav item to MainLayout
- [x] Fix pre-existing lint errors (duplicate Address, unused eslint-disable)
- [x] Validate: typecheck, lint, build all pass

## Phase 7B: Client Assignments UI ⏸️ PENDING

- [ ] Create assignment service layer (4 files)
  - [ ] `IAssignmentService.ts`
  - [ ] `SupabaseAssignmentService.ts`
  - [ ] `MockAssignmentService.ts`
  - [ ] `AssignmentServiceFactory.ts`
- [ ] Create `AssignmentListViewModel`
- [ ] Create `AssignmentListPage` (overview of all assignments)
- [ ] Create `UserCaseloadPage` (individual user's client assignments)
- [ ] Add feature flag check: `direct_care_settings.enable_staff_client_mapping`
- [ ] Add `/assignments` and `/assignments/:userId` routes to App.tsx
- [ ] Add "Client Assignments" nav item to MainLayout (UserCheck icon)
- [ ] Validate: typecheck, lint, build

## Phase 7C: Testing ⏸️ PENDING

- [ ] Write ScheduleEditViewModel unit tests
- [ ] Write AssignmentListViewModel unit tests
- [ ] Manual E2E testing with real schedules
