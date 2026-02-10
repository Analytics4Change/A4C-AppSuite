---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Junction table linking contacts to phone numbers. Supports many-to-many relationship enabling phone sharing between contacts (e.g., shared office phone). Simple junction without soft delete.

**When to read**:
- Understanding contact-phone data model
- Querying phone numbers for a contact
- Implementing contact phone association
- Working with contact group data structures

**Prerequisites**: [contacts_projection](./contacts_projection.md), [phones_projection](./phones_projection.md)

**Key topics**: `junction-table`, `many-to-many`, `contact-phones`

**Estimated read time**: 3 minutes
<!-- TL;DR-END -->

# contact_phones

## Overview

Junction table that establishes many-to-many relationships between contacts and phone numbers. Enables multiple contacts to share the same phone (e.g., shared department line) and contacts to have multiple phone numbers. This is a simple junction table without soft delete - associations are hard deleted when removed.

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| contact_id | uuid | NO | - | Foreign key to contacts_projection |
| phone_id | uuid | NO | - | Foreign key to phones_projection |

### Column Details

#### contact_id

- **Type**: `uuid`
- **Purpose**: Reference to the contact in the relationship
- **Foreign Key**: References `contacts_projection(id)`
- **Constraints**: NOT NULL, part of composite primary key

#### phone_id

- **Type**: `uuid`
- **Purpose**: Reference to the phone in the relationship
- **Foreign Key**: References `phones_projection(id)`
- **Constraints**: NOT NULL, part of composite primary key

## Relationships

### Parent Relationships (Foreign Keys)

- **contacts_projection** → `contact_id`
  - Each row links to exactly one contact

- **phones_projection** → `phone_id`
  - Each row links to exactly one phone
  - Allows phone to be associated with multiple contacts

## Constraints

### Primary Key

```sql
PRIMARY KEY (contact_id, phone_id)
```

Composite primary key ensures each contact-phone pair is unique.

## Event Processing

This table is updated by the `process_junction_event()` function in response to domain events:

- **`junction.contact_phone.linked`**: Inserts a row
- **`junction.contact_phone.unlinked`**: Deletes the row

## Usage Examples

### Query Phones for a Contact

```sql
SELECT p.*
FROM phones_projection p
JOIN contact_phones cp ON p.id = cp.phone_id
WHERE cp.contact_id = 'contact-uuid-here';
```

### Query Contacts for a Phone

```sql
SELECT c.*
FROM contacts_projection c
JOIN contact_phones cp ON c.id = cp.contact_id
WHERE cp.phone_id = 'phone-uuid-here';
```

## Related Documentation

- [contacts_projection](./contacts_projection.md) - Contact entity details
- [phones_projection](./phones_projection.md) - Phone entity details
- [Event Sourcing Overview](../../../../architecture/data/event-sourcing-overview.md) - CQRS pattern explanation
