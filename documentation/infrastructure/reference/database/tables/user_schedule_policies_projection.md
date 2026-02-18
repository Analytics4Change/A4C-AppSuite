---
status: archived
last_updated: 2026-02-17
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: This table was **dropped** in migration `20260217211231_schedule_template_refactor.sql`. It has been replaced by two new tables: `schedule_templates_projection` and `schedule_user_assignments_projection`. See those docs instead.

**When to read**:
- Understanding legacy schedule data model (pre-2026-02-17)
- Debugging data migration from old to new schedule model

**Key topics**: `schedule`, `deprecated`, `archived`

**Estimated read time**: 1 minute
<!-- TL;DR-END -->

# user_schedule_policies_projection (DROPPED)

> **This table no longer exists.** It was replaced by the schedule template model on 2026-02-17.

## Replacement

The per-user schedule clone model was replaced with a template + assignment model:

| Old Table | New Tables | Purpose |
|-----------|-----------|---------|
| `user_schedule_policies_projection` | `schedule_templates_projection` | The schedule definition (name, weekly grid, OU scope) |
| | `schedule_user_assignments_projection` | Junction table: which users are assigned to which template |

## Why It Changed

The old model cloned schedule data per user, causing:
- Schedule drift (same name, different data across users)
- No single point of management for shared schedules
- Bulk operations required N individual actions

The new model treats schedules as first-class templates that users are assigned to.

## Data Migration

Migration `20260217211231` performed the following transformation:
1. Grouped rows by `(organization_id, org_unit_id, schedule_name, schedule)` → one template per group
2. Created assignment rows linking each original user to the matching template
3. Preserved `effective_from`/`effective_until` on assignments
4. Dropped the old table

## See Also

- [schedule_templates_projection](./schedule_templates_projection.md) - New template table
- [schedule_user_assignments_projection](./schedule_user_assignments_projection.md) - New assignment table
- [schedule-management.md](../../../../frontend/reference/schedule-management.md) - Frontend reference

## Related Documentation

- [event-handler-pattern.md](../../../../documentation/infrastructure/patterns/event-handler-pattern.md) - Schedule event router
