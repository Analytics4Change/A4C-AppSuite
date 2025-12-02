---
status: current
last_updated: 2025-12-02
---

# phones_projection

## Overview

Stores phone numbers for organizations, including office lines, mobile numbers, fax, and emergency contacts. This is a CQRS projection table, updated via domain events emitted by Temporal workflow activities during organization bootstrap.

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| organization_id | uuid | NO | - | Foreign key to organizations_projection |
| label | text | NO | - | Human-readable label (e.g., 'Main Office', 'Billing Phone') |
| type | phone_type | NO | - | Machine-readable enum type |
| number | text | NO | - | Phone number (formatted or unformatted) |
| extension | text | YES | - | Phone extension |
| country_code | text | YES | '+1' | Country dialing code |
| is_primary | boolean | YES | false | Whether this is the primary phone |
| is_active | boolean | YES | true | Soft delete flag |
| metadata | jsonb | YES | '{}' | Additional metadata |
| created_at | timestamptz | NO | now() | Record creation timestamp |
| updated_at | timestamptz | YES | now() | Record update timestamp |
| deleted_at | timestamptz | YES | - | Soft delete timestamp |

### Column Details

#### type (phone_type enum)

- **Type**: `phone_type` (PostgreSQL ENUM)
- **Purpose**: Machine-readable categorization of phone purpose
- **Values**:
  - `mobile` - Mobile/cell phone
  - `office` - Office/landline phone
  - `fax` - Fax number
  - `emergency` - Emergency contact number

#### label

- **Type**: `text`
- **Purpose**: Human-readable label for display in UI
- **Examples**:
  - "Main Office"
  - "Billing Phone"
  - "Provider Admin Phone"
  - "Billing Phone (from General Info)"
- **Pattern**: Frontend sets label based on form section; "(from General Info)" suffix indicates shared via checkbox

#### number

- **Type**: `text`
- **Purpose**: Stores the phone number
- **Format**: Accepts various formats; frontend handles formatting for display
- **Examples**: "512-555-1234", "5125551234", "(512) 555-1234"

#### is_primary

- **Type**: `boolean`
- **Purpose**: Designates the organization's primary phone
- **Constraint**: Only one phone per organization can be primary (enforced by unique partial index)

## Relationships

### Parent Relationships (Foreign Keys)

- **organizations_projection** → `organization_id`
  - Each phone belongs to exactly one organization
  - Multi-tenant isolation via RLS policies

### Child Relationships (Referenced By)

- **organization_phones** ← `phone_id`
  - Junction table linking phones to organizations
  - Supports phone sharing between organization entities

- **contact_phones** ← `phone_id`
  - Links phones to specific contacts
  - Contact-specific phone associations

- **phone_addresses** → `address_id`
  - Links phones to physical locations
  - Optional location context

## Indexes

### Primary Index
```sql
PRIMARY KEY (id)
```
- **Purpose**: Fast lookups by phone ID
- **Type**: B-tree

### Secondary Indexes

#### idx_phones_organization
```sql
CREATE INDEX idx_phones_organization
  ON phones_projection (organization_id)
  WHERE (deleted_at IS NULL);
```
- **Purpose**: Filtered queries by organization
- **Used By**: Multi-tenant queries, RLS enforcement
- **Filter**: Excludes soft-deleted records

#### idx_phones_type
```sql
CREATE INDEX idx_phones_type
  ON phones_projection (type, organization_id)
  WHERE (deleted_at IS NULL);
```
- **Purpose**: Find phones by type within organization
- **Used By**: "Get fax number for org" queries

#### idx_phones_number
```sql
CREATE INDEX idx_phones_number
  ON phones_projection (number)
  WHERE (deleted_at IS NULL);
```
- **Purpose**: Phone number lookups (for deduplication, search)
- **Used By**: Reverse lookup, duplicate detection

#### idx_phones_primary
```sql
CREATE INDEX idx_phones_primary
  ON phones_projection (organization_id, is_primary)
  WHERE ((is_primary = true) AND (deleted_at IS NULL));
```
- **Purpose**: Fast lookup of primary phone
- **Used By**: Default phone selection

#### idx_phones_one_primary_per_org
```sql
CREATE UNIQUE INDEX idx_phones_one_primary_per_org
  ON phones_projection (organization_id)
  WHERE ((is_primary = true) AND (deleted_at IS NULL));
```
- **Purpose**: Ensure only one primary phone per organization
- **Type**: Unique partial index
- **Constraint**: Business rule enforcement

#### idx_phones_active
```sql
CREATE INDEX idx_phones_active
  ON phones_projection (is_active, organization_id)
  WHERE ((is_active = true) AND (deleted_at IS NULL));
```
- **Purpose**: List active phones for organization
- **Used By**: Phone listings, dropdowns

