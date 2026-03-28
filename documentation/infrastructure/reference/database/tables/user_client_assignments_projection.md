---
status: current
last_updated: 2026-03-28
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection for client-staff assignment mappings. Tracks which clients are assigned to which staff members within an organization. Unique constraint on `(user_id, client_id)` with upsert semantics — re-assigning reactivates. FK to `clients_projection` added 2026-03-27. Controlled by `enable_staff_client_mapping` feature flag in `organizations_projection.direct_care_settings`.

**When to read**:
- Building client assignment / caseload management UI
- Understanding assignment upsert behavior
- Querying active assignments by user or client
- Understanding the feature flag gating pattern

**Prerequisites**: [users](./users.md), [organizations_projection](./organizations_projection.md)

**Key topics**: `assignment`, `client-assignment`, `caseload`, `feature-flag`, `direct-care-settings`, `cqrs-projection`

**Estimated read time**: 8 minutes
<!-- TL;DR-END -->

# user_client_assignments_projection

## Overview

CQRS projection table that maps clients to staff members within an organization. Each record represents a client-staff assignment with optional expiration and notes. The source of truth is `user.client.*` events in the `domain_events` table.

Key characteristics:
- **Unique per user/client pair**: `UNIQUE (user_id, client_id)` — re-assigning uses `ON CONFLICT DO UPDATE` to reactivate
- **No FK to clients**: `client_id` is a UUID with no foreign key constraint (client domain not yet rebuilt with event-driven architecture)
- **Feature flag gated**: UI shows amber banner when `organizations_projection.direct_care_settings.enable_staff_client_mapping` is `false`
- **Permission gated**: Requires `user.client_assign` permission

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| user_id | uuid | NO | - | FK to `users(id)` — the staff member |
| client_id | uuid | NO | - | FK to `clients_projection(id)` — the client being assigned |
| organization_id | uuid | NO | - | FK to `organizations_projection(id)` — owning org |
| assigned_at | timestamptz | YES | now() | When the assignment was created |
| assigned_until | timestamptz | YES | - | Optional expiration (null = indefinite) |
| is_active | boolean | YES | true | Active status |
| assigned_by | uuid | YES | - | User who created the assignment |
| notes | text | YES | - | Optional assignment notes |
| created_at | timestamptz | YES | now() | Record creation timestamp |
| updated_at | timestamptz | YES | now() | Record update timestamp |
| last_event_id | uuid | YES | - | Last domain event that modified this record |

## Constraints

| Constraint | Type | Definition |
|-----------|------|------------|
| `user_client_assignments_projection_pkey` | PRIMARY KEY | `(id)` |
| `user_client_assignments_unique` | UNIQUE | `(user_id, client_id)` |
| `user_client_assignments_projection_user_id_fkey` | FOREIGN KEY | `user_id → users(id)` |
| `user_client_assignments_projection_organization_id_fkey` | FOREIGN KEY | `organization_id → organizations_projection(id)` |
| `user_client_assignments_projection_client_id_fkey` | FOREIGN KEY | `client_id → clients_projection(id)` |

## Indexes

| Index | Definition |
|-------|-----------|
| `user_client_assignments_projection_pkey` | `UNIQUE (id)` |
| `user_client_assignments_unique` | `UNIQUE (user_id, client_id)` |
| `idx_user_client_assignments_user` | `(user_id, assigned_until) WHERE is_active = true` |
| `idx_user_client_assignments_client` | `(client_id, assigned_until) WHERE is_active = true` |
| `idx_user_client_assignments_org` | `(organization_id) WHERE is_active = true` |

## RLS Policies

| Policy | Command | Condition |
|--------|---------|-----------|
| `user_client_assignments_select` | SELECT | `organization_id = get_current_org_id()` |
| `user_client_assignments_modify` | ALL | `has_effective_permission('user.client_assign', org.path)` |

## API RPCs

| Function | Purpose | Event Emitted |
|----------|---------|--------------|
| `api.assign_client_to_user()` | Create or reactivate assignment | `user.client.assigned` |
| `api.unassign_client_from_user()` | Deactivate assignment | `user.client.unassigned` |
| `api.list_user_client_assignments()` | Query with user name/email joins | — |

## Domain Events

- `user.client.assigned` — Client assigned to staff member (or reactivated)
- `user.client.unassigned` — Assignment deactivated

## Feature Flag

The client assignment UI is gated by `organizations_projection.direct_care_settings.enable_staff_client_mapping`:
- When `false` (default): Assignment pages show an amber informational banner but remain fully functional for data entry
- When `true`: Assignments affect notification routing (future feature)
- Toggle location: Organization Settings page (`/settings/organization`)

## See Also

- [clients_projection](./clients_projection.md) — Client records (FK target)
- [organizations_projection](./organizations_projection.md) — Parent organization + feature flag
- [users](./users.md) — Staff member reference
