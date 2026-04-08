---
status: current
last_updated: 2026-04-08
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection for client placement history — a temporal log of where a client has lived during treatment, using 13 SAMHSA/Medicaid placement types with date ranges and a partial unique index ensuring only one current placement per client.

**When to read**:
- Building placement history UI (current placement display, placement change workflow)
- Understanding the is_current enforcement via partial unique index
- Querying placement trajectory for reporting or billing
- Implementing placement change and end operations via API RPCs

**Prerequisites**: [clients_projection](./clients_projection.md), [organizations_projection](./organizations_projection.md)

**Key topics**: `client`, `placement`, `placement-history`, `samhsa`, `medicaid`, `trajectory`, `cqrs-projection`, `sub-entity`

**Estimated read time**: 6 minutes
<!-- TL;DR-END -->

# client_placement_history_projection

## Overview

CQRS projection table storing the full placement trajectory of a client — where they were living during each period of treatment. Each row represents a date-bounded placement record. The source of truth is `client.placement.*` events in the `domain_events` table, processed by the `process_client_event()` router.

Key characteristics:
- **Temporal log**: Multiple rows per client, each covering a date range — this is history, not just the current state
- **One current placement**: A partial UNIQUE index on `(client_id) WHERE is_current = true` enforces that only one row can be the active placement at any time
- **Denormalization on change**: When a placement changes, the handler also updates `clients_projection.placement_arrangement` to the new value (denormalized for fast querying)
- **13 SAMHSA placement types**: Standard Medicaid/SAMHSA vocabulary for placement arrangement (Decision 83)
- **Required permission**: `client.update` for all write operations

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| client_id | uuid | NO | - | FK to clients_projection |
| organization_id | uuid | NO | - | FK to organizations_projection (for RLS scoping) |
| placement_arrangement | text | NO | - | Current placement type (13 SAMHSA values, see below) |
| start_date | date | NO | - | Date this placement began |
| end_date | date | YES | - | Date this placement ended (NULL when is_current = true) |
| is_current | boolean | NO | true | Whether this is the client's active placement |
| reason | text | YES | - | Free-text reason for placement change |
| created_at | timestamptz | NO | now() | Record creation timestamp |
| updated_at | timestamptz | YES | - | Record update timestamp (NULL until first update) |
| last_event_id | uuid | YES | - | Last domain event that modified this row |

### placement_arrangement Values

These 13 values align with SAMHSA and state Medicaid standard placement taxonomy:

| Value | Description |
|-------|-------------|
| `residential_treatment` | Licensed residential treatment facility |
| `therapeutic_foster_care` | Therapeutic or treatment foster home |
| `group_home` | Community-based group home |
| `foster_care` | Standard foster care placement |
| `kinship_placement` | Placement with relative or kin |
| `adoptive_placement` | Pre-adoptive or adoptive home |
| `independent_living` | Semi-independent or transitional living |
| `home_based` | Living with family, receiving home-based services |
| `detention` | Juvenile detention facility |
| `secure_residential` | Secure residential treatment program |
| `hospital_inpatient` | Inpatient psychiatric or medical hospital |
| `shelter` | Emergency shelter placement |
| `other` | Placement not covered by other values |

## Constraints

| Constraint | Type | Definition |
|-----------|------|------------|
| `client_placement_history_projection_pkey` | PRIMARY KEY | `(id)` |
| `client_placement_arrangement_check` | CHECK | `placement_arrangement IN ('residential_treatment', 'therapeutic_foster_care', 'group_home', 'foster_care', 'kinship_placement', 'adoptive_placement', 'independent_living', 'home_based', 'detention', 'secure_residential', 'hospital_inpatient', 'shelter', 'other')` |
| `client_placement_history_projection_client_id_fkey` | FOREIGN KEY | `client_id -> clients_projection(id)` |
| `client_placement_history_projection_organization_id_fkey` | FOREIGN KEY | `organization_id -> organizations_projection(id)` |

## Indexes

