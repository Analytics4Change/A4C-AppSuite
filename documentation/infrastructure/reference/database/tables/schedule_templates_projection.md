---
status: current
last_updated: 2026-02-17
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection for named schedule templates with weekly grid definitions, optional OU scope, and multi-user assignment.

**When to read**:
- Building schedule template management UI
- Understanding the template + assignment schedule model
- Querying templates by organization, status, or search term
- Implementing schedule CRUD operations

**Prerequisites**: [organizations_projection](./organizations_projection.md), [organization_units_projection](./organization_units_projection.md)

**Key topics**: `schedule`, `schedule-template`, `weekly-schedule`, `cqrs-projection`, `org-unit-scoped`

**Estimated read time**: 8 minutes
<!-- TL;DR-END -->

# schedule_templates_projection

## Overview

CQRS projection table that stores named schedule templates. Each record represents a weekly schedule definition within an organization, optionally scoped to a specific organization unit. Users are assigned to templates via `schedule_user_assignments_projection`. The source of truth is `schedule.*` events in the `domain_events` table, processed by `process_schedule_event()` router.

Key characteristics:
- **Template model**: Schedules are first-class entities, not per-user clones
- **Named templates**: Each template has a `schedule_name` (e.g., "Day Shift M-F 8-4")
- **Weekly JSONB format**: Days as keys (`monday`-`sunday`), values are `{begin: "HHMM", end: "HHMM"}` or `null` for days off
- **Multi-user assignment**: Multiple users can be assigned to the same template
- **Full lifecycle**: Create, update, deactivate, reactivate, delete
- **Deletion constraints**: Must be inactive + 0 assignments before deletion

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key (template ID) |
| organization_id | uuid | NO | - | FK to `organizations_projection(id)` |
| org_unit_id | uuid | YES | - | FK to `organization_units_projection(id)` — optional OU scope |
| schedule_name | text | NO | - | Display name (e.g., "Day Shift M-F 8-4") |
| schedule | jsonb | NO | - | Weekly schedule (see format below) |
| is_active | boolean | YES | true | Template active status |
| created_at | timestamptz | YES | now() | Record creation timestamp |
| updated_at | timestamptz | YES | now() | Record update timestamp |
| assigned_user_count | integer | NO | 0 | Denormalized count of assigned users (maintained by handlers) |
| created_by | uuid | YES | - | User who created the template |
| last_event_id | uuid | YES | - | Last domain event that modified this record |

### Schedule JSONB Format

```json
{
  "monday":    { "begin": "0800", "end": "1630" },
  "tuesday":   { "begin": "0800", "end": "1630" },
  "wednesday": { "begin": "0800", "end": "1630" },
  "thursday":  { "begin": "0800", "end": "1630" },
  "friday":    { "begin": "0800", "end": "1200" },
  "saturday":  null,
  "sunday":    null
}
```

- Keys: `monday` through `sunday`
- Values: `{ begin: "HHMM", end: "HHMM" }` for working days, `null` for days off
- Times use 24-hour HHMM format (e.g., `"0800"` = 8:00 AM, `"1630"` = 4:30 PM)

## Constraints

| Constraint | Type | Definition |
|-----------|------|------------|
| `schedule_templates_projection_pkey` | PRIMARY KEY | `(id)` |
| `schedule_templates_projection_organization_id_fkey` | FOREIGN KEY | `organization_id -> organizations_projection(id)` |
| `schedule_templates_projection_org_unit_id_fkey` | FOREIGN KEY | `org_unit_id -> organization_units_projection(id)` |

## Indexes

| Index | Definition |
|-------|-----------|
| `schedule_templates_projection_pkey` | `UNIQUE (id)` |
| `idx_schedule_templates_org` | `(organization_id) WHERE is_active = true` |
| `idx_schedule_templates_org_ou` | `(organization_id, org_unit_id) WHERE is_active = true` |

## RLS Policies

| Policy | Command | Condition |
|--------|---------|-----------|
| `schedule_templates_select` | SELECT | `organization_id = get_current_org_id()` |
| `schedule_templates_modify` | ALL | `organization_id = get_current_org_id()` |

## API RPCs

| Function | Purpose | Event Emitted |
|----------|---------|--------------|
| `api.create_schedule_template(p_name, p_schedule, p_org_unit_id, p_user_ids[])` | Create template + initial assignments | `schedule.created` + `schedule.user_assigned` per user |
| `api.update_schedule_template(p_template_id, p_name, p_schedule, p_org_unit_id)` | Update template definition | `schedule.updated` |
| `api.deactivate_schedule_template(p_template_id, p_reason)` | Soft-deactivate template | `schedule.deactivated` |
| `api.reactivate_schedule_template(p_template_id)` | Reactivate template | `schedule.reactivated` |
| `api.delete_schedule_template(p_template_id, p_reason)` | Delete (must be inactive + 0 assignments) | `schedule.deleted` |
| `api.list_schedule_templates(p_org_id, p_status, p_search)` | List with assignment counts | - |
| `api.get_schedule_template(p_template_id)` | Template detail + assigned users | - |

## Domain Events

- `schedule.created` — Template created (stream_type: `schedule`)
- `schedule.updated` — Template modified (name, schedule, OU)
- `schedule.deactivated` — Template deactivated
- `schedule.reactivated` — Template reactivated
- `schedule.deleted` — Template permanently deleted

## Frontend Integration

The schedule management UI lives at:
- **Manage page**: `/schedules/manage` — Split-view CRUD (list 1/3 + form 2/3)

See [schedule-management.md](../../../../frontend/reference/schedule-management.md) for frontend component details.

## See Also

- [schedule_user_assignments_projection](./schedule_user_assignments_projection.md) — User-to-template assignments
- [organizations_projection](./organizations_projection.md) — Parent organization
- [organization_units_projection](./organization_units_projection.md) — Optional OU scope
- [user_schedule_policies_projection](./user_schedule_policies_projection.md) — Old table (dropped)

## Related Documentation

- [event-handler-pattern.md](../../../patterns/event-handler-pattern.md) — Schedule event router
- [schedule-management.md](../../../../frontend/reference/schedule-management.md) — Frontend reference
