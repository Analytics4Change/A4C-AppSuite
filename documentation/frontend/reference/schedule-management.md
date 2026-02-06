---
status: current
last_updated: 2026-02-05
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Frontend implementation reference for Staff Schedule Management CRUD. Named schedules (e.g., "Day Shift M-F 8-4") are assigned to users via a split-view management page, mirroring the Role Management UX pattern.

**When to read**:
- Modifying schedule list, form, or management pages
- Understanding the schedule ViewModel pattern
- Adding new schedule features or fields
- Debugging schedule CRUD flow

**Key topics**: `schedule`, `schedule-crud`, `schedule-form`, `weekly-grid`, `schedule-management`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# Schedule Management Frontend Reference

## Architecture

The schedule management feature follows the same MVVM + CQRS pattern as Role Management:

| Concern | Schedule | Role (Pattern Source) |
|---------|----------|----------------------|
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
  types/schedule.types.ts              # UserSchedulePolicy, WeeklySchedule, DaySchedule
  services/schedule/
    IScheduleService.ts                # Service interface
    SupabaseScheduleService.ts         # Real implementation (api.* RPCs)
    MockScheduleService.ts             # Mock for npm run dev
    ScheduleServiceFactory.ts          # DI factory
  viewModels/schedule/
    ScheduleListViewModel.ts           # List state, filtering, CRUD actions
    ScheduleFormViewModel.ts           # Form data, validation, dirty tracking
  components/schedules/
    ScheduleCard.tsx                    # Card in list view
    ScheduleList.tsx                    # Filterable list with search + status tabs
    ScheduleFormFields.tsx             # Name, weekly grid, effective dates
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
| `/schedules/manage?scheduleId=<uuid>` | Pre-selects schedule for editing | `user.schedule_manage` |

## Key Concepts

### Named Schedules
Schedules are defined by name (e.g., "Day Shift M-F 8-4") and assigned to users. Each user gets their own row in the projection, but the UI groups by `schedule_name`. In create mode, the user selects a name + weekly grid, then assigns one or more users.

### Service Layer (CQRS)
All data access goes through `api.*` schema RPCs:
- `api.create_user_schedule` - Create with `p_schedule_name`
- `api.update_user_schedule` - Update with `p_schedule_name`
- `api.deactivate_user_schedule` - Soft-deactivate
- `api.reactivate_user_schedule` - Reactivate
- `api.delete_user_schedule` - Hard-delete (must be inactive first)
- `api.get_schedule_by_id` - Single schedule with joins
- `api.list_user_schedules` - Filtered list with user/OU joins

### Delete Safety
A schedule must be deactivated before it can be deleted. The manage page enforces this with an "activeWarning" dialog that offers to deactivate first.

### Weekly Schedule Grid
The `WeeklyScheduleGrid` component renders 7 rows (Monday-Sunday), each with a toggle and start/end time inputs. Times are stored in HHMM format (e.g., "0800" for 8:00 AM).

## Related Documentation

- [user_schedule_policies_projection](../../infrastructure/reference/database/tables/user_schedule_policies_projection.md) - Database table reference
- [EVENT-DRIVEN-ARCHITECTURE](../../infrastructure/guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md) - CQRS and event sourcing
- [event-handler-pattern](../../infrastructure/patterns/event-handler-pattern.md) - Event handler implementation
