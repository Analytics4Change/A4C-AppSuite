---
status: current
last_updated: 2026-04-08
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection that is a 4NF junction table linking clients to contacts with a clinical/administrative designation — each row is an atomic fact: client X has contact Y serving role Z.

**When to read**:
- Building client care team UI (assign/unassign clinicians, guardians, contacts)
- Understanding the 12-value designation enum and its semantics
- Querying all contacts assigned to a client, or all clients assigned to a contact
- Implementing contact assignment operations via API RPCs

**Prerequisites**: [clients_projection](./clients_projection.md), [contacts_projection](./contacts_projection.md), [organizations_projection](./organizations_projection.md)

**Key topics**: `client`, `contact`, `assignment`, `designation`, `care-team`, `junction-table`, `cqrs-projection`, `sub-entity`

**Estimated read time**: 6 minutes
<!-- TL;DR-END -->

# client_contact_assignments_projection

## Overview

CQRS projection table implementing a 4NF junction between clients and contacts, qualified by a clinical or administrative designation. Each row represents the atomic fact that a specific contact serves in a specific role for a specific client within an organization. The source of truth is `client.contact.*` events in the `domain_events` table, processed by the `process_client_event()` router.

Key characteristics:
- **4NF junction**: `(client_id, contact_id, designation)` is the natural key — the same contact can hold multiple designations for the same client (e.g., a person who is both `guardian` and `emergency_contact`)
- **12 designation values**: Matches the `contact_designations_projection` reference table (Decisions 13, 16)
- **Soft deactivation**: Assignments are deactivated (`is_active = false`) rather than deleted, preserving history
- **Assigned timestamp**: `assigned_at` records when the assignment was created, independently of `created_at`
- **Required permission**: `client.update` for all write operations (Decision 17)

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| client_id | uuid | NO | - | FK to clients_projection |
| contact_id | uuid | NO | - | FK to contacts_projection |
| organization_id | uuid | NO | - | FK to organizations_projection (for RLS scoping) |
| designation | text | NO | - | Role the contact plays for this client (12 values, see below) |
| assigned_at | timestamptz | NO | now() | When this assignment was created |
| is_active | boolean | NO | true | False when assignment has been unassigned |
| created_at | timestamptz | NO | now() | Record creation timestamp |
| updated_at | timestamptz | YES | - | Record update timestamp (NULL until first update) |
| last_event_id | uuid | YES | - | Last domain event that modified this row |

### Designation Values

| Value | Category | Description |
|-------|----------|-------------|
| `clinician` | Clinical | Primary clinician (often the treatment lead) |
| `therapist` | Clinical | Individual or family therapist |
| `psychiatrist` | Clinical | Prescribing psychiatrist |
| `behavioral_analyst` | Clinical | Board-certified behavior analyst (BCBA) |
| `case_worker` | Clinical/Admin | Assigned case worker |
| `caseworker` | Clinical/Admin | Alternate spelling variant (both values exist) |
| `guardian` | Legal/Family | Legal guardian |
| `emergency_contact` | Family | Emergency contact person |
| `program_manager` | Administrative | Program or site manager |
| `primary_care_physician` | Medical | PCP for the client |
| `prescriber` | Medical | Non-psychiatrist prescriber |
| `probation_officer` | Legal | Probation or parole officer |

## Constraints

| Constraint | Type | Definition |
|-----------|------|------------|
| `client_contact_assignments_projection_pkey` | PRIMARY KEY | `(id)` |
| `client_contact_assignments_designation_check` | CHECK | `designation IN ('clinician', 'therapist', 'psychiatrist', 'behavioral_analyst', 'case_worker', 'guardian', 'emergency_contact', 'program_manager', 'primary_care_physician', 'prescriber', 'probation_officer', 'caseworker')` |
| `client_contact_assignments_unique` | UNIQUE | `(client_id, contact_id, designation)` |
| `client_contact_assignments_projection_client_id_fkey` | FOREIGN KEY | `client_id -> clients_projection(id)` |
| `client_contact_assignments_projection_contact_id_fkey` | FOREIGN KEY | `contact_id -> contacts_projection(id)` |
| `client_contact_assignments_projection_organization_id_fkey` | FOREIGN KEY | `organization_id -> organizations_projection(id)` |

## Indexes

| Index | Definition |
|-------|-----------|
| `client_contact_assignments_projection_pkey` | `UNIQUE (id)` |
| `idx_client_contact_assignments_client` | `(client_id) WHERE is_active = true` |
| `idx_client_contact_assignments_contact` | `(contact_id) WHERE is_active = true` |
| `idx_client_contact_assignments_org` | `(organization_id) WHERE is_active = true` |
| `idx_client_contact_assignments_org_designation` | `(organization_id, designation) WHERE is_active = true` |

All non-primary indexes are partial — they only index active assignments. The `org_designation` index supports queries like "list all clients that have a particular designation filled" for org-level reporting.

## RLS Policies

| Policy | Command | Condition |
|--------|---------|-----------|
| `client_contact_assignments_select` | SELECT | `organization_id = get_current_org_id()` |
| `client_contact_assignments_platform_admin` | ALL | `has_platform_privilege()` |

No INSERT/UPDATE/DELETE policies for `authenticated` — this is a CQRS projection. Writes come from event handlers running as `service_role` (bypasses RLS). Permission checks (`client.update`) are enforced at the API RPC layer.

## Foreign Keys

| Column | References | Notes |
|--------|-----------|-------|
| `client_id` | `clients_projection(id)` | Owning client record |
| `contact_id` | `contacts_projection(id)` | The assigned contact person |
| `organization_id` | `organizations_projection(id)` | Tenant scope for RLS |

## Domain Events

All writes to this table are driven by events with `stream_type: 'client'`, routed through `process_client_event()` to individual handlers in `infrastructure/supabase/handlers/client/`.

| Event Type | Handler | Effect |
|-----------|---------|--------|
| `client.contact.assigned` | `handle_client_contact_assigned()` | INSERT new row with `is_active = true` |
| `client.contact.unassigned` | `handle_client_contact_unassigned()` | UPDATE `is_active = false`, `updated_at`, `last_event_id` |

## API Functions

All contact assignment operations require the `client.update` permission.

| Function | Operation | Description |
|----------|-----------|-------------|
| `api.assign_client_contact(p_client_id, p_contact_id, p_designation, p_event_metadata)` | INSERT | Emits `client.contact.assigned`; returns new assignment row |
| `api.unassign_client_contact(p_assignment_id, p_event_metadata)` | DEACTIVATE | Emits `client.contact.unassigned`; sets `is_active = false` |

## Migration History

| Date | Migration | Changes |
|------|-----------|---------|
| 2026-04-06 | `20260406221732_client_contact_tables.sql` | Initial creation: 10 columns, 4 partial indexes, RLS, FKs to clients, contacts, and organizations |

## See Also

- [clients_projection](./clients_projection.md) — Parent client record
- [contacts_projection](./contacts_projection.md) — Contact persons that can be assigned
- [contact_designations_projection](./contact_designations_projection.md) — Reference table for designation values
- [client_phones_projection](./client_phones_projection.md) — Client-owned phone numbers
- [client_emails_projection](./client_emails_projection.md) — Client-owned email addresses
- [organizations_projection](./organizations_projection.md) — Parent organization

## Related Documentation

- [Event Handler Pattern](../../../patterns/event-handler-pattern.md) — Event processing architecture
- [Event Sourcing Overview](../../../../architecture/data/event-sourcing-overview.md) — CQRS pattern
