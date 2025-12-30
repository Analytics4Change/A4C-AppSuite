---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Junction table linking organizations to contacts. Supports many-to-many relationship enabling contact sharing across organizations. Includes soft delete for CQRS event-driven architecture.

**When to read**:
- Understanding organization-contact data model
- Querying contacts for an organization
- Implementing contact association/disassociation
- Working with bootstrap workflow contact linkage

**Prerequisites**: [organizations_projection](./organizations_projection.md), [contacts_projection](./contacts_projection.md)

**Key topics**: `junction-table`, `many-to-many`, `organization-contacts`, `soft-delete`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# organization_contacts

## Overview

Junction table that establishes many-to-many relationships between organizations and contacts. Created during the organization bootstrap workflow when contacts are linked to organizations. Supports soft delete to maintain referential integrity while allowing logical removal.

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| organization_id | uuid | NO | - | Foreign key to organizations_projection |
| contact_id | uuid | NO | - | Foreign key to contacts_projection |
| deleted_at | timestamptz | YES | - | Soft delete timestamp (NULL = active) |

### Column Details

#### organization_id

- **Type**: `uuid`
- **Purpose**: Reference to the organization in the relationship
- **Foreign Key**: References `organizations_projection(id)`
- **Constraints**: NOT NULL, part of composite primary key

#### contact_id

- **Type**: `uuid`
- **Purpose**: Reference to the contact in the relationship
- **Foreign Key**: References `contacts_projection(id)`
- **Constraints**: NOT NULL, part of composite primary key

#### deleted_at

- **Type**: `timestamptz`
- **Purpose**: Soft delete timestamp for CQRS event sourcing
- **Logic**: NULL means active association, non-NULL means logically deleted
- **Pattern**: Set when `junction.organization_contact.unlinked` event is processed

## Relationships

### Parent Relationships (Foreign Keys)

- **organizations_projection** → `organization_id`
  - Each row links to exactly one organization
  - Cascade behavior determined by RLS policies

- **contacts_projection** → `contact_id`
  - Each row links to exactly one contact
  - Allows contact to be associated with multiple organizations

## Constraints

### Primary Key

```sql
PRIMARY KEY (organization_id, contact_id)
```

Composite primary key ensures each organization-contact pair is unique.

## Event Processing

This table is updated by the `process_junction_event()` function in response to domain events:

- **`junction.organization_contact.linked`**: Inserts or un-deletes a row
- **`junction.organization_contact.unlinked`**: Sets `deleted_at` timestamp

## Usage Examples

### Query Contacts for an Organization

```sql
SELECT c.*
FROM contacts_projection c
JOIN organization_contacts oc ON c.id = oc.contact_id
WHERE oc.organization_id = 'org-uuid-here'
  AND oc.deleted_at IS NULL;
```

### Query Organizations for a Contact

```sql
SELECT o.*
FROM organizations_projection o
JOIN organization_contacts oc ON o.id = oc.organization_id
WHERE oc.contact_id = 'contact-uuid-here'
  AND oc.deleted_at IS NULL;
```

## Related Documentation

- [contacts_projection](./contacts_projection.md) - Contact entity details
- [organizations_projection](./organizations_projection.md) - Organization entity details
- [Event Sourcing Overview](../../../architecture/data/event-sourcing-overview.md) - CQRS pattern explanation
