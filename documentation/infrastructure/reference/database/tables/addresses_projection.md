---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection storing physical addresses (headquarters, billing, mailing) for organizations. Created during bootstrap workflow via `createAddresses` activity. Supports geocoding metadata and one primary address per org. Includes soft delete and RLS policies.

**When to read**:
- Building organization address management UI
- Understanding bootstrap workflow data model
- Querying headquarters or billing addresses
- Implementing address verification or geocoding

**Prerequisites**: [organizations_projection](./organizations_projection.md)

**Key topics**: `addresses`, `organization-bootstrap`, `headquarters`, `billing-address`, `pii`, `soft-delete`

**Estimated read time**: 10 minutes
<!-- TL;DR-END -->

# addresses_projection

## Overview

Stores physical addresses for organizations, including headquarters, billing addresses, and mailing addresses. This is a CQRS projection table, updated via domain events emitted by Temporal workflow activities during organization bootstrap.

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| organization_id | uuid | NO | - | Foreign key to organizations_projection |
| label | text | NO | - | Human-readable label (e.g., 'Headquarters', 'Billing Address') |
| type | address_type | NO | - | Machine-readable enum type |
| street1 | text | NO | - | Street address line 1 |
| street2 | text | YES | - | Street address line 2 (suite, floor, etc.) |
| city | text | NO | - | City name |
| state | text | NO | - | State/province code |
| zip_code | text | NO | - | Postal/ZIP code |
| country | text | YES | 'US' | Country code (ISO 3166-1 alpha-2) |
| is_primary | boolean | YES | false | Whether this is the primary address |
| is_active | boolean | YES | true | Soft delete flag |
| metadata | jsonb | YES | '{}' | Additional metadata |
| created_at | timestamptz | NO | now() | Record creation timestamp |
| updated_at | timestamptz | YES | now() | Record update timestamp |
| deleted_at | timestamptz | YES | - | Soft delete timestamp |

### Column Details

#### type (address_type enum)

- **Type**: `address_type` (PostgreSQL ENUM)
- **Purpose**: Machine-readable categorization of address purpose
- **Values**:
  - `physical` - Physical/headquarters location
  - `mailing` - Mailing/correspondence address
  - `billing` - Billing/invoice address

#### label

- **Type**: `text`
- **Purpose**: Human-readable label for display in UI
- **Examples**:
  - "Headquarters"
  - "Billing Address"
  - "Mailing Address"
  - "Billing Address (from General Info)"
- **Pattern**: Frontend sets label based on form section; "(from General Info)" suffix indicates shared via checkbox

#### is_primary

- **Type**: `boolean`
- **Purpose**: Designates the organization's primary address
- **Constraint**: Only one address per organization can be primary (enforced by unique partial index)

## Relationships

### Parent Relationships (Foreign Keys)

- **organizations_projection** → `organization_id`
  - Each address belongs to exactly one organization
  - Multi-tenant isolation via RLS policies

### Child Relationships (Referenced By)

- **organization_addresses** ← `address_id`
  - Junction table linking addresses to organizations
  - Supports address sharing between organization entities

- **contact_addresses** ← `address_id`
  - Links addresses to specific contacts
  - Contact-specific address associations

- **phone_addresses** ← `address_id`
  - Links addresses to phone numbers (location context)
  - Optional relationship

## Indexes

### Primary Index
```sql
PRIMARY KEY (id)
```
- **Purpose**: Fast lookups by address ID
- **Type**: B-tree

### Secondary Indexes

#### idx_addresses_organization
```sql
CREATE INDEX idx_addresses_organization
  ON addresses_projection (organization_id)
  WHERE (deleted_at IS NULL);
```
- **Purpose**: Filtered queries by organization
- **Used By**: Multi-tenant queries, RLS enforcement
- **Filter**: Excludes soft-deleted records

#### idx_addresses_type
```sql
CREATE INDEX idx_addresses_type
  ON addresses_projection (type, organization_id)
  WHERE (deleted_at IS NULL);
```
- **Purpose**: Find addresses by type within organization
- **Used By**: "Get billing address for org" queries

#### idx_addresses_zip
```sql
CREATE INDEX idx_addresses_zip
  ON addresses_projection (zip_code)
  WHERE (deleted_at IS NULL);
```
- **Purpose**: Geographic queries by ZIP code
- **Used By**: Service area determination, reporting

#### idx_addresses_primary
```sql
CREATE INDEX idx_addresses_primary
  ON addresses_projection (organization_id, is_primary)
  WHERE ((is_primary = true) AND (deleted_at IS NULL));
```
- **Purpose**: Fast lookup of primary address
- **Used By**: Default address selection

#### idx_addresses_one_primary_per_org
```sql
CREATE UNIQUE INDEX idx_addresses_one_primary_per_org
  ON addresses_projection (organization_id)
  WHERE ((is_primary = true) AND (deleted_at IS NULL));
```
- **Purpose**: Ensure only one primary address per organization
- **Type**: Unique partial index
- **Constraint**: Business rule enforcement

