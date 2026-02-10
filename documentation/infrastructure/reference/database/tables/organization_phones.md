---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Junction table linking organizations to phone numbers. Supports many-to-many relationship enabling phone sharing across organizations (e.g., main office phone shared with billing). Includes soft delete for CQRS event-driven architecture.

**When to read**:
- Understanding organization-phone data model
- Querying phone numbers for an organization
- Implementing phone association/disassociation
- Working with bootstrap workflow phone linkage

**Prerequisites**: [organizations_projection](./organizations_projection.md), [phones_projection](./phones_projection.md)

**Key topics**: `junction-table`, `many-to-many`, `organization-phones`, `soft-delete`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# organization_phones

## Overview

Junction table that establishes many-to-many relationships between organizations and phone numbers. Created during the organization bootstrap workflow when phones are linked to organizations. Supports soft delete to maintain referential integrity while allowing logical removal.

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| organization_id | uuid | NO | - | Foreign key to organizations_projection |
| phone_id | uuid | NO | - | Foreign key to phones_projection |
| deleted_at | timestamptz | YES | - | Soft delete timestamp (NULL = active) |

### Column Details

#### organization_id

- **Type**: `uuid`
- **Purpose**: Reference to the organization in the relationship
- **Foreign Key**: References `organizations_projection(id)`
- **Constraints**: NOT NULL, part of composite primary key

#### phone_id

- **Type**: `uuid`
- **Purpose**: Reference to the phone in the relationship
- **Foreign Key**: References `phones_projection(id)`
- **Constraints**: NOT NULL, part of composite primary key

#### deleted_at

- **Type**: `timestamptz`
- **Purpose**: Soft delete timestamp for CQRS event sourcing
- **Logic**: NULL means active association, non-NULL means logically deleted
- **Pattern**: Set when `junction.organization_phone.unlinked` event is processed

## Relationships

### Parent Relationships (Foreign Keys)

- **organizations_projection** → `organization_id`
  - Each row links to exactly one organization
  - Cascade behavior determined by RLS policies

- **phones_projection** → `phone_id`
  - Each row links to exactly one phone
  - Allows phone to be associated with multiple organizations

## Constraints

### Primary Key

```sql
PRIMARY KEY (organization_id, phone_id)
```

Composite primary key ensures each organization-phone pair is unique.

## Event Processing

This table is updated by the `process_junction_event()` function in response to domain events:

- **`junction.organization_phone.linked`**: Inserts or un-deletes a row
- **`junction.organization_phone.unlinked`**: Sets `deleted_at` timestamp

## Usage Examples

### Query Phones for an Organization

```sql
SELECT p.*
FROM phones_projection p
JOIN organization_phones op ON p.id = op.phone_id
WHERE op.organization_id = 'org-uuid-here'
  AND op.deleted_at IS NULL;
```

### Query Organizations for a Phone

```sql
SELECT o.*
FROM organizations_projection o
JOIN organization_phones op ON o.id = op.organization_id
WHERE op.phone_id = 'phone-uuid-here'
  AND op.deleted_at IS NULL;
```

## Related Documentation

- [phones_projection](./phones_projection.md) - Phone entity details
- [organizations_projection](./organizations_projection.md) - Organization entity details
- [Event Sourcing Overview](../../../../architecture/data/event-sourcing-overview.md) - CQRS pattern explanation
