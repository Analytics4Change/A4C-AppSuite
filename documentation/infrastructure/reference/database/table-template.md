---
status: current
last_updated: 2025-01-13
---

# [table_name]

## Overview

Brief description of what this table stores and its primary purpose in the database schema.

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| organization_id | uuid | NO | - | Foreign key to organizations (multi-tenant isolation) |
| created_at | timestamptz | NO | now() | Record creation timestamp |
| updated_at | timestamptz | NO | now() | Record update timestamp |
| created_by | uuid | YES | - | User who created the record |
| updated_by | uuid | YES | - | User who last updated the record |
| ... | ... | ... | ... | ... |

### Column Details

#### id
- **Type**: `uuid`
- **Purpose**: Unique identifier for each record
- **Generation**: Automatically generated via `gen_random_uuid()`
- **Constraints**: PRIMARY KEY

#### organization_id
- **Type**: `uuid`
- **Purpose**: Multi-tenant isolation key
- **Foreign Key**: References `organizations_projection(id)`
- **Constraints**: NOT NULL, ON DELETE CASCADE
- **RLS**: Used for tenant isolation policies

_[Document other important columns with additional context as needed]_

## Relationships

### Parent Relationships (Foreign Keys)

- **organizations_projection** → `organization_id`
  - Each record belongs to exactly one organization
  - Enforced by foreign key constraint with CASCADE delete
  - Multi-tenant isolation via RLS policies

### Child Relationships (Referenced By)

- **[child_table]** ← `[foreign_key_column]`
  - One-to-many relationship
  - Describes the relationship purpose
  - Cascade behavior: [CASCADE | SET NULL | RESTRICT]

### Many-to-Many Relationships

- **[related_table]** via **[junction_table]**
  - Junction table columns: [list columns]
  - Purpose of relationship
  - Common query patterns

## Indexes

### Primary Index
```sql
PRIMARY KEY (id)
```
- **Purpose**: Fast lookups by record ID
- **Performance**: O(log n) lookups

### Secondary Indexes

#### idx_[table]_organization
```sql
CREATE INDEX idx_[table]_organization ON [table] (organization_id);
```
- **Purpose**: Filtered queries by organization
- **Used By**: Multi-tenant queries, RLS enforcement
- **Performance**: Essential for tenant isolation performance

#### idx_[table]_[column]
```sql
CREATE INDEX idx_[table]_[column] ON [table] ([column]);
```
- **Purpose**: Describe index purpose
- **Used By**: List common query patterns
- **Performance**: Performance characteristics

_[Document all indexes with purpose and usage patterns]_

## RLS Policies

### SELECT Policy

```sql
CREATE POLICY "[table]_select_policy"
  ON [table] FOR SELECT
  USING (
    is_super_admin(get_current_user_id()) OR
    organization_id = (auth.jwt()->>'org_id')::uuid
  );
```

**Purpose**: Control which rows users can view

**Logic**:
- Super admins can view all records across all organizations
- Regular users can only view records in their own organization
- Organization ID extracted from JWT custom claims

**Testing**:
```sql
-- Test as super admin (should see all records)
SELECT * FROM [table];

-- Test as org user (should only see org records)
SELECT * FROM [table];
```

### INSERT Policy

```sql
CREATE POLICY "[table]_insert_policy"
  ON [table] FOR INSERT
  WITH CHECK (
    is_super_admin(get_current_user_id()) OR
    (has_org_admin_permission() AND organization_id = get_current_org_id())
  );
```

**Purpose**: Control who can create new records

**Logic**: Uses JWT-claims-based `has_org_admin_permission()` for org admin check (no database query). _[Customize as needed]_

### UPDATE Policy

_[Document UPDATE policy similarly]_

### DELETE Policy

_[Document DELETE policy similarly]_

## Triggers

### [trigger_name]

```sql
CREATE TRIGGER [trigger_name]
  AFTER INSERT OR UPDATE OR DELETE ON [table]
  FOR EACH ROW
  EXECUTE FUNCTION [function_name]();
```

**Purpose**: Describe trigger purpose (e.g., emit domain events, update projection)

**Timing**: AFTER INSERT/UPDATE/DELETE

**Execution**: FOR EACH ROW

**Function**: `[function_name]()`

**Event Processing**:
- INSERT: Describe what happens on insert
- UPDATE: Describe what happens on update
- DELETE: Describe what happens on delete

## Constraints

### Unique Constraints

```sql
UNIQUE (column1, column2)
```
- **Purpose**: Ensure business rule (e.g., no duplicate emails per organization)
- **Columns**: Describe columns and why they must be unique together

### Check Constraints

```sql
CHECK (column > 0)
```
- **Purpose**: Enforce business rule
- **Logic**: Describe constraint logic

### Foreign Key Constraints

_[Detailed in Relationships section above]_

## Usage Examples

### Create a Record

```sql
INSERT INTO [table] (
  organization_id,
  column1,
  column2
) VALUES (
  'org-uuid-here',
  'value1',
  'value2'
) RETURNING *;
```

**Returns**: The newly created record with generated ID and timestamps

### Query Records

```sql
-- Get all records for current organization
SELECT *
FROM [table]
WHERE organization_id = (auth.jwt()->>'org_id')::uuid;
```

