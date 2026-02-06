# Context: Staff Schedule Management CRUD

## Decision Record

**Date**: 2026-02-05
**Feature**: Staff Schedule Management — Named Schedules with Full CRUD
**Goal**: Transform basic schedule UI into a cohesive card-based CRUD experience matching the existing role management UX pattern.

### Key Decisions

1. **Named Schedules (not per-user)**: Schedules are defined by name (e.g., "Day Shift M-F 8-4") and assigned to multiple users. Each user still gets their own projection row, but the UI groups by `schedule_name`. This mirrors how roles work: define the role → assign users.

2. **Greenfield Rewrite**: No backward compatibility. Existing schedule pages/components/tests are cleanly replaced. The projection table was TRUNCATED (no production schedule data exists yet).

3. **Mirror Role Management UX**: All components follow the exact patterns from `RolesPage`, `RolesManagePage`, `RoleCard`, `RoleList`, `RoleFormFields`, `RoleAssignmentDialog`. Same glassmorphism cards, split-view manage page, danger zone pattern.

4. **CQRS Compliance**: All writes go through `api.*` RPCs emitting domain events. All reads query projections via `api.*` RPCs. Frontend calls `supabase.schema('api').rpc(...)` exclusively.

5. **No Trigger Modifications**: Events route through the existing `process_domain_event()` BEFORE INSERT trigger → `process_user_event(p_event record)` router. No new triggers created. Only the router function was updated with new CASE entries.

6. **Fixed aggregate_id Bug**: Existing schedule handlers referenced `p_event.aggregate_id` which doesn't exist on `domain_events` (column is `stream_id`). Fixed all handlers to use `p_event.stream_id`. This was a latent bug — no schedule events had been processed in production yet.

7. **Permission Reuse**: The existing `user.schedule_manage` permission covers all CRUD operations (create, update, deactivate, reactivate, delete). No new permissions needed. Description updated via `permission.updated` domain event.

## Technical Context

### Architecture
- **Event Sourcing + CQRS**: Write via RPCs → emit domain events → event handlers update projections → read via RPCs
- **Multi-tenancy**: RLS policies enforce org isolation using JWT claims (`get_current_org_id()`)
- **Split event handlers**: Router function dispatches to individual handler functions (not monolithic)

### Tech Stack
- **Backend**: PostgreSQL (Supabase), PL/pgSQL functions in `api` schema
- **Frontend**: React 19 + TypeScript + MobX (state management) + Tailwind CSS
- **Contracts**: AsyncAPI 2.6.0 for event schemas, TypeScript types generated from contracts

### Dependencies
- `ConfirmDialog` component for destructive actions
- `WeeklyScheduleGrid` component (existing, moved to `components/schedules/`)
- `getOrganizationUnitService()` for OU tree in scope selector
- `useAuth()` hook for permission checking
- `RequirePermission` component for route guards
- `api.list_users` RPC for user assignment dialog

## File Structure

### Infrastructure (Phase 1 — COMPLETE)
- `infrastructure/supabase/supabase/migrations/20260206021113_schedule_name_and_lifecycle.sql` — Main migration
- `infrastructure/supabase/contracts/asyncapi/domains/rbac.yaml` — Added PermissionUpdated message/schemas
- `infrastructure/supabase/contracts/asyncapi/asyncapi.yaml` — Added channel reference

### Frontend Types & Services (Phase 2)
- `frontend/src/types/schedule.types.ts` — Add `schedule_name` to `UserSchedulePolicy`
- `frontend/src/services/schedule/IScheduleService.ts` — Add new methods
- `frontend/src/services/schedule/SupabaseScheduleService.ts` — Implement new RPCs
- `frontend/src/services/schedule/MockScheduleService.ts` — Mirror for mock mode

### Frontend ViewModels (Phase 3)
- `frontend/src/viewModels/schedule/ScheduleListViewModel.ts` — Replace entirely
- `frontend/src/viewModels/schedule/ScheduleFormViewModel.ts` — New
- Delete: `ScheduleEditViewModel.ts`, `ScheduleEditViewModel.test.ts`

