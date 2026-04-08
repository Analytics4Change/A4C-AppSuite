---
status: current
last_updated: 2026-04-08
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection for client insurance policies — enforces one policy per type (primary/secondary/medicaid/medicare) per client, including Medicare as an explicit type per Decision 74.

**When to read**:
- Building client insurance UI (add/edit/remove policies)
- Understanding the one-policy-per-type constraint and the four policy type values
- Querying active insurance coverage for a client
- Implementing insurance CRUD operations via API RPCs

**Prerequisites**: [clients_projection](./clients_projection.md), [organizations_projection](./organizations_projection.md)

**Key topics**: `client`, `insurance`, `policy`, `medicaid`, `medicare`, `cqrs-projection`, `sub-entity`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# client_insurance_policies_projection

## Overview

CQRS projection table storing insurance policy records owned by a client. Each row represents a single insurance policy of a specific type for a client within an organization. The source of truth is `client.insurance.*` events in the `domain_events` table, processed by the `process_client_event()` router.

Key characteristics:
- **One policy per type**: The UNIQUE constraint on `(client_id, policy_type)` means each client can hold at most one primary, one secondary, one Medicaid, and one Medicare policy simultaneously
- **Four policy types**: `primary`, `secondary`, `medicaid`, `medicare` — Medicare is an explicit type rather than being grouped under Medicaid (Decision 74)
- **Subscriber information**: Captures subscriber name and relationship for policies held by a third party
- **Coverage dates**: Optional start and end date for tracking active coverage periods
- **Soft removal**: Policies are deactivated (`is_active = false`) rather than deleted
- **Required permission**: `client.update` for all write operations

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| client_id | uuid | NO | - | FK to clients_projection |
| organization_id | uuid | NO | - | FK to organizations_projection (for RLS scoping) |
| policy_type | text | NO | - | Classification: `primary`, `secondary`, `medicaid`, `medicare` |
| payer_name | text | NO | - | Insurance company or program name |
| policy_number | text | YES | - | Policy or member ID number |
| group_number | text | YES | - | Group number (typically for employer plans) |
| subscriber_name | text | YES | - | Name of the policy subscriber if different from client |
| subscriber_relation | text | YES | - | Relationship of subscriber to client (e.g., parent, guardian) |
| coverage_start_date | date | YES | - | Date coverage begins |
| coverage_end_date | date | YES | - | Date coverage ends (NULL = ongoing) |
| is_active | boolean | NO | true | False when policy has been removed |
| created_at | timestamptz | NO | now() | Record creation timestamp |
| updated_at | timestamptz | YES | - | Record update timestamp (NULL until first update) |
| last_event_id | uuid | YES | - | Last domain event that modified this row |

## Constraints

| Constraint | Type | Definition |
|-----------|------|------------|
| `client_insurance_policies_projection_pkey` | PRIMARY KEY | `(id)` |
| `client_insurance_policy_type_check` | CHECK | `policy_type IN ('primary', 'secondary', 'medicaid', 'medicare')` |
| `client_insurance_policies_unique` | UNIQUE | `(client_id, policy_type)` — one policy per type per client |
| `client_insurance_policies_projection_client_id_fkey` | FOREIGN KEY | `client_id -> clients_projection(id)` |
| `client_insurance_policies_projection_organization_id_fkey` | FOREIGN KEY | `organization_id -> organizations_projection(id)` |

## Indexes

| Index | Definition |
|-------|-----------|
| `client_insurance_policies_projection_pkey` | `UNIQUE (id)` |
| `idx_client_insurance_client` | `(client_id) WHERE is_active = true` |
| `idx_client_insurance_org` | `(organization_id) WHERE is_active = true` |

Both non-primary indexes are partial — they only index active policies.

## RLS Policies

| Policy | Command | Condition |
|--------|---------|-----------|
| `client_insurance_select` | SELECT | `organization_id = get_current_org_id()` |
| `client_insurance_platform_admin` | ALL | `has_platform_privilege()` |

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
| `client.insurance.added` | `handle_client_insurance_added()` | INSERT new row with `is_active = true` |
| `client.insurance.updated` | `handle_client_insurance_updated()` | UPDATE policy fields, `updated_at`, `last_event_id` |
| `client.insurance.removed` | `handle_client_insurance_removed()` | UPDATE `is_active = false`, `updated_at`, `last_event_id` |

## API Functions

All client insurance operations require the `client.update` permission.

| Function | Operation | Description |
|----------|-----------|-------------|
| `api.add_client_insurance(p_client_id, p_policy_type, p_payer_name, p_policy_number, p_group_number, p_subscriber_name, p_subscriber_relation, p_coverage_start_date, p_coverage_end_date, p_event_metadata)` | INSERT | Emits `client.insurance.added`; returns new policy row |
| `api.update_client_insurance(p_policy_id, p_payer_name, p_policy_number, p_group_number, p_subscriber_name, p_subscriber_relation, p_coverage_start_date, p_coverage_end_date, p_event_metadata)` | UPDATE | Emits `client.insurance.updated`; returns updated policy row |
| `api.remove_client_insurance(p_policy_id, p_event_metadata)` | DEACTIVATE | Emits `client.insurance.removed`; sets `is_active = false` |

## Design Decisions

**Decision 74 — Medicare as explicit policy type**: Medicare is listed as its own `policy_type` value rather than being grouped under Medicaid. In behavioral healthcare, clients frequently carry both Medicaid and Medicare (dual eligibility), and the billing workflows differ significantly between the two programs. An explicit type prevents confusion and allows both to coexist simultaneously on the same client record.

## Migration History

| Date | Migration | Changes |
|------|-----------|---------|
| 2026-04-06 | `20260406221738_client_insurance_placement_tables.sql` | Initial creation: 15 columns, 2 partial indexes, RLS, FKs |

## See Also

- [clients_projection](./clients_projection.md) — Parent client record (also holds `medicaid_id`, `medicare_id` identifiers)
- [client_funding_sources_projection](./client_funding_sources_projection.md) — Org-defined funding sources (complements insurance)
- [client_placement_history_projection](./client_placement_history_projection.md) — Placement trajectory records
- [organizations_projection](./organizations_projection.md) — Parent organization

## Related Documentation

- [Event Handler Pattern](../../../patterns/event-handler-pattern.md) — Event processing architecture
- [Event Sourcing Overview](../../../../architecture/data/event-sourcing-overview.md) — CQRS pattern
