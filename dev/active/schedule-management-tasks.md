# Tasks: Staff Schedule Management CRUD

## Phase 1: Infrastructure (Supabase Migration) ✅ COMPLETE

- [x] Add `schedule_name TEXT NOT NULL` column to `user_schedule_policies_projection`
- [x] Drop old unique constraint `user_schedule_policies_unique`
- [x] Fix `aggregate_id` → `stream_id` bug in all schedule event handlers
- [x] Update handlers to match by `schedule_id` instead of user+org+OU composite
- [x] Use `p_event.created_at` for timestamps (not `NOW()`)
- [x] Add `SET search_path` to all handlers
- [x] Create `handle_user_schedule_reactivated` handler
- [x] Create `handle_user_schedule_deleted` handler
- [x] Update `process_user_event` router with new CASE entries (v7)
- [x] Update `api.create_user_schedule` — add `p_schedule_name` parameter
- [x] Update `api.update_user_schedule` — add `p_schedule_name` parameter
- [x] Update `api.list_user_schedules` — add `schedule_name` output + filter
- [x] Create `api.reactivate_user_schedule` RPC
- [x] Create `api.delete_user_schedule` RPC
- [x] Create `api.get_schedule_by_id` RPC
- [x] All GRANT EXECUTE statements for new/updated RPCs
- [x] Create `handle_permission_updated` handler
- [x] Update `process_rbac_event` router (v3)
- [x] Emit `permission.updated` event to update description
- [x] Update AsyncAPI contracts (rbac.yaml + asyncapi.yaml)
- [x] Apply migration via MCP
- [x] Sync local migration filename with MCP timestamp
- [x] Verify: column exists, RPCs exist, handlers exist, permission description updated
- [x] Check security advisors — no new issues

## Phase 2: Frontend Types & Service Layer ✅ COMPLETE

- [x] Add `schedule_name: string` to `UserSchedulePolicy` in `schedule.types.ts`
- [x] Add `reactivateSchedule()`, `deleteSchedule()`, `getScheduleById()` to `IScheduleService`
- [x] Update `createSchedule` params: add `scheduleName: string`
- [x] Update `updateSchedule` params: add `scheduleName?: string`
- [x] Implement all changes in `SupabaseScheduleService.ts`
- [x] Implement all changes in `MockScheduleService.ts`

## Phase 3: Frontend ViewModels ✅ COMPLETE

- [x] Replace `ScheduleListViewModel.ts` — match `RolesViewModel` pattern
- [x] Create `ScheduleFormViewModel.ts` — match `RoleFormViewModel` pattern
- [x] Delete `ScheduleEditViewModel.ts`
- [x] Delete `ScheduleEditViewModel.test.ts`

## Phase 4: Frontend Components ✅ COMPLETE

- [x] Create `ScheduleCard.tsx` — mirror `RoleCard.tsx`
- [x] Create `ScheduleList.tsx` — mirror `RoleList.tsx`
- [x] Create `ScheduleFormFields.tsx` — mirror `RoleFormFields.tsx`
- [x] Create `ScheduleUserAssignmentDialog.tsx` — mirror `RoleAssignmentDialog.tsx`
- [x] Move `WeeklyScheduleGrid.tsx` from `pages/schedules/` to `components/schedules/`
- [x] Create `index.ts` barrel export
- [x] Update all imports referencing moved `WeeklyScheduleGrid`

## Phase 5: Frontend Pages & Routing ✅ COMPLETE

- [x] Replace `ScheduleListPage.tsx` — card-based overview with status tabs
- [x] Create `SchedulesManagePage.tsx` — split-view CRUD
- [x] Update `App.tsx` routes (`/schedules`, `/schedules/manage`)
- [x] Remove `/schedules/:userId` route
- [x] Delete `ScheduleEditPage.tsx`
- [x] Delete old `pages/schedules/WeeklyScheduleGrid.tsx`
- [x] Update page barrel exports `pages/schedules/index.ts`
- [x] Verify: `npm run typecheck` passes
- [x] Verify: `npm run lint` passes (zero errors)
- [x] Verify: `npm run build` succeeds

## Phase 6: Documentation ✅ COMPLETE

- [x] Update `documentation/infrastructure/reference/database/tables/user_schedule_policies_projection.md`
- [x] Create `documentation/frontend/reference/schedule-management.md`
- [x] Update `documentation/AGENT-INDEX.md` with schedule keywords

## Success Validation Checkpoints

### Immediate Validation
- [x] `npm run typecheck` — zero errors
- [x] `npm run lint` — zero errors
- [x] `npm run build` — successful

### Feature Complete Validation
- [ ] Create schedule with name, grid, users
- [ ] Edit schedule — modify name, grid, save
- [ ] Deactivate schedule — confirm dialog, status changes
- [ ] Reactivate schedule — confirm dialog, status restores
- [ ] Delete schedule (after deactivate) — removed from list
- [ ] User assignment dialog — search, check/uncheck, apply
- [ ] Unsaved changes → navigate → discard warning
- [ ] Keyboard navigation through all controls

## Current Status

**Phase**: 6 (Documentation) — COMPLETE
**Status**: ✅ All implementation phases complete
**Last Updated**: 2026-02-05
**Next Step**: Manual feature validation in `npm run dev` (mock mode)
