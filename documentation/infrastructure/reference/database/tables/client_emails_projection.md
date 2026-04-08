---
status: current
last_updated: 2026-04-08
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection for client email addresses — supports multiple emails per client with type classification (personal/work/school/other) and a primary flag.

**When to read**:
- Building client contact information UI (email display, add/edit/remove)
- Understanding the email data model and constraint semantics
- Querying active email addresses for a client
- Implementing email CRUD operations via API RPCs

**Prerequisites**: [clients_projection](./clients_projection.md), [organizations_projection](./organizations_projection.md)

**Key topics**: `client`, `email`, `contact-info`, `cqrs-projection`, `sub-entity`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# client_emails_projection

## Overview

CQRS projection table storing email addresses owned by a client record. Each row represents a single email address for a client within an organization. The source of truth is `client.email.*` events in the `domain_events` table, processed by the `process_client_event()` router.

Key characteristics:
- **Multiple emails per client**: No limit on email count; uniqueness enforced on `(client_id, email)`
- **Type classification**: Four email types — `personal`, `work`, `school`, `other`
- **Primary flag**: `is_primary` designates the preferred email address
- **Soft removal**: Emails are deactivated (`is_active = false`) rather than deleted
- **Required permission**: `client.update` for all write operations

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| client_id | uuid | NO | - | FK to clients_projection |
| organization_id | uuid | NO | - | FK to organizations_projection (for RLS scoping) |
| email | text | NO | - | Email address |
| email_type | text | NO | 'personal' | Classification: `personal`, `work`, `school`, `other` |
| is_primary | boolean | NO | false | Whether this is the client's primary email |
| is_active | boolean | NO | true | False when email has been removed |
| created_at | timestamptz | NO | now() | Record creation timestamp |
| updated_at | timestamptz | YES | - | Record update timestamp (NULL until first update) |
| last_event_id | uuid | YES | - | Last domain event that modified this row |

## Constraints

| Constraint | Type | Definition |
|-----------|------|------------|
| `client_emails_projection_pkey` | PRIMARY KEY | `(id)` |
| `client_emails_type_check` | CHECK | `email_type IN ('personal', 'work', 'school', 'other')` |
| `client_emails_unique` | UNIQUE | `(client_id, email)` |
| `client_emails_projection_client_id_fkey` | FOREIGN KEY | `client_id -> clients_projection(id)` |
| `client_emails_projection_organization_id_fkey` | FOREIGN KEY | `organization_id -> organizations_projection(id)` |

## Indexes

| Index | Definition |
|-------|-----------|
| `client_emails_projection_pkey` | `UNIQUE (id)` |
| `idx_client_emails_client` | `(client_id) WHERE is_active = true` |
| `idx_client_emails_org` | `(organization_id) WHERE is_active = true` |

Both non-primary indexes are partial — they only index active emails, keeping index size small and lookups fast for the common case.

## RLS Policies

| Policy | Command | Condition |
|--------|---------|-----------|
| `client_emails_select` | SELECT | `organization_id = get_current_org_id()` |
| `client_emails_platform_admin` | ALL | `has_platform_privilege()` |

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
| `client.email.added` | `handle_client_email_added()` | INSERT new row with `is_active = true` |
| `client.email.updated` | `handle_client_email_updated()` | UPDATE `email_type`, `is_primary`, `updated_at`, `last_event_id` |
| `client.email.removed` | `handle_client_email_removed()` | UPDATE `is_active = false`, `updated_at`, `last_event_id` |

## API Functions

All client email operations require the `client.update` permission.

| Function | Operation | Description |
|----------|-----------|-------------|
| `api.add_client_email(p_client_id, p_email, p_email_type, p_is_primary, p_event_metadata)` | INSERT | Emits `client.email.added`; returns new email row |
| `api.update_client_email(p_email_id, p_email_type, p_is_primary, p_event_metadata)` | UPDATE | Emits `client.email.updated`; returns updated email row |
| `api.remove_client_email(p_email_id, p_event_metadata)` | DEACTIVATE | Emits `client.email.removed`; sets `is_active = false` |

## Migration History

| Date | Migration | Changes |
|------|-----------|---------|
| 2026-04-06 | `20260406221732_client_contact_tables.sql` | Initial creation: 10 columns, 2 partial indexes, RLS, FKs |

## See Also

- [clients_projection](./clients_projection.md) — Parent client record
- [client_phones_projection](./client_phones_projection.md) — Client phone numbers (same pattern)
- [client_addresses_projection](./client_addresses_projection.md) — Client addresses (same pattern)
- [client_contact_assignments_projection](./client_contact_assignments_projection.md) — Clinical/admin contacts assigned to a client
- [organizations_projection](./organizations_projection.md) — Parent organization

## Related Documentation

- [Event Handler Pattern](../../../patterns/event-handler-pattern.md) — Event processing architecture
- [Event Sourcing Overview](../../../../architecture/data/event-sourcing-overview.md) — CQRS pattern