**RLS Note**: RLS policies automatically filter to current organization, but explicit WHERE clause improves query performance

### Update a Record

```sql
UPDATE [table]
SET
  column1 = 'new_value',
  updated_at = now(),
  updated_by = get_current_user_id()
WHERE id = 'record-uuid-here';
```

### Delete a Record

```sql
-- Soft delete (if soft delete supported)
UPDATE [table]
SET
  deleted_at = now(),
  is_active = false
WHERE id = 'record-uuid-here';

-- Hard delete
DELETE FROM [table]
WHERE id = 'record-uuid-here';
```

### Common Queries

#### Query with Related Data

```sql
SELECT
  t.*,
  r.column AS related_column
FROM [table] t
LEFT JOIN [related_table] r ON t.foreign_key = r.id
WHERE t.organization_id = (auth.jwt()->>'org_id')::uuid;
```

#### Aggregation Queries

```sql
SELECT
  organization_id,
  COUNT(*) as record_count
FROM [table]
GROUP BY organization_id;
```

## Audit Trail

### Event Emission

This table participates in the CQRS event-driven architecture:

- **Events Emitted**:
  - `[domain].[entity]_created` - When new record created
  - `[domain].[entity]_updated` - When record modified
  - `[domain].[entity]_deleted` - When record deleted

- **Event Data**: See AsyncAPI schema in `infrastructure/supabase/contracts/asyncapi/domains/[domain].yaml`

- **Event Trigger**: `[trigger_name]` (see Triggers section)

### Audit Trail

- All state changes recorded via domain events in `domain_events` table
- Events include: event_type, aggregate_id, event_data, metadata (user_id, timestamp, workflow context)
- Immutable audit trail for HIPAA compliance - query `domain_events` for complete history

## JSONB Columns

_[If table has JSONB columns, document their structure]_

### [jsonb_column_name]

**Purpose**: Describe what this JSONB field stores

**Schema**:
```typescript
interface [ColumnName]Schema {
  property1: string;
  property2: number;
  nested?: {
    subProperty: boolean;
  };
}
```

**Example Value**:
```json
{
  "property1": "value",
  "property2": 123,
  "nested": {
    "subProperty": true
  }
}
```

**Validation**: _[Describe any validation rules or constraints]_

**Indexing**: _[If using GIN/GIST indexes on JSONB]_

## Migration History

### Initial Creation
- **Date**: YYYY-MM-DD
- **Migration**: `YYYYMMDDHHMMSS_create_[table]_table.sql`
- **Purpose**: Initial table creation

### Schema Changes
- **Date**: YYYY-MM-DD
- **Migration**: `migration_file.sql`
- **Changes**: Describe what changed (added columns, indexes, constraints)
- **Reason**: Why the change was needed

## Performance Considerations

### Query Performance
- Expected row count: _[Estimate or actual]_
- Growth rate: _[Describe growth pattern]_
- Hot paths: _[List most common query patterns]_
- Optimization strategies: _[Describe any specific optimizations]_

### Index Strategy
- Why these specific indexes exist
- Trade-offs (write performance vs read performance)
- Maintenance considerations (VACUUM, REINDEX)

## Security Considerations

### Data Sensitivity
- **Sensitivity Level**: [PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED]
- **PII/PHI**: Does this table contain personally identifiable or health information?
- **Compliance**: HIPAA, GDPR, or other regulatory requirements

### Access Control
- RLS policies enforce multi-tenant isolation
- Super admin bypass for administrative functions
- Role-based permissions via RBAC system

### Encryption
- At-rest encryption: Handled by PostgreSQL/Supabase
- In-transit encryption: TLS/SSL connections
- Column-level encryption: _[If applicable]_

## Troubleshooting

### Common Issues

#### RLS Policy Errors
**Symptom**: `new row violates row-level security policy`

**Cause**: Trying to insert/update with wrong organization_id

**Solution**:
```sql
-- Ensure organization_id matches JWT claim
SELECT auth.jwt()->>'org_id' AS current_org_id;
```

#### Foreign Key Violations
**Symptom**: `violates foreign key constraint`

**Cause**: Referenced record doesn't exist

**Solution**: Verify parent record exists before insert

### Performance Issues

#### Slow Queries
**Symptom**: Queries taking > 100ms

**Diagnosis**:
```sql
EXPLAIN ANALYZE
SELECT * FROM [table] WHERE [conditions];
```

**Solution**: Add appropriate indexes, review query plan

## Related Documentation

- [Schema Overview](../schema-overview.md) - Complete database schema and ER diagrams
- [RLS Policies](../rls-policies.md) - Comprehensive RLS policy reference
- [Migration Guide](../../guides/database/migration-guide.md) - How to create migrations
- [Event Sourcing](../../../architecture/data/event-sourcing-overview.md) - CQRS pattern explanation

## See Also

- **Related Tables**: [List related tables with links]
- **AsyncAPI Contracts**: `infrastructure/supabase/contracts/asyncapi/domains/[domain].yaml`
- **Database Functions**: [List relevant functions](../functions/)
- **Triggers**: [List relevant triggers](../triggers.md)

---

**Last Updated**: YYYY-MM-DD
**Applies To**: Database schema v[X.Y.Z]
**Status**: current
