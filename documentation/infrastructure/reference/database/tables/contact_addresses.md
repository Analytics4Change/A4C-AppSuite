---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Junction table linking contacts to addresses. Supports many-to-many relationship enabling address sharing between contacts (e.g., same office address for multiple contacts). Simple junction without soft delete.

**When to read**:
- Understanding contact-address data model
- Querying addresses for a contact
- Implementing contact address association
- Working with contact group data structures

**Prerequisites**: [contacts_projection](./contacts_projection.md), [addresses_projection](./addresses_projection.md)

**Key topics**: `junction-table`, `many-to-many`, `contact-addresses`

**Estimated read time**: 3 minutes
<!-- TL;DR-END -->

# contact_addresses

## Overview

Junction table that establishes many-to-many relationships between contacts and addresses. Enables multiple contacts to share the same address (e.g., colleagues at the same office) and contacts to have multiple addresses. This is a simple junction table without soft delete - associations are hard deleted when removed.

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| contact_id | uuid | NO | - | Foreign key to contacts_projection |
| address_id | uuid | NO | - | Foreign key to addresses_projection |

### Column Details

#### contact_id

- **Type**: `uuid`
- **Purpose**: Reference to the contact in the relationship
- **Foreign Key**: References `contacts_projection(id)`
- **Constraints**: NOT NULL, part of composite primary key

#### address_id

- **Type**: `uuid`
- **Purpose**: Reference to the address in the relationship
- **Foreign Key**: References `addresses_projection(id)`
- **Constraints**: NOT NULL, part of composite primary key

## Relationships

### Parent Relationships (Foreign Keys)

- **contacts_projection** → `contact_id`
  - Each row links to exactly one contact

- **addresses_projection** → `address_id`
  - Each row links to exactly one address
  - Allows address to be associated with multiple contacts

## Constraints

### Primary Key

```sql
PRIMARY KEY (contact_id, address_id)
```

Composite primary key ensures each contact-address pair is unique.

## Event Processing

This table is updated by the `process_junction_event()` function in response to domain events:

- **`junction.contact_address.linked`**: Inserts a row
- **`junction.contact_address.unlinked`**: Deletes the row

## Usage Examples

### Query Addresses for a Contact

```sql
SELECT a.*
FROM addresses_projection a
JOIN contact_addresses ca ON a.id = ca.address_id
WHERE ca.contact_id = 'contact-uuid-here';
```

### Query Contacts at an Address

```sql
SELECT c.*
FROM contacts_projection c
JOIN contact_addresses ca ON c.id = ca.contact_id
WHERE ca.address_id = 'address-uuid-here';
```

## Related Documentation

- [contacts_projection](./contacts_projection.md) - Contact entity details
- [addresses_projection](./addresses_projection.md) - Address entity details
- [Event Sourcing Overview](../../../../architecture/data/event-sourcing-overview.md) - CQRS pattern explanation
