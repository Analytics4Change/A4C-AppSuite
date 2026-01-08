---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection storing contact information (billing, technical, admin, emergency) for organizations. Created during bootstrap workflow via `createContacts` activity. Supports one primary contact per org via unique partial index. Includes soft delete and RLS policies.

**When to read**:
- Building organization contact management UI
- Understanding bootstrap workflow data model
- Querying billing or admin contacts for an organization
- Implementing contact CRUD operations

**Prerequisites**: [organizations_projection](./organizations_projection.md)

**Key topics**: `contacts`, `organization-bootstrap`, `billing-contact`, `pii`, `soft-delete`, `rls-policies`

**Estimated read time**: 10 minutes
<!-- TL;DR-END -->

# contacts_projection

## Overview

Stores contact information for organizations, including billing contacts, provider admins, and technical contacts. This is a CQRS projection table, updated via domain events emitted by Temporal workflow activities during organization bootstrap.

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| organization_id | uuid | NO | - | Foreign key to organizations_projection |
| label | text | NO | - | Human-readable label (e.g., 'Billing Contact', 'Provider Admin') |
| type | contact_type | NO | - | Machine-readable enum type |
| first_name | text | NO | - | Contact's first name |
| last_name | text | NO | - | Contact's last name |
| email | text | NO | - | Contact's email address |
| title | text | YES | - | Job title |
| department | text | YES | - | Department name |
| is_primary | boolean | YES | false | Whether this is the primary contact |
| is_active | boolean | YES | true | Soft delete flag |
| metadata | jsonb | YES | '{}' | Additional metadata |
| created_at | timestamptz | NO | now() | Record creation timestamp |
| updated_at | timestamptz | YES | now() | Record update timestamp |
| deleted_at | timestamptz | YES | - | Soft delete timestamp |

### Column Details

#### type (contact_type enum)

- **Type**: `contact_type` (PostgreSQL ENUM)
- **Purpose**: Machine-readable categorization of contact role
- **Values**:
  - `a4c_admin` - A4C platform administrator
  - `billing` - Billing/accounts payable contact
  - `technical` - Technical/IT contact
  - `emergency` - Emergency contact
  - `stakeholder` - Business stakeholder

#### label

- **Type**: `text`
- **Purpose**: Human-readable label for display in UI
- **Examples**:
  - "Billing Contact"
  - "Provider Admin"
  - "Headquarters"
  - "Billing Contact (from General Info)"
- **Pattern**: Frontend sets label based on form section; "(from General Info)" suffix indicates shared via checkbox

#### is_primary

- **Type**: `boolean`
- **Purpose**: Designates the organization's primary contact
- **Constraint**: Only one contact per organization can be primary (enforced by unique partial index)

## Relationships

### Parent Relationships (Foreign Keys)

- **organizations_projection** → `organization_id`
  - Each contact belongs to exactly one organization
  - Multi-tenant isolation via RLS policies

### Child Relationships (Referenced By)

- **organization_contacts** ← `contact_id`
  - Junction table linking contacts to organizations
  - Supports multiple organizations sharing the same contact record

- **contact_addresses** ← `contact_id`
  - Links contacts to their specific addresses
  - One-to-many relationship

- **contact_phones** ← `contact_id`
  - Links contacts to their phone numbers
  - One-to-many relationship

## Indexes

### Primary Index
```sql
PRIMARY KEY (id)
```
- **Purpose**: Fast lookups by contact ID
- **Type**: B-tree

### Secondary Indexes

#### idx_contacts_organization
```sql
CREATE INDEX idx_contacts_organization
  ON contacts_projection (organization_id)
  WHERE (deleted_at IS NULL);
```
- **Purpose**: Filtered queries by organization
- **Used By**: Multi-tenant queries, RLS enforcement
- **Filter**: Excludes soft-deleted records

#### idx_contacts_type
```sql
CREATE INDEX idx_contacts_type
  ON contacts_projection (type, organization_id)
  WHERE (deleted_at IS NULL);
```
- **Purpose**: Find contacts by type within organization
- **Used By**: "Get billing contact for org" queries

#### idx_contacts_email
```sql
CREATE INDEX idx_contacts_email
  ON contacts_projection (email)
  WHERE (deleted_at IS NULL);
```
- **Purpose**: Email lookups (for deduplication, search)
- **Used By**: User invitation workflows

#### idx_contacts_primary
```sql
CREATE INDEX idx_contacts_primary
  ON contacts_projection (organization_id, is_primary)
  WHERE ((is_primary = true) AND (deleted_at IS NULL));
```
- **Purpose**: Fast lookup of primary contact
- **Used By**: Default contact selection