### Frontend Components (Phase 4)
- `frontend/src/components/schedules/ScheduleCard.tsx` — New
- `frontend/src/components/schedules/ScheduleList.tsx` — New
- `frontend/src/components/schedules/ScheduleFormFields.tsx` — New
- `frontend/src/components/schedules/ScheduleUserAssignmentDialog.tsx` — New
- `frontend/src/components/schedules/WeeklyScheduleGrid.tsx` — Moved from pages
- `frontend/src/components/schedules/index.ts` — Barrel export

### Frontend Pages (Phase 5)
- `frontend/src/pages/schedules/ScheduleListPage.tsx` — Replace entirely
- `frontend/src/pages/schedules/SchedulesManagePage.tsx` — New
- `frontend/src/App.tsx` — Update routes
- Delete: `ScheduleEditPage.tsx`

## Related Components (Mirror Patterns)

| Schedule Component | Role Component (Pattern Source) |
|---|---|
| `ScheduleCard` | `frontend/src/components/roles/RoleCard.tsx` |
| `ScheduleList` | `frontend/src/components/roles/RoleList.tsx` |
| `ScheduleFormFields` | `frontend/src/components/roles/RoleFormFields.tsx` |
| `ScheduleUserAssignmentDialog` | `frontend/src/components/roles/RoleAssignmentDialog.tsx` |
| `ScheduleListViewModel` | `frontend/src/viewModels/roles/RolesViewModel.ts` |
| `ScheduleFormViewModel` | `frontend/src/viewModels/roles/RoleFormViewModel.ts` |
| `ScheduleListPage` | `frontend/src/pages/roles/RolesPage.tsx` |
| `SchedulesManagePage` | `frontend/src/pages/roles/RolesManagePage.tsx` |

## Key Patterns and Conventions

### RPC Response Envelope
All RPCs return JSONB: `{ success: true/false, error?: string, data?: ... }`
Frontend service layer parses and throws on `success: false`.

### ViewModel Pattern (MobX)
- Observable state with `makeAutoObservable(this)`
- Computed properties for filtered/grouped views
- Actions return `{ success, error }` for UI feedback
- `IScheduleService` injected via constructor (DI for testing)

### WCAG 2.1 AA Requirements
- `aria-label` on all interactive elements
- `aria-pressed` on filter buttons
- `role="listbox"` with `aria-activedescendant` on lists
- `role="dialog"` + `aria-modal="true"` + focus trap on modals
- `role="alert"` on error banners

## Important Constraints

1. **CQRS Query Rule**: NEVER use `.from('table').select(...)` with PostgREST embedding. Always use `supabase.schema('api').rpc(...)`.
2. **Event Metadata**: Every domain event must include `user_id` and `organization_id` in metadata.
3. **Reason Field**: Destructive actions (deactivate, reactivate, delete) require a reason (min 10 chars in UI).
4. **Delete Safety**: Must deactivate before delete. Handler enforces `is_active = false` check.
5. **Old RPC Overloads**: The old `create_user_schedule(UUID, JSONB, UUID, DATE, DATE, TEXT)` signature still exists in the database as a separate overload. The new signature is `(UUID, TEXT, JSONB, UUID, DATE, DATE, TEXT)`. Frontend must use the new signature.

## Why This Approach?

**Named schedules vs per-user schedules**: The original design created one schedule per user. This made it hard to manage common patterns (e.g., "all day-shift nurses get the same schedule"). Named schedules let admins define a schedule once, then assign it to multiple users — exactly like roles. The projection still has one row per user (for efficient per-user lookups by Temporal workflows), but the UI groups by name.

**Greenfield vs incremental**: Since no production schedule data exists and the existing UI was minimal, a clean rewrite is simpler than backward-compatible migration. TRUNCATE + new column is cleaner than ALTER + backfill.
