---
status: current
last_updated: 2026-02-17
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection junction table linking users to schedule templates. Each record represents a user's assignment to a `schedule_templates_projection` template with optional effective date range. Managed through `api.assign_user_to_schedule` and `api.unassign_user_from_schedule` RPCs.

**When to read**:
- Assigning or unassigning users from schedule templates
- Querying which users are on a given schedule
- Understanding the template + assignment schedule model

**Prerequisites**: [schedule_templates_projection](./schedule_templates_projection.md), [users](./users.md)

**Key topics**: `schedule-assignment`, `schedule`, `user-assignment`, `cqrs-projection`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# schedule_user_assignments_projection

## Overview

CQRS projection junction table that links users to schedule templates. Each record represents a single user's assignment to a schedule template, with optional effective date range. Cascade-deletes when the parent template is deleted.

Key characteristics:
- **One assignment per user per template**: `UNIQUE(schedule_template_id, user_id)` constraint
- **Effective date ranges**: Optional `effective_from` and `effective_until` for time-bounded assignments
- **Cascade delete**: When a template is deleted, all assignments are removed automatically
- **Active status**: Independent of the template's active status

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key (assignment ID) |
| schedule_template_id | uuid | NO | - | FK to `schedule_templates_projection(id) ON DELETE CASCADE` |
| user_id | uuid | NO | - | FK to `users(id) ON DELETE CASCADE` |
| organization_id | uuid | NO | - | FK to `organizations_projection(id)` |
| effective_from | date | YES | - | Assignment start date |
| effective_until | date | YES | - | Assignment end date (null = indefinite) |
| is_active | boolean | YES | true | Assignment active status |
| created_at | timestamptz | YES | now() | Record creation timestamp |
| updated_at | timestamptz | YES | now() | Record update timestamp |
| last_event_id | uuid | YES | - | Last domain event that modified this record |

## Constraints

| Constraint | Type | Definition |
|-----------|------|------------|
| `schedule_user_assignments_projection_pkey` | PRIMARY KEY | `(id)` |
| `schedule_user_assignments_unique` | UNIQUE | `(schedule_template_id, user_id)` |
| `schedule_user_assignments_projection_template_id_fkey` | FOREIGN KEY | `schedule_template_id -> schedule_templates_projection(id) ON DELETE CASCADE` |
| `schedule_user_assignments_projection_user_id_fkey` | FOREIGN KEY | `user_id -> users(id) ON DELETE CASCADE` |
| `schedule_user_assignments_projection_organization_id_fkey` | FOREIGN KEY | `organization_id -> organizations_projection(id)` |

## Indexes

| Index | Definition |
|-------|-----------|
| `schedule_user_assignments_projection_pkey` | `UNIQUE (id)` |
| `idx_schedule_assignments_template` | `(schedule_template_id) WHERE is_active = true` |
| `idx_schedule_assignments_user` | `(user_id) WHERE is_active = true` |

## RLS Policies

| Policy | Command | Condition |
|--------|---------|-----------|
| `schedule_user_assignments_select` | SELECT | `organization_id = get_current_org_id()` |
| `schedule_user_assignments_modify` | ALL | `organization_id = get_current_org_id()` |

## API RPCs

| Function | Purpose | Event Emitted |
|----------|---------|--------------|
| `api.assign_user_to_schedule(p_template_id, p_user_id, p_effective_from, p_effective_until)` | Assign user to template | `schedule.user_assigned` |
| `api.unassign_user_from_schedule(p_template_id, p_user_id, p_reason)` | Remove user from template | `schedule.user_unassigned` |

## Domain Events

- `schedule.user_assigned` — User assigned to template (stream_type: `schedule`)
- `schedule.user_unassigned` — User removed from template

## See Also

- [schedule_templates_projection](./schedule_templates_projection.md) — Parent template table
- [users](./users.md) — Assigned staff member
- [organizations_projection](./organizations_projection.md) — Owning organization
- [user_schedule_policies_projection](./user_schedule_policies_projection.md) — Old table (dropped)

## Related Documentation

- [event-handler-pattern.md](../../../infrastructure/patterns/event-handler-pattern.md) — Schedule event router
- [schedule-management.md](../../../../frontend/reference/schedule-management.md) — Frontend reference
