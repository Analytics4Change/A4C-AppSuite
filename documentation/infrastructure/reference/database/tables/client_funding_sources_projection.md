---
status: current
last_updated: 2026-04-08
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection for client funding sources — org-defined funding arrangements with flexible source_type (no CHECK constraint), date-bounded coverage periods, and a JSONB custom_fields column for non-standard attributes.

**When to read**:
- Building client funding source UI (add/edit/remove funding sources)
- Understanding why source_type has no CHECK constraint (org-defined values)
- Understanding the relationship between funding sources and insurance policies
- Implementing funding source CRUD operations via API RPCs

**Prerequisites**: [clients_projection](./clients_projection.md), [organizations_projection](./organizations_projection.md)

**Key topics**: `client`, `funding`, `funding-source`, `custom-fields`, `cqrs-projection`, `sub-entity`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# client_funding_sources_projection

## Overview

CQRS projection table storing external funding source records for a client. Each row represents a single funding arrangement (state agency contract, grant, county program, etc.) associated with a client within an organization. The source of truth is `client.funding_source.*` events in the `domain_events` table, processed by the `process_client_event()` router.

Key characteristics:
- **Org-defined source types**: Unlike `client_insurance_policies_projection`, the `source_type` column has no CHECK constraint — each organization defines its own funding source taxonomy
- **Replaces "state payer" on insurance**: Funding sources were introduced (Decision 76) to cleanly separate government/agency funding from commercial insurance, instead of overloading the insurance policy type enum
- **Dynamic multi-instance**: An org admin defines funding source slots via `client_field_definitions_projection`; staff adds corresponding rows at intake
- **JSONB custom fields**: `custom_fields` supports non-standard attributes per funding source row (Decision 77)
- **Soft removal**: Funding sources are deactivated (`is_active = false`) rather than deleted
- **Required permission**: `client.update` for all write operations

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| client_id | uuid | NO | - | FK to clients_projection |
| organization_id | uuid | NO | - | FK to organizations_projection (for RLS scoping) |
| source_type | text | NO | - | Funding source category (org-defined, no CHECK constraint) |
| source_name | text | NO | - | Display name of the funding source or program |
| reference_number | text | YES | - | Case number, contract number, or external identifier |
| start_date | date | YES | - | Date funding begins |
| end_date | date | YES | - | Date funding ends (NULL = ongoing) |
| custom_fields | jsonb | NO | `{}` | Non-standard attributes for this funding source row (Decision 77) |
| is_active | boolean | NO | true | False when funding source has been removed |
| created_at | timestamptz | NO | now() | Record creation timestamp |
| updated_at | timestamptz | YES | - | Record update timestamp (NULL until first update) |
| last_event_id | uuid | YES | - | Last domain event that modified this row |

### custom_fields (JSONB)

Org-defined, non-standard attributes that apply to a specific funding source entry. The schema is not enforced at the database level; the field definitions registry (`client_field_definitions_projection`) governs which keys are valid for each funding source type within an organization.

Example:
```json
{
  "case_manager_name": "Jane Smith",
  "authorization_number": "AUTH-2026-00142",
  "max_reimbursable_days": 90
}
```

## Constraints

| Constraint | Type | Definition |
|-----------|------|------------|
| `client_funding_sources_projection_pkey` | PRIMARY KEY | `(id)` |
| `client_funding_sources_projection_client_id_fkey` | FOREIGN KEY | `client_id -> clients_projection(id)` |
| `client_funding_sources_projection_organization_id_fkey` | FOREIGN KEY | `organization_id -> organizations_projection(id)` |

No UNIQUE constraint on `(client_id, source_type)` — a client may have multiple active funding sources of the same type (e.g., two separate state agency contracts).

## Indexes

| Index | Definition |
|-------|-----------|
| `client_funding_sources_projection_pkey` | `UNIQUE (id)` |
| `idx_client_funding_client` | `(client_id) WHERE is_active = true` |
| `idx_client_funding_org` | `(organization_id) WHERE is_active = true` |

Both non-primary indexes are partial — they only index active funding sources.

## RLS Policies

| Policy | Command | Condition |
|--------|---------|-----------|
| `client_funding_select` | SELECT | `organization_id = get_current_org_id()` |
| `client_funding_platform_admin` | ALL | `has_platform_privilege()` |

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
| `client.funding_source.added` | `handle_client_funding_source_added()` | INSERT new row with `is_active = true` |
| `client.funding_source.updated` | `handle_client_funding_source_updated()` | UPDATE funding source fields, `updated_at`, `last_event_id` |
| `client.funding_source.removed` | `handle_client_funding_source_removed()` | UPDATE `is_active = false`, `updated_at`, `last_event_id` |

## API Functions

All client funding source operations require the `client.update` permission.

| Function | Operation | Description |
|----------|-----------|-------------|
| `api.add_client_funding_source(p_client_id, p_source_type, p_source_name, p_reference_number, p_start_date, p_end_date, p_custom_fields, p_event_metadata)` | INSERT | Emits `client.funding_source.added`; returns new funding source row |
| `api.update_client_funding_source(p_funding_source_id, p_source_name, p_reference_number, p_start_date, p_end_date, p_custom_fields, p_event_metadata)` | UPDATE | Emits `client.funding_source.updated`; returns updated funding source row |
| `api.remove_client_funding_source(p_funding_source_id, p_event_metadata)` | DEACTIVATE | Emits `client.funding_source.removed`; sets `is_active = false` |

## Design Decisions

**Decision 76 — Funding sources separate from insurance**: The original insurance table had an implicit "state payer" concept embedded in its policy type values. Decision 76 replaced this by creating a dedicated funding sources table with an org-controlled `source_type` vocabulary. This cleanly separates commercial/government insurance (which has standardized enrollment and billing workflows) from agency contracts and grants (which are highly org-specific and may have unique fields).

**Decision 77 — Per-row JSONB custom fields**: Each funding source row carries its own `custom_fields` JSONB column to support attributes that vary by source type. The field definitions registry governs the valid schema per source type per organization, while the database enforces only that the column is non-null (defaulting to `{}`).

## Migration History

| Date | Migration | Changes |
|------|-----------|---------|
| 2026-04-06 | `20260406221738_client_insurance_placement_tables.sql` | Initial creation: 13 columns, 2 partial indexes, RLS, FKs |

## See Also

- [clients_projection](./clients_projection.md) — Parent client record
- [client_insurance_policies_projection](./client_insurance_policies_projection.md) — Commercial and government insurance policies (complement to funding sources)
- [client_field_definitions_projection](./client_field_definitions_projection.md) — Field definitions that govern funding source custom_fields schema per org
- [client_placement_history_projection](./client_placement_history_projection.md) — Placement trajectory records
- [organizations_projection](./organizations_projection.md) — Parent organization

## Related Documentation

- [Event Handler Pattern](../../../patterns/event-handler-pattern.md) — Event processing architecture
- [Event Sourcing Overview](../../../../architecture/data/event-sourcing-overview.md) — CQRS pattern