#### idx_addresses_active
```sql
CREATE INDEX idx_addresses_active
  ON addresses_projection (is_active, organization_id)
  WHERE ((is_active = true) AND (deleted_at IS NULL));
```
- **Purpose**: List active addresses for organization
- **Used By**: Address listings, dropdowns

## RLS Policies

### SELECT Policy (Organization Admins)

```sql
CREATE POLICY "addresses_org_admin_select"
  ON addresses_projection FOR SELECT
  USING (
    is_org_admin(get_current_user_id(), organization_id)
    AND deleted_at IS NULL
  );
```

**Purpose**: Organization admins can view addresses in their organization

**Logic**:
- User must be an admin of the organization
- Soft-deleted records are excluded
- Uses `is_org_admin()` helper function

### ALL Policy (Super Admins)

```sql
CREATE POLICY "addresses_super_admin_all"
  ON addresses_projection FOR ALL
  USING (is_super_admin(get_current_user_id()));
```

**Purpose**: Super admins have full access to all addresses

**Logic**:
- Uses `is_super_admin()` helper function
- Allows SELECT, INSERT, UPDATE, DELETE
- No organization restriction

## Usage Examples

### Create an Address (via Workflow)

```sql
-- Addresses are created by Temporal activities, not direct inserts
-- This is for reference only

INSERT INTO addresses_projection (
  organization_id,
  label,
  type,
  street1,
  street2,
  city,
  state,
  zip_code,
  country,
  is_primary
) VALUES (
  'org-uuid-here',
  'Headquarters',
  'physical',
  '123 Main Street',
  'Suite 100',
  'Austin',
  'TX',
  '78701',
  'US',
  true
) RETURNING *;
```

### Query Addresses for Organization

```sql
-- Get all addresses for an organization
SELECT *
FROM addresses_projection
WHERE organization_id = 'org-uuid-here'
  AND deleted_at IS NULL
ORDER BY is_primary DESC, created_at;
```

### Get Primary Address

```sql
SELECT *
FROM addresses_projection
WHERE organization_id = 'org-uuid-here'
  AND is_primary = true
  AND deleted_at IS NULL;
```

### Get Billing Address

```sql
SELECT *
FROM addresses_projection
WHERE organization_id = 'org-uuid-here'
  AND type = 'billing'
  AND deleted_at IS NULL;
```

### Format Full Address

```sql
SELECT
  id,
  label,
  CONCAT_WS(', ',
    street1,
    NULLIF(street2, ''),
    city,
    CONCAT(state, ' ', zip_code),
    CASE WHEN country != 'US' THEN country END
  ) AS formatted_address
FROM addresses_projection
WHERE organization_id = 'org-uuid-here'
  AND deleted_at IS NULL;
```

## Audit Trail

### Event Emission

This table is updated via domain events:

- **Events That Create Records**:
  - `address.created` - Emitted by `createAddresses` activity

- **Events That Update Records**:
  - `address.updated` - Emitted by future update activities

- **Events That Delete Records**:
  - `address.deleted` - Soft delete via `deleted_at` timestamp

### Event Data Schema

```typescript
interface AddressCreatedEvent {
  address_id: string;
  organization_id: string;
  label: string;
  type: 'physical' | 'mailing' | 'billing';
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
}
```

## JSONB Column: metadata

### Purpose

Stores additional address information that doesn't fit the fixed schema.

### Schema

```typescript
interface AddressMetadata {
  verified?: boolean;
  verified_at?: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
  timezone?: string;
  notes?: string;
}
```

### Example

```json
{
  "verified": true,
  "verified_at": "2025-12-01T10:30:00Z",
  "coordinates": {
    "lat": 30.2672,
    "lng": -97.7431
  },
  "timezone": "America/Chicago"
}
```

## Security Considerations

### Data Sensitivity

- **Sensitivity Level**: CONFIDENTIAL
- **PII**: Yes - physical addresses are PII
- **Compliance**: HIPAA (PHI-adjacent), GDPR (personal data)

### Access Control

- RLS policies enforce multi-tenant isolation
- Organization admins can only view their organization's addresses
- Super admin bypass for administrative functions
- Full addresses should not be exposed in public APIs

## Related Documentation

- [organizations_projection](./organizations_projection.md) - Parent organization table
- [Organization Management Architecture](../../../../architecture/data/organization-management-architecture.md) - Data model design
- [Provider Onboarding Quickstart](../../../../workflows/guides/provider-onboarding-quickstart.md) - How addresses are created

## See Also

- **Junction Tables**: `organization_addresses`, `contact_addresses`, `phone_addresses`
- **Related Projections**: `contacts_projection`, `phones_projection`
- **Workflows**: Organization Bootstrap Workflow creates address records

---

**Last Updated**: 2025-12-02
**Applies To**: Database schema v2.0
**Status**: current
