# Implementation Plan: Staff Schedule Management CRUD

## Executive Summary

Transform the basic schedule UI into a cohesive CRUD experience matching the role/user management UX pattern. Introduces **named schedules** (e.g., "Day Shift M-F 8-4") that can be assigned to multiple users via a multi-select checklist. Each user still gets their own row in `user_schedule_policies_projection`, but the UI groups by `schedule_name` and allows bulk assignment — analogous to role management: define the role, assign users.

This is a greenfield rewrite — no backward compatibility needed. Existing schedule pages/components/tests are cleanly replaced.

## Phase 1: Infrastructure (Supabase Migration) - COMPLETE

### 1.1 Schema + Event Handlers
- Added `schedule_name TEXT NOT NULL` column to `user_schedule_policies_projection`
- Dropped old unique constraint `(user_id, organization_id, org_unit_id)` — users can now be assigned to multiple named schedules
- Fixed latent `aggregate_id` → `stream_id` bug in all schedule event handlers
- Updated handlers to match by `schedule_id` (PK) instead of user+org+OU composite
- Created `handle_user_schedule_reactivated` and `handle_user_schedule_deleted` handlers

### 1.2 RPCs
- Updated `api.create_user_schedule` — added `p_schedule_name` parameter
- Updated `api.update_user_schedule` — added `p_schedule_name` parameter
- Updated `api.list_user_schedules` — added `schedule_name` to output + `p_schedule_name` filter
- Created `api.reactivate_user_schedule(p_schedule_id, p_reason)`
- Created `api.delete_user_schedule(p_schedule_id, p_reason)`
- Created `api.get_schedule_by_id(p_schedule_id)`

### 1.3 RBAC + Events
- Created `handle_permission_updated` handler + updated RBAC router v3
- Emitted `permission.updated` event to update `user.schedule_manage` description
- Updated AsyncAPI contracts (rbac.yaml + asyncapi.yaml)

## Phase 2: Frontend Types & Service Layer

### 2.1 Type Updates
- Add `schedule_name: string` to `UserSchedulePolicy` type
- Update service interface with new methods

### 2.2 Service Layer
- Update `SupabaseScheduleService` — new RPC calls, updated signatures
- Update `MockScheduleService` — mirror all changes for `npm run dev`

## Phase 3: Frontend ViewModels

### 3.1 ScheduleListViewModel
- Rewrite to match `RolesViewModel` pattern: observable state, computed filters, grouped schedules

### 3.2 ScheduleFormViewModel
- New ViewModel mirroring `RoleFormViewModel`: form data, validation, dirty tracking, submit

### 3.3 Cleanup
- Delete `ScheduleEditViewModel.ts` and its tests

## Phase 4: Frontend Components

### 4.1 New Components
- `ScheduleCard.tsx` — glassmorphism card (mirrors `RoleCard`)
- `ScheduleList.tsx` — search + filter + scrollable card list (mirrors `RoleList`)
- `ScheduleFormFields.tsx` — form fields with validation (mirrors `RoleFormFields`)
- `ScheduleUserAssignmentDialog.tsx` — modal user checklist (mirrors `RoleAssignmentDialog`)

### 4.2 Move Component
- Move `WeeklyScheduleGrid.tsx` from `pages/schedules/` to `components/schedules/`

## Phase 5: Frontend Pages & Routing

### 5.1 Pages
- Replace `ScheduleListPage.tsx` — card grid with status tabs
- Create `SchedulesManagePage.tsx` — split-view CRUD (mirrors `RolesManagePage`)
- Delete `ScheduleEditPage.tsx`

### 5.2 Routing
- Update `App.tsx` routes: `/schedules` (list), `/schedules/manage` (CRUD)
- Remove `/schedules/:userId` route

## Phase 6: Documentation

- Update/create schedule table reference doc
- Create frontend schedule management reference doc
- Update AGENT-INDEX.md with new keywords
- Update seed file description (cosmetic)

## Success Metrics

### Immediate
- [ ] `npm run typecheck` — zero errors
- [ ] `npm run lint` — zero errors
- [ ] `npm run build` — successful

### Medium-Term
- [ ] Full CRUD flow works in `npm run dev` (mock mode)
- [ ] Create → Edit → Deactivate → Reactivate → Delete lifecycle
- [ ] Multi-user assignment dialog works

### Long-Term
- [ ] Integration mode testing with real Supabase RPCs
- [ ] WCAG 2.1 AA keyboard navigation passes

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Breaking existing schedule data | TRUNCATE in migration (greenfield, no prod data exists) |
| Old RPC signatures still called | Drop old GRANT, add new GRANT with updated signature |
| Mock service drift from Supabase | Mirror every method exactly |
