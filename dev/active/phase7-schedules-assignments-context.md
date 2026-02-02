# Context: Phase 7 — Staff Schedules & Client Assignments

## Overview

Phase 7 adds admin UIs for managing staff work schedules and client-staff assignment mappings. Split into 7A (Schedules) and 7B (Assignments).

Phase 7A is **complete** (pending commit). Phase 7B is planned but not started.

## Key Decisions

1. **Hybrid routing**: Top-level overview pages + drill-down detail pages (`/schedules`, `/schedules/:userId`, `/assignments`, `/assignments/:userId`) — decided 2026-02-02
2. **CQRS pattern**: Write RPCs emit domain events via `api.emit_domain_event()`, read RPCs query projection tables — consistent with `api.create_role()` pattern
3. **Permission gating**: `user.schedule_manage` for schedules, `user.client_assign` for assignments, both org-scoped
4. **Permission seeding via domain events**: Permissions defined by emitting `permission.defined` events (NOT direct INSERT into projection) — follows `001-permissions-seed.sql` pattern
5. **AsyncAPI bundler reachability**: Schedule/assignment messages had to be added to `asyncapi.yaml` channels for Modelina to include them in generated types — gotcha from Phase 6
6. **Weekly schedule format**: JSONB with days as keys, `{begin: "HHMM", end: "HHMM"}` values, null for days off

## Files Created (Phase 7A)

### Backend (deployed to production)
- `infrastructure/supabase/supabase/migrations/20260202181252_seed_schedule_assignment_permissions.sql` — Seeds `user.schedule_manage` + `user.client_assign` permissions and role templates
- `infrastructure/supabase/supabase/migrations/20260202181537_schedule_assignment_crud_rpcs.sql` — 7 CRUD RPC functions (`api.create_user_schedule`, `api.update_user_schedule`, `api.deactivate_user_schedule`, `api.list_user_schedules`, `api.assign_client_to_user`, `api.unassign_client_from_user`, `api.list_user_client_assignments`)

### Frontend types
- `frontend/src/types/schedule.types.ts` — `DaySchedule`, `WeeklySchedule`, `UserSchedulePolicy`, `DAYS_OF_WEEK`
- `frontend/src/types/client-assignment.types.ts` — `UserClientAssignment`

### Frontend service layer
- `frontend/src/services/schedule/IScheduleService.ts`
- `frontend/src/services/schedule/SupabaseScheduleService.ts`
- `frontend/src/services/schedule/MockScheduleService.ts`
- `frontend/src/services/schedule/ScheduleServiceFactory.ts`

### Frontend ViewModels
- `frontend/src/viewModels/schedule/ScheduleListViewModel.ts` — list/filter/deactivate
- `frontend/src/viewModels/schedule/ScheduleEditViewModel.ts` — create/edit with weekly grid

### Frontend pages
- `frontend/src/pages/schedules/ScheduleListPage.tsx` — card-based overview with search
- `frontend/src/pages/schedules/ScheduleEditPage.tsx` — weekly grid editor
- `frontend/src/pages/schedules/WeeklyScheduleGrid.tsx` — 7-row grid component
- `frontend/src/pages/schedules/index.ts`

### Files Modified
- `frontend/src/App.tsx` — Added `/schedules` and `/schedules/:userId` routes with `RequirePermission`
- `frontend/src/components/layouts/MainLayout.tsx` — Added "Staff Schedules" nav item (Calendar icon, `user.schedule_manage`, provider only)
- `infrastructure/supabase/contracts/asyncapi/asyncapi.yaml` — Added 5 channel refs for schedule/assignment events
- `infrastructure/supabase/sql/99-seeds/001-permissions-seed.sql` — Added 2 permissions (updated counts)
- `infrastructure/supabase/sql/99-seeds/002-role-permission-templates-seed.sql` — Added 2 provider_admin entries (updated counts)
- `infrastructure/supabase/contracts/types/events.ts` — Removed duplicate `Address` interface (lint fix)
- `infrastructure/supabase/contracts/types/generated-events.ts` — Removed unused `eslint-disable` (lint fix)

## Important Constraints

- **`display_name` null in permissions_projection**: The `process_permission_event` handler doesn't extract `display_name` from event_data. Both new permissions have null display_name in production. Not a blocker — existing limitation.
- **No clients table**: `client_id` in assignments is a UUID with no FK. Display as raw UUID for now until client domain is rebuilt with event-driven architecture.
- **Schedule uniqueness**: `user_schedule_policies_projection` has UNIQUE on `(user_id, organization_id, org_unit_id)` — one active schedule per user/org/OU combination.
- **Assignment upsert**: Event handler uses `ON CONFLICT (user_id, client_id) DO UPDATE` — re-assigning reactivates.

## Reference Patterns

- `api.create_role()` in `migrations.archived/.../20251224220822_role_management_api.sql` — CQRS RPC pattern
- `frontend/src/services/direct-care/` — Service factory pattern with `getDeploymentConfig()`
- `frontend/src/viewModels/settings/DirectCareSettingsViewModel.ts` — ViewModel with dirty checking + reason
- `infrastructure/supabase/contracts/asyncapi/domains/user.yaml` — Schedule/assignment event schemas

## Validation Status

- Typecheck: clean
- Build: passes
- Lint: 0 errors, 0 warnings (after fixing 2 pre-existing generated file issues)
- Tests: not run (no new tests written for Phase 7A — planned for later)
