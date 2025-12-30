---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Junction table linking phone numbers to addresses. Supports direct phone-address association without requiring a contact intermediary. Used for main office scenarios where location matters for the phone line.

**When to read**:
- Understanding phone-address data model
- Querying address for a phone number (e.g., main office location)
- Implementing contact-less phone-address relationships
- Working with organizational headquarters data

**Prerequisites**: [phones_projection](./phones_projection.md), [addresses_projection](./addresses_projection.md)

**Key topics**: `junction-table`, `many-to-many`, `phone-addresses`, `headquarters`

**Estimated read time**: 3 minutes
<!-- TL;DR-END -->

# phone_addresses

## Overview

Junction table that establishes many-to-many relationships between phone numbers and addresses. This table supports scenarios where a phone number needs to be associated directly with an address without a contact intermediary - for example, a main office phone line at a headquarters address. Simple junction without soft delete.

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| phone_id | uuid | NO | - | Foreign key to phones_projection |
| address_id | uuid | NO | - | Foreign key to addresses_projection |

### Column Details

#### phone_id

- **Type**: `uuid`
- **Purpose**: Reference to the phone in the relationship
- **Foreign Key**: References `phones_projection(id)`
- **Constraints**: NOT NULL, part of composite primary key

#### address_id

- **Type**: `uuid`
- **Purpose**: Reference to the address in the relationship
- **Foreign Key**: References `addresses_projection(id)`
- **Constraints**: NOT NULL, part of composite primary key

## Relationships

### Parent Relationships (Foreign Keys)

- **phones_projection** → `phone_id`
  - Each row links to exactly one phone

- **addresses_projection** → `address_id`
  - Each row links to exactly one address
  - Allows address to be associated with multiple phones

## Constraints

### Primary Key

```sql
PRIMARY KEY (phone_id, address_id)
```

Composite primary key ensures each phone-address pair is unique.

## Use Cases

### Main Office Phone
When an organization has a main office phone number that should be associated with the headquarters address, but there's no specific contact person:

```sql
-- Link main office phone to headquarters address
INSERT INTO phone_addresses (phone_id, address_id)
VALUES ('main-phone-uuid', 'hq-address-uuid');
```

### Multi-Location Organizations
Organizations with multiple locations can have different phone numbers associated with different addresses:

```sql
-- Query phones by location
SELECT p.*, a.city, a.state
FROM phones_projection p
JOIN phone_addresses pa ON p.id = pa.phone_id
JOIN addresses_projection a ON pa.address_id = a.id
WHERE p.organization_id = 'org-uuid-here';
```

## Event Processing

This table is updated by the `process_junction_event()` function in response to domain events:

- **`junction.phone_address.linked`**: Inserts a row
- **`junction.phone_address.unlinked`**: Deletes the row

## Usage Examples

### Query Address for a Phone

```sql
SELECT a.*
FROM addresses_projection a
JOIN phone_addresses pa ON a.id = pa.address_id
WHERE pa.phone_id = 'phone-uuid-here';
```

### Query Phones at an Address

```sql
SELECT p.*
FROM phones_projection p
JOIN phone_addresses pa ON p.id = pa.phone_id
WHERE pa.address_id = 'address-uuid-here';
```

## Related Documentation

- [phones_projection](./phones_projection.md) - Phone entity details
- [addresses_projection](./addresses_projection.md) - Address entity details
- [Event Sourcing Overview](../../../architecture/data/event-sourcing-overview.md) - CQRS pattern explanation