#### idx_contacts_one_primary_per_org
```sql
CREATE UNIQUE INDEX idx_contacts_one_primary_per_org
  ON contacts_projection (organization_id)
  WHERE ((is_primary = true) AND (deleted_at IS NULL));
```
- **Purpose**: Ensure only one primary contact per organization
- **Type**: Unique partial index
- **Constraint**: Business rule enforcement

#### idx_contacts_active
```sql
CREATE INDEX idx_contacts_active
  ON contacts_projection (is_active, organization_id)
  WHERE ((is_active = true) AND (deleted_at IS NULL));
```
- **Purpose**: List active contacts for organization
- **Used By**: Contact listings, dropdowns

## RLS Policies

### SELECT Policy (Organization Admins)

```sql
CREATE POLICY "contacts_org_admin_select"
  ON contacts_projection FOR SELECT
  USING (
    has_org_admin_permission()
    AND organization_id = get_current_org_id()
    AND deleted_at IS NULL
  );
```

**Purpose**: Organization admins can view contacts in their organization

**Logic**:
- User must have org admin permission (via JWT claims)
- Organization must match user's current org (from JWT)
- Soft-deleted records are excluded
- Uses `has_org_admin_permission()` JWT-claims-based function (no DB query)

### ALL Policy (Super Admins)

```sql
CREATE POLICY "contacts_super_admin_all"
  ON contacts_projection FOR ALL
  USING (is_super_admin(get_current_user_id()));
```

**Purpose**: Super admins have full access to all contacts

**Logic**:
- Uses `is_super_admin()` helper function
- Allows SELECT, INSERT, UPDATE, DELETE
- No organization restriction

## Usage Examples

### Create a Contact (via Workflow)

```sql
-- Contacts are created by Temporal activities, not direct inserts
-- This is for reference only

INSERT INTO contacts_projection (
  organization_id,
  label,
  type,
  first_name,
  last_name,
  email,
  title,
  department,
  is_primary
) VALUES (
  'org-uuid-here',
  'Provider Admin',
  'a4c_admin',
  'John',
  'Doe',
  'john.doe@example.com',
  'Administrator',
  'IT',
  true
) RETURNING *;
```

### Query Contacts for Organization

```sql
-- Get all contacts for an organization
SELECT *
FROM contacts_projection
WHERE organization_id = 'org-uuid-here'
  AND deleted_at IS NULL
ORDER BY is_primary DESC, created_at;
```

### Get Primary Contact

```sql
SELECT *
FROM contacts_projection
WHERE organization_id = 'org-uuid-here'
  AND is_primary = true
  AND deleted_at IS NULL;
```

### Get Billing Contact

```sql
SELECT *
FROM contacts_projection
WHERE organization_id = 'org-uuid-here'
  AND type = 'billing'
  AND deleted_at IS NULL;
```

## Audit Trail

### Event Emission

This table is updated via domain events:

- **Events That Create Records**:
  - `contact.created` - Emitted by `createContacts` activity

- **Events That Update Records**:
  - `contact.updated` - Emitted by future update activities

- **Events That Delete Records**:
  - `contact.deleted` - Soft delete via `deleted_at` timestamp

### Event Data Schema

```typescript
interface ContactCreatedEvent {
  contact_id: string;
  organization_id: string;
  label: string;
  type: 'a4c_admin' | 'billing' | 'technical' | 'emergency' | 'stakeholder';
  first_name: string;
  last_name: string;
  email: string;
  title?: string;
  department?: string;
}
```

## JSONB Column: metadata

### Purpose

Stores additional contact information that doesn't fit the fixed schema.

### Schema

```typescript
interface ContactMetadata {
  notes?: string;
  preferred_contact_method?: 'email' | 'phone';
  timezone?: string;
  custom_fields?: Record<string, unknown>;
}
```

### Example

```json
{
  "notes": "Prefers morning calls",
  "preferred_contact_method": "email",
  "timezone": "America/New_York"
}
```

## Security Considerations

### Data Sensitivity

- **Sensitivity Level**: CONFIDENTIAL
- **PII**: Yes - contains names, emails, titles
- **Compliance**: HIPAA (PHI-adjacent), GDPR (personal data)

### Access Control

- RLS policies enforce multi-tenant isolation
- Organization admins can only view their organization's contacts
- Super admin bypass for administrative functions
- Email addresses should not be exposed in public APIs

## Related Documentation

- [organizations_projection](./organizations_projection.md) - Parent organization table
- [Organization Management Architecture](../../../../architecture/data/organization-management-architecture.md) - Data model design
- [Provider Onboarding Quickstart](../../../../workflows/guides/provider-onboarding-quickstart.md) - How contacts are created

## See Also

- **Junction Tables**: `organization_contacts`, `contact_addresses`, `contact_phones`
- **Related Projections**: `addresses_projection`, `phones_projection`
- **Workflows**: Organization Bootstrap Workflow creates contact records

---

**Last Updated**: 2025-12-02
**Applies To**: Database schema v2.0
**Status**: current
