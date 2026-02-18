---
status: current
last_updated: 2026-02-17
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Frontend reference for schedule template management — split-view CRUD, user assignment, and weekly grid components.

**When to read**:
- Modifying schedule list, form, or management pages
- Understanding the schedule ViewModel pattern
- Adding new schedule features or fields
- Debugging schedule CRUD flow

**Key topics**: `schedule`, `schedule-template`, `schedule-crud`, `schedule-form`, `weekly-grid`, `schedule-management`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# Schedule Management Frontend Reference

## Architecture

The schedule management feature follows the MVVM + CQRS pattern. Schedules are **templates** — first-class entities that users are assigned to, not per-user clones.

| Concern | Component | Pattern Source |
|---------|-----------|---------------|
| List ViewModel | `ScheduleListViewModel` | `RolesViewModel` |
| Form ViewModel | `ScheduleFormViewModel` | `RoleFormViewModel` |
| List Component | `ScheduleList` | `RoleList` |
| Card Component | `ScheduleCard` | `RoleCard` |
| Form Fields | `ScheduleFormFields` | `RoleFormFields` |
| User Assignment | `ScheduleUserAssignmentDialog` | `RoleAssignmentDialog` |
| List Page | `ScheduleListPage` | `RolesPage` |
| Manage Page | `SchedulesManagePage` | `RolesManagePage` |

## File Structure

```
frontend/src/
  types/schedule.types.ts              # ScheduleTemplate, ScheduleAssignment, WeeklySchedule, DaySchedule
  services/schedule/
    IScheduleService.ts                # Service interface (9 methods)
    SupabaseScheduleService.ts         # Real implementation (api.* RPCs)
    MockScheduleService.ts             # Mock for npm run dev
    ScheduleServiceFactory.ts          # DI factory
  viewModels/schedule/
    ScheduleListViewModel.ts           # List state, filtering, CRUD actions
    ScheduleFormViewModel.ts           # Form data, validation, dirty tracking
  components/schedules/
    ScheduleCard.tsx                    # Card in list view
    ScheduleList.tsx                    # Filterable list with search + status tabs
    ScheduleFormFields.tsx             # Name, weekly grid, OU selector
    ScheduleUserAssignmentDialog.tsx   # Modal user checklist
    WeeklyScheduleGrid.tsx             # 7-day toggle grid with time inputs
    index.ts                           # Barrel exports
  pages/schedules/
    ScheduleListPage.tsx               # /schedules - card grid overview
    SchedulesManagePage.tsx            # /schedules/manage - split-view CRUD
    index.ts                           # Barrel exports
```

## Routes

| Path | Page | Permission |
|------|------|-----------|
| `/schedules` | `ScheduleListPage` | `user.schedule_manage` |
| `/schedules/manage` | `SchedulesManagePage` | `user.schedule_manage` |
| `/schedules/manage?scheduleId=<uuid>` | Pre-selects template for editing | `user.schedule_manage` |

## Key Concepts

### Template Model

Schedules are first-class **templates** with a name, weekly grid, and optional OU scope. Multiple users are assigned to a single template. This replaced the old per-user clone model (`user_schedule_policies_projection`, now dropped).

### Types

| Type | Purpose |
|------|---------|
| `ScheduleTemplate` | Template from `schedule_templates_projection` (list view) |
| `ScheduleTemplateDetail` | Template + `assigned_users` array (detail view) |
| `ScheduleAssignment` | User-to-template assignment row |
| `WeeklySchedule` | JSONB weekly grid (`monday`-`sunday`) |
| `DaySchedule` | Single day `{ begin: "HHMM", end: "HHMM" }` |
| `ScheduleDeleteError` | Structured error with `STILL_ACTIVE` or `HAS_USERS` codes |

### Service Layer (CQRS)

All data access goes through `api.*` schema RPCs:

| Method | RPC Function | Purpose |
|--------|-------------|---------|
| `listTemplates` | `api.list_schedule_templates` | Filtered list with `assigned_user_count` |
| `getTemplate` | `api.get_schedule_template` | Template detail + assigned users |
| `createTemplate` | `api.create_schedule_template` | Create template + initial user assignments |
| `updateTemplate` | `api.update_schedule_template` | Update name, schedule, or OU scope |
| `deactivateTemplate` | `api.deactivate_schedule_template` | Soft-deactivate |
| `reactivateTemplate` | `api.reactivate_schedule_template` | Reactivate |
| `deleteTemplate` | `api.delete_schedule_template` | Hard-delete (must be inactive + 0 assignments) |
| `assignUser` | `api.assign_user_to_schedule` | Assign user to template |
| `unassignUser` | `api.unassign_user_from_schedule` | Remove user from template |

### Delete Safety

A template must be **inactive** and have **0 assigned users** before deletion. The manage page enforces this with:
- An "activeWarning" dialog when attempting to delete an active template (offers to deactivate first)
- A "hasUsers" dialog when attempting to delete a template with assignments (lists affected users)

### Weekly Schedule Grid

The `WeeklyScheduleGrid` component renders 7 rows (Monday-Sunday), each with a toggle and start/end time inputs. Times are stored in HHMM format (e.g., `"0800"` for 8:00 AM).

## Related Documentation

- [schedule_templates_projection](../../infrastructure/reference/database/tables/schedule_templates_projection.md) - Template table reference
- [schedule_user_assignments_projection](../../infrastructure/reference/database/tables/schedule_user_assignments_projection.md) - Assignment table reference
- [EVENT-DRIVEN-ARCHITECTURE](../../infrastructure/guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md) - CQRS and event sourcing
- [event-handler-pattern](../../infrastructure/patterns/event-handler-pattern.md) - Event handler implementation
