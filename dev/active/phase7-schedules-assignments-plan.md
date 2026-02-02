# Plan: Phase 7 — Staff Schedules & Client Assignments

## Summary

Add admin UIs for managing staff work schedules (Phase 7A) and client-staff assignment mappings (Phase 7B). Both use the CQRS event-driven pattern with `api.*` schema RPC functions.

## Architecture

- **Write path**: Frontend → `.schema('api').rpc()` → `api.emit_domain_event()` → trigger → event handler → projection update
- **Read path**: Frontend → `.schema('api').rpc()` → query projection table → return JSONB
- **Permissions**: `user.schedule_manage` (schedules), `user.client_assign` (assignments), both org-scoped
- **Nav**: Two new sidebar items under User Management, provider-only

## Routes

| Route | Permission | Page |
|-------|-----------|------|
| `/schedules` | `user.schedule_manage` | ScheduleListPage (card overview) |
| `/schedules/:userId` | `user.schedule_manage` | ScheduleEditPage (weekly grid) |
| `/assignments` | `user.client_assign` | AssignmentListPage |
| `/assignments/:userId` | `user.client_assign` | UserCaseloadPage |

## Phase 7A: Complete

Backend RPCs deployed, frontend schedules UI complete. See tasks.md for details.

## Phase 7B: Pending

Client assignments UI. Same service layer pattern as schedules. Feature flag check against `direct_care_settings.enable_staff_client_mapping`.

## Backend RPCs (all deployed)

### Schedule RPCs
- `api.create_user_schedule(p_user_id, p_schedule, p_org_unit_id, p_effective_from, p_effective_until, p_reason)`
- `api.update_user_schedule(p_schedule_id, p_schedule, p_org_unit_id, p_effective_from, p_effective_until, p_reason)`
- `api.deactivate_user_schedule(p_schedule_id, p_reason)`
- `api.list_user_schedules(p_org_id, p_user_id, p_org_unit_id, p_active_only)`

### Assignment RPCs
- `api.assign_client_to_user(p_user_id, p_client_id, p_assigned_until, p_notes, p_reason)`
- `api.unassign_client_from_user(p_user_id, p_client_id, p_reason)`
- `api.list_user_client_assignments(p_org_id, p_user_id, p_client_id, p_active_only)`