| Index | Definition |
|-------|-----------|
| `client_placement_history_projection_pkey` | `UNIQUE (id)` |
| `idx_client_placement_current` | `UNIQUE (client_id) WHERE is_current = true` — enforces single current placement |
| `idx_client_placement_client` | `(client_id)` — full history lookup (no WHERE filter) |
| `idx_client_placement_org` | `(organization_id)` — org-level history queries |

The partial unique index `idx_client_placement_current` is the mechanism that enforces the business rule: at most one row per client may have `is_current = true`. The two non-unique indexes index all rows (not just active) because placement history reporting queries need the full timeline.

> **Note**: The UNIQUE constraint on `(client_id, start_date)` referenced in the architecture review (m7) is not present in the migration as implemented. The partial unique index on `is_current` is the primary enforcement mechanism.

## RLS Policies

| Policy | Command | Condition |
|--------|---------|-----------|
| `client_placement_select` | SELECT | `organization_id = get_current_org_id()` |
| `client_placement_platform_admin` | ALL | `has_platform_privilege()` |

No INSERT/UPDATE/DELETE policies for `authenticated` — this is a CQRS projection. Writes come from event handlers running as `service_role` (bypasses RLS). Permission checks (`client.update`) are enforced at the API RPC layer.

## Foreign Keys

| Column | References | Notes |
|--------|-----------|-------|
| `client_id` | `clients_projection(id)` | Owning client record |
| `organization_id` | `organizations_projection(id)` | Tenant scope for RLS |

## Domain Events

All writes to this table are driven by events with `stream_type: 'client'`, routed through `process_client_event()` to individual handlers in `infrastructure/supabase/handlers/client/`.

| Event Type | Handler | Effect |
|-----------|---------|--------|
| `client.placement.changed` | `handle_client_placement_changed()` | (1) UPDATE previous current row: `is_current = false`, `end_date = new start_date - 1`. (2) INSERT new row with `is_current = true`. (3) UPDATE `clients_projection.placement_arrangement` to new value. |
| `client.placement.ended` | `handle_client_placement_ended()` | UPDATE current row: `is_current = false`, `end_date = event date`, `updated_at`, `last_event_id`. Also clears `clients_projection.placement_arrangement`. |

## API Functions

All placement operations require the `client.update` permission.

| Function | Operation | Description |
|----------|-----------|-------------|
| `api.change_client_placement(p_client_id, p_placement_arrangement, p_start_date, p_reason, p_event_metadata)` | TRANSITION | Emits `client.placement.changed`; closes prior placement and opens new one |
| `api.end_client_placement(p_client_id, p_end_date, p_reason, p_event_metadata)` | CLOSE | Emits `client.placement.ended`; closes current placement without opening a new one |

## Design Decisions

**Decision 83 — Placement trajectory with date ranges**: Rather than storing only the current placement on the client record, all placements are tracked historically with start and end dates. This supports Medicaid billing (placement is often a billing factor), regulatory reporting (SAMHSA NOMS), and clinical documentation. The denormalized `clients_projection.placement_arrangement` column provides the current value for fast display without requiring a join.

## Migration History

| Date | Migration | Changes |
|------|-----------|---------|
| 2026-04-06 | `20260406221738_client_insurance_placement_tables.sql` | Initial creation: 11 columns, 1 partial unique index, 2 full indexes, RLS, FKs |

## See Also

- [clients_projection](./clients_projection.md) — Parent client record (holds denormalized `placement_arrangement`)
- [client_insurance_policies_projection](./client_insurance_policies_projection.md) — Insurance coverage (often correlated with placement type)
- [client_funding_sources_projection](./client_funding_sources_projection.md) — External funding sources
- [organizations_projection](./organizations_projection.md) — Parent organization

## Related Documentation

- [Event Handler Pattern](../../../patterns/event-handler-pattern.md) — Event processing architecture
- [Event Sourcing Overview](../../../../architecture/data/event-sourcing-overview.md) — CQRS pattern