## RLS Policies

### SELECT Policy (Organization Admins)

```sql
CREATE POLICY "phones_org_admin_select"
  ON phones_projection FOR SELECT
  USING (
    is_org_admin(get_current_user_id(), organization_id)
    AND deleted_at IS NULL
  );
```

**Purpose**: Organization admins can view phones in their organization

**Logic**:
- User must be an admin of the organization
- Soft-deleted records are excluded
- Uses `is_org_admin()` helper function

### ALL Policy (Super Admins)

```sql
CREATE POLICY "phones_super_admin_all"
  ON phones_projection FOR ALL
  USING (is_super_admin(get_current_user_id()));
```

**Purpose**: Super admins have full access to all phones

**Logic**:
- Uses `is_super_admin()` helper function
- Allows SELECT, INSERT, UPDATE, DELETE
- No organization restriction

## Usage Examples

### Create a Phone (via Workflow)

```sql
-- Phones are created by Temporal activities, not direct inserts
-- This is for reference only

INSERT INTO phones_projection (
  organization_id,
  label,
  type,
  number,
  extension,
  country_code,
  is_primary
) VALUES (
  'org-uuid-here',
  'Main Office',
  'office',
  '512-555-1234',
  '100',
  '+1',
  true
) RETURNING *;
```

### Query Phones for Organization

```sql
-- Get all phones for an organization
SELECT *
FROM phones_projection
WHERE organization_id = 'org-uuid-here'
  AND deleted_at IS NULL
ORDER BY is_primary DESC, created_at;
```

### Get Primary Phone

```sql
SELECT *
FROM phones_projection
WHERE organization_id = 'org-uuid-here'
  AND is_primary = true
  AND deleted_at IS NULL;
```

### Get Fax Number

```sql
SELECT *
FROM phones_projection
WHERE organization_id = 'org-uuid-here'
  AND type = 'fax'
  AND deleted_at IS NULL;
```

### Format Full Phone Number

```sql
SELECT
  id,
  label,
  CONCAT(
    country_code, ' ',
    number,
    CASE WHEN extension IS NOT NULL THEN CONCAT(' ext. ', extension) ELSE '' END
  ) AS formatted_phone
FROM phones_projection
WHERE organization_id = 'org-uuid-here'
  AND deleted_at IS NULL;
```

## Audit Trail

### Event Emission

This table is updated via domain events:

- **Events That Create Records**:
  - `phone.created` - Emitted by `createPhones` activity

- **Events That Update Records**:
  - `phone.updated` - Emitted by future update activities

- **Events That Delete Records**:
  - `phone.deleted` - Soft delete via `deleted_at` timestamp

### Event Data Schema

```typescript
interface PhoneCreatedEvent {
  phone_id: string;
  organization_id: string;
  label: string;
  type: 'mobile' | 'office' | 'fax' | 'emergency';
  number: string;
  extension?: string;
  country_code: string;
}
```

## JSONB Column: metadata

### Purpose

Stores additional phone information that doesn't fit the fixed schema.

### Schema

```typescript
interface PhoneMetadata {
  verified?: boolean;
  verified_at?: string;
  sms_capable?: boolean;
  voicemail_enabled?: boolean;
  notes?: string;
  business_hours?: {
    start: string;  // "09:00"
    end: string;    // "17:00"
    timezone: string;
  };
}
```

### Example

```json
{
  "verified": true,
  "verified_at": "2025-12-01T10:30:00Z",
  "sms_capable": false,
  "voicemail_enabled": true,
  "business_hours": {
    "start": "09:00",
    "end": "17:00",
    "timezone": "America/Chicago"
  }
}
```

## Security Considerations

### Data Sensitivity

- **Sensitivity Level**: CONFIDENTIAL
- **PII**: Yes - phone numbers are PII
- **Compliance**: HIPAA (PHI-adjacent), GDPR (personal data)

### Access Control

- RLS policies enforce multi-tenant isolation
- Organization admins can only view their organization's phones
- Super admin bypass for administrative functions
- Full phone numbers should not be exposed in public APIs

## Related Documentation

- [organizations_projection](./organizations_projection.md) - Parent organization table
- [Organization Management Architecture](../../../../architecture/data/organization-management-architecture.md) - Data model design
- [Provider Onboarding Quickstart](../../../../workflows/guides/provider-onboarding-quickstart.md) - How phones are created

## See Also

- **Junction Tables**: `organization_phones`, `contact_phones`, `phone_addresses`
- **Related Projections**: `contacts_projection`, `addresses_projection`
- **Workflows**: Organization Bootstrap Workflow creates phone records

---

**Last Updated**: 2025-12-02
**Applies To**: Database schema v2.0
**Status**: current
