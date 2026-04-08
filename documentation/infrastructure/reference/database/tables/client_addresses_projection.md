---
status: current
last_updated: 2026-04-08
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection for client addresses — enforces one address per type (home/mailing/school/placement/other) per client with full USPS-style address fields and a primary flag.

**When to read**:
- Building client address UI (address display, add/edit/remove)
- Understanding the one-address-per-type constraint
- Querying active addresses for a client
- Implementing address CRUD operations via API RPCs

**Prerequisites**: [clients_projection](./clients_projection.md), [organizations_projection](./organizations_projection.md)

**Key topics**: `client`, `address`, `contact-info`, `cqrs-projection`, `sub-entity`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# client_addresses_projection

## Overview

CQRS projection table storing physical and mailing addresses owned by a client record. Each row represents a single address of a specific type for a client within an organization. The source of truth is `client.address.*` events in the `domain_events` table, processed by the `process_client_event()` router.

Key characteristics:
- **One address per type**: The UNIQUE constraint on `(client_id, address_type)` means each client can have at most one home address, one mailing address, etc.
- **Five address types**: `home`, `mailing`, `school`, `placement`, `other`
- **Primary flag**: `is_primary` designates the primary address for general correspondence
- **Soft removal**: Addresses are deactivated (`is_active = false`) rather than deleted
- **Country default**: Defaults to `'US'`; supports international addresses
- **Required permission**: `client.update` for all write operations

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| client_id | uuid | NO | - | FK to clients_projection |
| organization_id | uuid | NO | - | FK to organizations_projection (for RLS scoping) |
| address_type | text | NO | 'home' | Classification: `home`, `mailing`, `school`, `placement`, `other` |
| street1 | text | NO | - | Primary street address line |
| street2 | text | YES | - | Suite, unit, apartment number, etc. |
| city | text | NO | - | City name |
| state | text | NO | - | State code (e.g., `UT`, `CA`) |
| zip | text | NO | - | ZIP or postal code |
| country | text | NO | 'US' | ISO country code (default US) |
| is_primary | boolean | NO | false | Whether this is the client's primary address |
| is_active | boolean | NO | true | False when address has been removed |
| created_at | timestamptz | NO | now() | Record creation timestamp |
| updated_at | timestamptz | YES | - | Record update timestamp (NULL until first update) |
| last_event_id | uuid | YES | - | Last domain event that modified this row |

## Constraints

| Constraint | Type | Definition |
|-----------|------|------------|
| `client_addresses_projection_pkey` | PRIMARY KEY | `(id)` |
| `client_addresses_type_check` | CHECK | `address_type IN ('home', 'mailing', 'school', 'placement', 'other')` |
| `client_addresses_unique` | UNIQUE | `(client_id, address_type)` — one address per type per client |
| `client_addresses_projection_client_id_fkey` | FOREIGN KEY | `client_id -> clients_projection(id)` |
| `client_addresses_projection_organization_id_fkey` | FOREIGN KEY | `organization_id -> organizations_projection(id)` |

## Indexes

| Index | Definition |
|-------|-----------|
| `client_addresses_projection_pkey` | `UNIQUE (id)` |
| `idx_client_addresses_client` | `(client_id) WHERE is_active = true` |
| `idx_client_addresses_org` | `(organization_id) WHERE is_active = true` |

Both non-primary indexes are partial — they only index active addresses, keeping index size small and lookups fast for the common case.

## RLS Policies

| Policy | Command | Condition |
|--------|---------|-----------|
| `client_addresses_select` | SELECT | `organization_id = get_current_org_id()` |
| `client_addresses_platform_admin` | ALL | `has_platform_privilege()` |

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
| `client.address.added` | `handle_client_address_added()` | INSERT new row with `is_active = true` |
| `client.address.updated` | `handle_client_address_updated()` | UPDATE address fields, `updated_at`, `last_event_id` |
| `client.address.removed` | `handle_client_address_removed()` | UPDATE `is_active = false`, `updated_at`, `last_event_id` |

## API Functions

All client address operations require the `client.update` permission.

| Function | Operation | Description |
|----------|-----------|-------------|
| `api.add_client_address(p_client_id, p_address_type, p_street1, p_street2, p_city, p_state, p_zip, p_country, p_is_primary, p_event_metadata)` | INSERT | Emits `client.address.added`; returns new address row |
| `api.update_client_address(p_address_id, p_street1, p_street2, p_city, p_state, p_zip, p_country, p_is_primary, p_event_metadata)` | UPDATE | Emits `client.address.updated`; returns updated address row |
| `api.remove_client_address(p_address_id, p_event_metadata)` | DEACTIVATE | Emits `client.address.removed`; sets `is_active = false` |

## Migration History

| Date | Migration | Changes |
|------|-----------|---------|
| 2026-04-06 | `20260406221732_client_contact_tables.sql` | Initial creation: 15 columns, 2 partial indexes, RLS, FKs |

## See Also

- [clients_projection](./clients_projection.md) — Parent client record
- [client_phones_projection](./client_phones_projection.md) — Client phone numbers (same pattern)
- [client_emails_projection](./client_emails_projection.md) — Client email addresses (same pattern)
- [client_contact_assignments_projection](./client_contact_assignments_projection.md) — Clinical/admin contacts assigned to a client
- [organizations_projection](./organizations_projection.md) — Parent organization

## Related Documentation

- [Event Handler Pattern](../../../patterns/event-handler-pattern.md) — Event processing architecture
- [Event Sourcing Overview](../../../../architecture/data/event-sourcing-overview.md) — CQRS pattern
