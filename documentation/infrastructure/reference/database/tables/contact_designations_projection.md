---
status: current
last_updated: 2026-03-28
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection linking contacts to 12 clinical/administrative designations within an organization — 4NF contact-designation model with UNIQUE constraint preventing duplicate assignments.

**When to read**:
- Assigning clinical contacts (clinician, therapist, psychiatrist) to clients
- Querying all contacts with a specific designation in an organization
- Understanding the contact-designation 4NF data model

**Prerequisites**: [contacts_projection](./contacts_projection.md), [organizations_projection](./organizations_projection.md)

**Key topics**: `contact-designation`, `clinical-contact`, `designation`, `4nf`, `contact-assignment`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# contact_designations_projection

## Overview

CQRS projection that links contacts to clinical and administrative designations within an organization. Uses a 4NF model (Decision 13) where a contact can hold multiple designations and a designation can belong to multiple contacts. The 12 designations are fixed — orgs cannot add custom designations (Decision 14), but can rename display labels via `configurable_label` in `client_field_definitions_projection`.

Key characteristics:
- **12 fixed designations**: 4 clinical, 2 administrative, 6 external
- **Multi-designation**: A contact can be both "clinician" and "therapist" in the same org
- **UNIQUE constraint**: `(contact_id, designation, organization_id)` prevents duplicates
- **Event-sourced**: Routed through `process_contact_event()` (contact.designation.created/deactivated)
- **Permission**: `client.update` (reuses existing permission, Decision 17)

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| contact_id | uuid | NO | - | FK to contacts_projection |
| designation | text | NO | - | CHECK-constrained designation type |
| organization_id | uuid | NO | - | FK to organizations_projection |
| is_active | boolean | NO | true | Soft-delete flag |
| created_at | timestamptz | NO | now() | Record creation timestamp |
| updated_at | timestamptz | YES | - | Last update timestamp |
| last_event_id | uuid | YES | - | Last domain event that modified this row |

## Designation Values

| Category | Designation | Description |
|----------|------------|-------------|
| Clinical | `clinician` | Primary clinical contact |
| Clinical | `therapist` | Therapist or counselor |
| Clinical | `psychiatrist` | Psychiatrist |
| Clinical | `behavioral_analyst` | Board-certified behavior analyst |
| Administrative | `case_worker` | Internal case worker |
| Administrative | `program_manager` | Program manager |
| External | `guardian` | Legal guardian |
| External | `emergency_contact` | Emergency contact person |
| External | `primary_care_physician` | Primary care physician |
| External | `prescriber` | Prescribing physician |
| External | `probation_officer` | Probation/parole officer |
| External | `caseworker` | External agency caseworker |

## Constraints

| Constraint | Type | Definition |
|-----------|------|------------|
| `contact_designations_projection_pkey` | PRIMARY KEY | `(id)` |
| `contact_designations_designation_check` | CHECK | `designation IN (12 values listed above)` |
| `contact_designations_unique` | UNIQUE | `(contact_id, designation, organization_id)` |
| `contact_designations_projection_contact_id_fkey` | FOREIGN KEY | `contact_id -> contacts_projection(id)` |
| `contact_designations_projection_organization_id_fkey` | FOREIGN KEY | `organization_id -> organizations_projection(id)` |

## Indexes

| Index | Definition |
|-------|-----------|
| `contact_designations_projection_pkey` | `UNIQUE (id)` |
| `idx_contact_designations_contact` | `(contact_id) WHERE is_active = true` |
| `idx_contact_designations_org` | `(organization_id) WHERE is_active = true` |
| `idx_contact_designations_org_designation` | `(organization_id, designation) WHERE is_active = true` |

## RLS Policies

| Policy | Command | Condition |
|--------|---------|-----------|
| `contact_designations_select` | SELECT | `organization_id = get_current_org_id()` |
| `contact_designations_platform_admin` | ALL | `has_platform_privilege()` |

## Domain Events

> **Note**: Event handlers will be created in the Client Intake project. The table exists ahead of the event infrastructure.

- `contact.designation.created` — Designation assigned (stream_type: `contact`)
- `contact.designation.deactivated` — Designation removed

## Migration History

| Date | Migration | Changes |
|------|-----------|---------|
| 2026-03-27 | `20260327210838_contact_designations_projection.sql` | Initial creation: 12-value CHECK, UNIQUE constraint, 3 partial indexes, RLS |

## See Also

- [contacts_projection](./contacts_projection.md) — Parent contact records
- [clients_projection](./clients_projection.md) — Client records assigned to designated contacts
- [client_field_definitions_projection](./client_field_definitions_projection.md) — Configurable labels for designation display names
- [organizations_projection](./organizations_projection.md) — Org-scoped isolation

## Related Documentation

- [Client Data Model](../../../../documentation/architecture/data/client-data-model.md) — Architecture overview
- [Event Handler Pattern](../../../patterns/event-handler-pattern.md) — Event processing architecture
