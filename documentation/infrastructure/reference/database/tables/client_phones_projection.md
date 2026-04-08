---
status: current
last_updated: 2026-04-08
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection for client phone numbers — supports multiple phones per client with type classification (mobile/home/work/fax/other) and a primary flag.

**When to read**:
- Building client contact information UI (phone display, add/edit/remove)
- Understanding the phone data model and constraint semantics
- Querying active phone numbers for a client
- Implementing phone CRUD operations via API RPCs

**Prerequisites**: [clients_projection](./clients_projection.md), [organizations_projection](./organizations_projection.md)

**Key topics**: `client`, `phone`, `contact-info`, `cqrs-projection`, `sub-entity`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# client_phones_projection

## Overview

CQRS projection table storing phone numbers owned by a client record. Each row represents a single phone number for a client within an organization. The source of truth is `client.phone.*` events in the `domain_events` table, processed by the `process_client_event()` router.

Key characteristics:
- **Multiple phones per client**: No limit on phone count; uniqueness enforced on `(client_id, phone_number)`
- **Type classification**: Five phone types — `mobile`, `home`, `work`, `fax`, `other`
- **Primary flag**: `is_primary` designates the preferred contact number
- **Soft removal**: Phones are deactivated (`is_active = false`) rather than deleted
- **Required permission**: `client.update` for all write operations

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| client_id | uuid | NO | - | FK to clients_projection |
| organization_id | uuid | NO | - | FK to organizations_projection (for RLS scoping) |
| phone_number | text | NO | - | Phone number string (format determined by org) |
| phone_type | text | NO | 'mobile' | Classification: `mobile`, `home`, `work`, `fax`, `other` |
| is_primary | boolean | NO | false | Whether this is the client's primary phone |
| is_active | boolean | NO | true | False when phone has been removed |
| created_at | timestamptz | NO | now() | Record creation timestamp |
| updated_at | timestamptz | YES | - | Record update timestamp (NULL until first update) |
| last_event_id | uuid | YES | - | Last domain event that modified this row |

## Constraints

| Constraint | Type | Definition |
|-----------|------|------------|
| `client_phones_projection_pkey` | PRIMARY KEY | `(id)` |
| `client_phones_type_check` | CHECK | `phone_type IN ('mobile', 'home', 'work', 'fax', 'other')` |
| `client_phones_unique` | UNIQUE | `(client_id, phone_number)` |
| `client_phones_projection_client_id_fkey` | FOREIGN KEY | `client_id -> clients_projection(id)` |
| `client_phones_projection_organization_id_fkey` | FOREIGN KEY | `organization_id -> organizations_projection(id)` |

## Indexes

| Index | Definition |
|-------|-----------|
| `client_phones_projection_pkey` | `UNIQUE (id)` |
| `idx_client_phones_client` | `(client_id) WHERE is_active = true` |
| `idx_client_phones_org` | `(organization_id) WHERE is_active = true` |

Both non-primary indexes are partial — they only index active phones, keeping index size small and lookups fast for the common case.

## RLS Policies

| Policy | Command | Condition |
|--------|---------|-----------|
| `client_phones_select` | SELECT | `organization_id = get_current_org_id()` |
| `client_phones_platform_admin` | ALL | `has_platform_privilege()` |

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
| `client.phone.added` | `handle_client_phone_added()` | INSERT new row with `is_active = true` |
| `client.phone.updated` | `handle_client_phone_updated()` | UPDATE `phone_type`, `is_primary`, `updated_at`, `last_event_id` |
| `client.phone.removed` | `handle_client_phone_removed()` | UPDATE `is_active = false`, `updated_at`, `last_event_id` |

## API Functions

All client phone operations require the `client.update` permission.

| Function | Operation | Description |
|----------|-----------|-------------|
| `api.add_client_phone(p_client_id, p_phone_number, p_phone_type, p_is_primary, p_event_metadata)` | INSERT | Emits `client.phone.added`; returns new phone row |
| `api.update_client_phone(p_phone_id, p_phone_type, p_is_primary, p_event_metadata)` | UPDATE | Emits `client.phone.updated`; returns updated phone row |
| `api.remove_client_phone(p_phone_id, p_event_metadata)` | DEACTIVATE | Emits `client.phone.removed`; sets `is_active = false` |

## Migration History

| Date | Migration | Changes |
|------|-----------|---------|
| 2026-04-06 | `20260406221732_client_contact_tables.sql` | Initial creation: 10 columns, 2 partial indexes, RLS, FKs |

## See Also

- [clients_projection](./clients_projection.md) — Parent client record
- [client_emails_projection](./client_emails_projection.md) — Client email addresses (same pattern)
- [client_addresses_projection](./client_addresses_projection.md) — Client addresses (same pattern)
- [client_contact_assignments_projection](./client_contact_assignments_projection.md) — Clinical/admin contacts assigned to a client
- [organizations_projection](./organizations_projection.md) — Parent organization

## Related Documentation

- [Event Handler Pattern](../../../patterns/event-handler-pattern.md) — Event processing architecture
- [Event Sourcing Overview](../../../../architecture/data/event-sourcing-overview.md) — CQRS pattern
