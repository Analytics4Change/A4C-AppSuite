---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Junction table linking organizations to addresses. Supports many-to-many relationship enabling address sharing across organizations (e.g., headquarters address shared with billing). Includes soft delete for CQRS event-driven architecture.

**When to read**:
- Understanding organization-address data model
- Querying addresses for an organization
- Implementing address association/disassociation
- Working with bootstrap workflow address linkage

**Prerequisites**: [organizations_projection](./organizations_projection.md), [addresses_projection](./addresses_projection.md)

**Key topics**: `junction-table`, `many-to-many`, `organization-addresses`, `soft-delete`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# organization_addresses

## Overview

Junction table that establishes many-to-many relationships between organizations and addresses. Created during the organization bootstrap workflow when addresses are linked to organizations. Supports soft delete to maintain referential integrity while allowing logical removal.

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| organization_id | uuid | NO | - | Foreign key to organizations_projection |
| address_id | uuid | NO | - | Foreign key to addresses_projection |
| deleted_at | timestamptz | YES | - | Soft delete timestamp (NULL = active) |

### Column Details

#### organization_id

- **Type**: `uuid`
- **Purpose**: Reference to the organization in the relationship
- **Foreign Key**: References `organizations_projection(id)`
- **Constraints**: NOT NULL, part of composite primary key

#### address_id

- **Type**: `uuid`
- **Purpose**: Reference to the address in the relationship
- **Foreign Key**: References `addresses_projection(id)`
- **Constraints**: NOT NULL, part of composite primary key

#### deleted_at

- **Type**: `timestamptz`
- **Purpose**: Soft delete timestamp for CQRS event sourcing
- **Logic**: NULL means active association, non-NULL means logically deleted
- **Pattern**: Set when `junction.organization_address.unlinked` event is processed

## Relationships

### Parent Relationships (Foreign Keys)

- **organizations_projection** → `organization_id`
  - Each row links to exactly one organization
  - Cascade behavior determined by RLS policies

- **addresses_projection** → `address_id`
  - Each row links to exactly one address
  - Allows address to be associated with multiple organizations

## Constraints

### Primary Key

```sql
PRIMARY KEY (organization_id, address_id)
```

Composite primary key ensures each organization-address pair is unique.

## Event Processing

This table is updated by the `process_junction_event()` function in response to domain events:

- **`junction.organization_address.linked`**: Inserts or un-deletes a row
- **`junction.organization_address.unlinked`**: Sets `deleted_at` timestamp

## Usage Examples

### Query Addresses for an Organization

```sql
SELECT a.*
FROM addresses_projection a
JOIN organization_addresses oa ON a.id = oa.address_id
WHERE oa.organization_id = 'org-uuid-here'
  AND oa.deleted_at IS NULL;
```

### Query Organizations at an Address

```sql
SELECT o.*
FROM organizations_projection o
JOIN organization_addresses oa ON o.id = oa.organization_id
WHERE oa.address_id = 'address-uuid-here'
  AND oa.deleted_at IS NULL;
```

## Related Documentation

- [addresses_projection](./addresses_projection.md) - Address entity details
- [organizations_projection](./organizations_projection.md) - Organization entity details
- [Event Sourcing Overview](../../../../architecture/data/event-sourcing-overview.md) - CQRS pattern explanation
