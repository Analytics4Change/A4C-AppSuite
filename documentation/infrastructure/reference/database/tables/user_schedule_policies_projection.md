---
status: current
last_updated: 2026-02-02
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection for staff work schedules. Stores weekly schedule policies (JSONB with day keys and begin/end HHMM values) per user, organization, and optional org unit. One active schedule per user/org/OU combination enforced via unique constraint. Managed through `api.create_user_schedule`, `api.update_user_schedule`, `api.deactivate_user_schedule`, `api.list_user_schedules` RPCs.

**When to read**:
- Building staff schedule management UI
- Understanding weekly schedule JSONB format
- Querying active schedules by organization or org unit
- Debugging schedule uniqueness constraints

**Prerequisites**: [users](./users.md), [organizations_projection](./organizations_projection.md), [organization_units_projection](./organization_units_projection.md)

**Key topics**: `schedule`, `staff-schedule`, `weekly-schedule`, `cqrs-projection`, `org-unit-scoped`

**Estimated read time**: 8 minutes
<!-- TL;DR-END -->

# user_schedule_policies_projection

## Overview

CQRS projection table that stores staff work schedule policies. Each record represents a weekly schedule for a staff member within an organization, optionally scoped to a specific organization unit. The source of truth is `user.schedule.*` events in the `domain_events` table, processed by the event handler in the CRUD RPC migration.

Key characteristics:
- **One active schedule per user/org/OU**: Enforced by `UNIQUE NULLS NOT DISTINCT (user_id, organization_id, org_unit_id)`
- **Weekly JSONB format**: Days as keys (`monday`–`sunday`), values are `{begin: "HHMM", end: "HHMM"}` or `null` for days off
- **Effective date ranges**: Optional `effective_from` and `effective_until` for time-bounded schedules
- **Permission gated**: Requires `user.schedule_manage` permission

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| user_id | uuid | NO | - | FK to `users(id)` — the staff member |
| organization_id | uuid | NO | - | FK to `organizations_projection(id)` — owning org |
| schedule | jsonb | NO | - | Weekly schedule (see format below) |
| org_unit_id | uuid | YES | - | FK to `organization_units_projection(id)` — optional OU scope |
| effective_from | date | YES | - | Schedule start date |
| effective_until | date | YES | - | Schedule end date (null = indefinite) |
| is_active | boolean | YES | true | Active status |
| created_at | timestamptz | YES | now() | Record creation timestamp |
| updated_at | timestamptz | YES | now() | Record update timestamp |
| created_by | uuid | YES | - | User who created the schedule |
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
| `user_schedule_policies_projection_pkey` | PRIMARY KEY | `(id)` |
| `user_schedule_policies_unique` | UNIQUE | `(user_id, organization_id, org_unit_id) NULLS NOT DISTINCT` |
| `user_schedule_policies_projection_user_id_fkey` | FOREIGN KEY | `user_id → users(id)` |
| `user_schedule_policies_projection_organization_id_fkey` | FOREIGN KEY | `organization_id → organizations_projection(id)` |
| `user_schedule_policies_projection_org_unit_id_fkey` | FOREIGN KEY | `org_unit_id → organization_units_projection(id)` |

The `NULLS NOT DISTINCT` on the unique constraint means a user can have at most one schedule with `org_unit_id = NULL` per organization (org-wide schedule), plus one per specific OU.

## Indexes

| Index | Definition |
|-------|-----------|
| `user_schedule_policies_projection_pkey` | `UNIQUE (id)` |
| `user_schedule_policies_unique` | `UNIQUE (user_id, organization_id, org_unit_id) NULLS NOT DISTINCT` |
| `idx_user_schedule_policies_user` | `(user_id) WHERE is_active = true` |
| `idx_user_schedule_policies_org_ou` | `(organization_id, org_unit_id) WHERE is_active = true` |
| `idx_user_schedule_policies_dates` | `(effective_from, effective_until) WHERE is_active = true` |

## RLS Policies

| Policy | Command | Condition |
|--------|---------|-----------|
| `user_schedule_policies_select` | SELECT | `organization_id = get_current_org_id()` |
| `user_schedule_policies_modify` | ALL | `has_effective_permission('user.schedule_manage', COALESCE(ou.path, org.path))` |

The modify policy checks scope against the OU path if `org_unit_id` is set, otherwise falls back to the organization path.

## API RPCs

| Function | Purpose | Event Emitted |
|----------|---------|--------------|
| `api.create_user_schedule()` | Create new schedule | `user.schedule.created` |
| `api.update_user_schedule()` | Update existing schedule | `user.schedule.updated` |
| `api.deactivate_user_schedule()` | Soft-deactivate | `user.schedule.deactivated` |
| `api.list_user_schedules()` | Query with user name/email and OU name joins | — |

## Domain Events

- `user.schedule.created` — New schedule policy created
- `user.schedule.updated` — Schedule modified (times, dates, OU)
- `user.schedule.deactivated` — Schedule deactivated

## See Also

- [organizations_projection](./organizations_projection.md) — Parent organization
- [organization_units_projection](./organization_units_projection.md) — Optional OU scope
- [users](./users.md) — Staff member reference
- [user_client_assignments_projection](./user_client_assignments_projection.md) — Related: client assignment mapping
