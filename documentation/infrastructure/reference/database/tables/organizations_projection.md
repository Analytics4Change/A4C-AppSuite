---
status: current
last_updated: 2025-01-13
---

# organizations_projection

## Overview

The `organizations_projection` table maintains a hierarchical organizational structure using PostgreSQL's ltree extension. This is a CQRS projection maintained by organization event processors, with the source of truth being `organization.*` events in the `domain_events` table.

Organizations can be of three types:
- **platform_owner**: Analytics4Change (A4C) - the platform owner
- **provider**: Healthcare organizations (hospitals, clinics, treatment centers)
- **provider_partner**: Value-added resellers (VARs), family organizations, courts, or other partner organizations

The table supports multi-level organizational hierarchies with parent-child relationships tracked via ltree paths.

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | - | Primary key |
| name | text | NO | - | Organization legal/official name |
| display_name | text | YES | - | User-friendly display name |
| slug | text | NO | - | URL-friendly identifier for routing (unique) |
| zitadel_org_id | text | YES | - | Legacy Zitadel Organization ID (NULL for sub-organizations) |
| type | text | NO | - | Organization type (platform_owner, provider, provider_partner) |
| path | ltree | NO | - | Hierarchical path (e.g., root.org_acme_healthcare.north_campus) |
| parent_path | ltree | YES | - | Parent organization ltree path (NULL for root organizations) |
| depth | integer | - | GENERATED | Computed depth in hierarchy (2 = root, 3+ = sub-orgs) |
| tax_number | text | YES | - | Tax identification number |
| phone_number | text | YES | - | Primary contact phone number |
| timezone | text | YES | 'America/New_York' | Organization timezone |
| metadata | jsonb | YES | '{}' | Additional custom metadata |
| is_active | boolean | YES | true | Organization active status |
| deactivated_at | timestamptz | YES | - | Deactivation timestamp |
| deactivation_reason | text | YES | - | Reason for deactivation |
| deleted_at | timestamptz | YES | - | Logical deletion timestamp (soft delete) |
| deletion_reason | text | YES | - | Reason for deletion |
| created_at | timestamptz | NO | - | Record creation timestamp |
| updated_at | timestamptz | YES | NOW() | Record update timestamp |

### Column Details

#### id
- **Type**: `uuid`
- **Purpose**: Unique identifier for each organization
- **Constraints**: PRIMARY KEY
- **Usage**: Referenced by all multi-tenant tables via `organization_id` foreign keys

#### path
- **Type**: `ltree`
- **Purpose**: Hierarchical path enabling tree queries
- **Format**: `root.org_name.sub_org.sub_sub_org`
- **Example**: `root.org_acme_healthcare.north_campus.pediatric_unit`
- **Constraints**: UNIQUE, NOT NULL
- **Performance**: Indexed with GIST and BTREE for efficient hierarchy queries

#### parent_path
- **Type**: `ltree`
- **Purpose**: Reference to parent organization's path
- **Value**: NULL for root organizations (depth = 2)
- **Usage**: Enables ancestor/descendant queries

#### depth
- **Type**: `integer`
- **Purpose**: Computed depth in organizational hierarchy
- **Calculation**: `nlevel(path)` (number of labels in path)
- **Values**:
  - `1`: Reserved for 'root' label
  - `2`: Root organizations (platform_owner, top-level providers)
  - `3+`: Sub-organizations (campuses, departments, teams)
- **Storage**: GENERATED ALWAYS AS (nlevel(path)) STORED

#### type
- **Type**: `text`
- **Purpose**: Categorize organization role in platform
- **Allowed Values**:
  - `platform_owner`: Analytics4Change (A4C) - single platform owner
  - `provider`: Healthcare organizations
  - `provider_partner`: VARs, family organizations, courts, partners
- **Constraints**: CHECK constraint enforces enumeration
- **Impact**: Affects available features and permissions

#### zitadel_org_id
- **Type**: `text`
- **Purpose**: Legacy mapping to deprecated Zitadel organizations
- **Status**: DEPRECATED (Zitadel migrated to Supabase Auth in October 2025)
- **Value**: NULL for sub-organizations created after migration
- **Constraints**: UNIQUE where not NULL
- **Future**: Will be removed in future schema cleanup

#### is_active
- **Type**: `boolean`
- **Purpose**: Control organization access to platform
- **Default**: `true`
- **Impact**:
  - Inactive organizations cannot authenticate
  - Role assignments disabled
  - Workflows suspended
- **Audit**: Set `deactivated_at` and `deactivation_reason` when changing to false

#### deleted_at
- **Type**: `timestamptz`
- **Purpose**: Soft delete timestamp (organizations never physically deleted)
- **Value**: NULL for active organizations
- **Impact**: Deleted organizations excluded from queries but preserved for audit
- **Audit**: Set `deletion_reason` when soft deleting

## Relationships

### Parent Relationships (Foreign Keys)

**None** - This is a root table in the multi-tenant hierarchy

### Child Relationships (Referenced By)

- **organization_business_profiles_projection** ← `organization_id`
  - One-to-one relationship
  - Business metadata for organizations
  - Cascade behavior: ON DELETE CASCADE

- **programs_projection** ← `organization_id`
  - One-to-many relationship
  - Programs offered by organization
  - Cascade behavior: ON DELETE CASCADE

- **users** ← `organization_id`
  - One-to-many relationship
  - Users belonging to organization
  - Cascade behavior: ON DELETE CASCADE (prevents orphaned users)

- **clients** ← `organization_id`
  - One-to-many relationship
  - Client/patient records
  - Cascade behavior: ON DELETE CASCADE

- **invitations_projection** ← `organization_id`
  - One-to-many relationship
  - Pending user invitations
  - Cascade behavior: ON DELETE CASCADE

- **cross_tenant_access_grants_projection** ← `organization_id` AND `granted_to_organization_id`
  - Many-to-many self-relationship
  - Cross-organizational access permissions
  - Enables partner organization collaboration

### Hierarchical Self-Relationship

- **organizations_projection.parent_path** → **organizations_projection.path**
  - Self-referencing hierarchy via ltree paths
  - Root organizations: `parent_path IS NULL`
  - Sub-organizations: `parent_path = <parent org path>`
  - Enables ancestor/descendant queries
  - No explicit foreign key (managed by application logic)

## Indexes

### Primary Index
```sql
PRIMARY KEY (id)
```
- **Purpose**: Fast lookups by organization ID
- **Performance**: O(log n) lookups
- **Usage**: Referenced by all multi-tenant foreign keys

### Ltree Hierarchy Indexes

#### idx_organizations_path_gist
```sql
CREATE INDEX idx_organizations_path_gist ON organizations_projection USING GIST (path);
```
- **Purpose**: Hierarchical queries (ancestors, descendants, subtrees)
- **Usage**:
  - Find all child organizations: `WHERE path <@ 'root.org_acme_healthcare'`
  - Find all ancestors: `WHERE 'root.org_acme.north.pediatric' @ path`
- **Performance**: Enables efficient tree traversal

#### idx_organizations_path_btree
```sql
CREATE INDEX idx_organizations_path_btree ON organizations_projection USING BTREE (path);
```
- **Purpose**: Exact path lookups and range scans
- **Usage**: `WHERE path = 'root.org_acme_healthcare.north_campus'`
- **Performance**: Faster than GIST for exact matches

#### idx_organizations_parent_path
```sql
CREATE INDEX idx_organizations_parent_path ON organizations_projection USING GIST (parent_path)
  WHERE parent_path IS NOT NULL;
```
- **Purpose**: Find all direct children of a parent
- **Usage**: `WHERE parent_path = 'root.org_acme_healthcare'`
- **Performance**: Partial index excludes root organizations

### Business Logic Indexes

#### idx_organizations_type
```sql
CREATE INDEX idx_organizations_type ON organizations_projection(type);
```
- **Purpose**: Filter organizations by category
- **Usage**: `WHERE type = 'provider'`
- **Performance**: Enables platform-wide provider queries

#### idx_organizations_zitadel_org
```sql
CREATE INDEX idx_organizations_zitadel_org ON organizations_projection(zitadel_org_id)
  WHERE zitadel_org_id IS NOT NULL;
```
- **Purpose**: Legacy Zitadel ID lookups during migration period
- **Status**: DEPRECATED - will be removed
- **Usage**: Zitadel sync operations (no longer active)
- **Performance**: Partial index ignores NULL values

#### idx_organizations_active
```sql
CREATE INDEX idx_organizations_active ON organizations_projection(is_active)
  WHERE is_active = true;
```
- **Purpose**: Filter to active organizations
- **Usage**: Authentication, role assignment queries
- **Performance**: Partial index optimizes common case

#### idx_organizations_deleted
```sql
CREATE INDEX idx_organizations_deleted ON organizations_projection(deleted_at)
  WHERE deleted_at IS NULL;
```
- **Purpose**: Exclude soft-deleted organizations
- **Usage**: All production queries (deleted orgs excluded)
- **Performance**: Partial index for non-deleted rows

## RLS Policies

### enable_rls
```sql
ALTER TABLE organizations_projection ENABLE ROW LEVEL SECURITY;
```

**Purpose**: Enforce multi-tenant data isolation at database level

### SELECT Policy: organizations_super_admin_all

```sql
DROP POLICY IF EXISTS organizations_super_admin_all ON organizations_projection;
CREATE POLICY organizations_super_admin_all
  ON organizations_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));
```

**Purpose**: Super administrators can view/manage all organizations across all tenants

**Logic**:
- Calls `is_super_admin(user_id)` function
- Checks if user has `super_admin` role
- Bypasses all tenant isolation

**Testing**:
```sql
-- Test as super admin (should see all organizations)
SET request.jwt.claim.user_id = '<super-admin-uuid>';
SELECT COUNT(*) FROM organizations_projection;  -- All orgs
```

### SELECT Policy: organizations_org_admin_select

```sql
DROP POLICY IF EXISTS organizations_org_admin_select ON organizations_projection;
CREATE POLICY organizations_org_admin_select
  ON organizations_projection
  FOR SELECT
  USING (is_org_admin(get_current_user_id(), id));
```

**Purpose**: Organization administrators can view their own organization details

**Logic**:
- Calls `is_org_admin(user_id, org_id)` function
- Checks if user has `org_admin` role for this specific organization
- Returns true only for user's assigned organization

**Testing**:
```sql
-- Test as org admin (should only see own organization)
SET request.jwt.claim.user_id = '<org-admin-uuid>';
SET request.jwt.claim.org_id = '<organization-uuid>';
SELECT * FROM organizations_projection;  -- Only assigned org
```

**Security Note**: Regular users (non-admins) cannot directly query this table. Organization context is provided via JWT claims in application queries.

## Constraints

### Unique Constraints

```sql
UNIQUE (slug)
UNIQUE (path)
UNIQUE (zitadel_org_id)  -- Only where NOT NULL
```

**slug uniqueness**:
- **Purpose**: Ensure globally unique URL identifiers
- **Format**: lowercase-kebab-case (e.g., `acme-healthcare`)
- **Usage**: Routing, subdomain generation

**path uniqueness**:
- **Purpose**: Prevent duplicate hierarchical paths
- **Enforcement**: ltree path must be globally unique
- **Example violation**: Two orgs with path `root.org_acme_healthcare`

### Check Constraints

```sql
CHECK (type IN ('platform_owner', 'provider', 'provider_partner'))
```
- **Purpose**: Enforce valid organization types
- **Error**: `new row for relation "organizations_projection" violates check constraint`
- **Solution**: Use only allowed type values

```sql
CHECK (
  (nlevel(path) = 2 AND parent_path IS NULL)
  OR
  (nlevel(path) > 2 AND parent_path IS NOT NULL)
)
```
- **Purpose**: Enforce hierarchical integrity
- **Logic**:
  - Root organizations (depth 2): Must have NULL parent_path
  - Sub-organizations (depth > 2): Must have parent_path
- **Example**: Path `root.org_acme` (depth 2) requires `parent_path IS NULL`
- **Example**: Path `root.org_acme.north` (depth 3) requires `parent_path = 'root.org_acme'`

## Triggers

### None Currently

**Rationale**: This table is a CQRS projection maintained by event processors in the application layer, not by database triggers.

**Event Processing**: Updates are handled by Temporal workflows and Edge Functions that emit domain events, which are then processed to update this projection.

## Usage Examples

### Create a Root Organization

```sql
INSERT INTO organizations_projection (
  id,
  name,
  display_name,
  slug,
  type,
  path,
  parent_path,
  created_at
) VALUES (
  gen_random_uuid(),
  'Acme Healthcare',
  'Acme Healthcare',
  'acme-healthcare',
  'provider',
  'root.org_acme_healthcare',
  NULL,  -- Root organization
  NOW()
) RETURNING *;
```

**Returns**: The newly created root organization with generated ID

### Create a Sub-Organization

```sql
INSERT INTO organizations_projection (
  id,
  name,
  display_name,
  slug,
  type,
  path,
  parent_path,
  created_at
) VALUES (
  gen_random_uuid(),
  'North Campus',
  'North Campus',
  'north-campus',
  'provider',
  'root.org_acme_healthcare.north_campus',
  'root.org_acme_healthcare',  -- Parent path
  NOW()
) RETURNING *;
```

### Query All Organizations

```sql
-- With RLS policies, super admins see all, org admins see only their org
SELECT
  id,
  name,
  type,
  path,
  depth,
  is_active
FROM organizations_projection
WHERE deleted_at IS NULL
ORDER BY path;
```

### Find All Child Organizations

```sql
-- Find all descendants of a specific organization (using ltree)
SELECT
  id,
  name,
  path,
  depth,
  nlevel(path) - nlevel('root.org_acme_healthcare') AS levels_below
FROM organizations_projection
WHERE path <@ 'root.org_acme_healthcare'  -- <@ means "is descendant of"
  AND path != 'root.org_acme_healthcare'   -- Exclude self
  AND deleted_at IS NULL
ORDER BY path;
```

**Example Result**:
```
| id | name | path | depth | levels_below |
|----|------|------|-------|--------------|
| ... | North Campus | root.org_acme_healthcare.north_campus | 3 | 1 |
| ... | South Campus | root.org_acme_healthcare.south_campus | 3 | 1 |
| ... | Pediatrics | root.org_acme_healthcare.north_campus.pediatrics | 4 | 2 |
```

### Find All Ancestors

```sql
-- Find all ancestors of a specific organization
SELECT
  id,
  name,
  path,
  depth
FROM organizations_projection
WHERE 'root.org_acme_healthcare.north_campus.pediatrics' @ path  -- @ means "is ancestor of"
  AND deleted_at IS NULL
ORDER BY depth;
```

**Example Result**:
```
| id | name | path | depth |
|----|------|------|-------|
| ... | Platform Root | root | 1 |
| ... | Acme Healthcare | root.org_acme_healthcare | 2 |
| ... | North Campus | root.org_acme_healthcare.north_campus | 3 |
```

### Find Direct Children Only

```sql
-- Find immediate child organizations (not grandchildren)
SELECT
  id,
  name,
  path,
  depth
FROM organizations_projection
WHERE parent_path = 'root.org_acme_healthcare'
  AND deleted_at IS NULL
ORDER BY name;
```

### Update Organization

```sql
UPDATE organizations_projection
SET
  display_name = 'Acme Healthcare System',
  updated_at = NOW()
WHERE id = '<organization-uuid>';
```

### Soft Delete Organization

```sql
-- Soft delete (preserves for audit trail)
UPDATE organizations_projection
SET
  deleted_at = NOW(),
  deletion_reason = 'Merged into parent organization',
  is_active = false,
  updated_at = NOW()
WHERE id = '<organization-uuid>';
```

**Warning**: Cascading deletes will soft-delete all child organizations, users, clients, and related records.

### Deactivate Organization

```sql
-- Temporarily deactivate (can be reactivated)
UPDATE organizations_projection
SET
  is_active = false,
  deactivated_at = NOW(),
  deactivation_reason = 'Pending compliance review',
  updated_at = NOW()
WHERE id = '<organization-uuid>';
```

### Common Queries

#### Count Organizations by Type

```sql
SELECT
  type,
  COUNT(*) as org_count,
  COUNT(*) FILTER (WHERE is_active) as active_count
FROM organizations_projection
WHERE deleted_at IS NULL
GROUP BY type
ORDER BY type;
```

#### Find Organization Hierarchy Depth

```sql
SELECT
  depth,
  COUNT(*) as org_count
FROM organizations_projection
WHERE deleted_at IS NULL
GROUP BY depth
ORDER BY depth;
```

#### Search Organizations by Name

```sql
SELECT
  id,
  name,
  display_name,
  path,
  type
FROM organizations_projection
WHERE (name ILIKE '%healthcare%' OR display_name ILIKE '%healthcare%')
  AND deleted_at IS NULL
  AND is_active = true
ORDER BY name
LIMIT 20;
```

## Audit Trail

### Event Emission

This table participates in the CQRS event-driven architecture:

- **Events Emitted**:
  - `organization.organization_created` - When new organization created
  - `organization.organization_updated` - When organization details modified
  - `organization.organization_activated` - When organization activated
  - `organization.organization_deactivated` - When organization deactivated
  - `organization.organization_deleted` - When organization soft deleted

- **Event Data**: See AsyncAPI schema in `infrastructure/supabase/contracts/asyncapi/domains/organization.yaml`

- **Event Processing**: Temporal workflows and Edge Functions emit events to `domain_events` table, which are processed by event handlers to update this projection

### Audit Log Integration

- Changes can be tracked via `updated_at` timestamp
- Deletion tracked via `deleted_at` and `deletion_reason`
- Deactivation tracked via `deactivated_at` and `deactivation_reason`
- For complete audit trail, query `domain_events` table filtering by `stream_id = <organization_id>`

## JSONB Columns

### metadata

**Purpose**: Store additional custom organization metadata that doesn't warrant dedicated columns

**Schema**: Flexible - no enforced schema (application-level validation)

**Example Value**:
```json
{
  "branding": {
    "primary_color": "#003366",
    "logo_url": "https://cdn.example.com/logos/acme.png"
  },
  "settings": {
    "allow_self_registration": false,
    "require_2fa": true
  },
  "external_ids": {
    "npi": "1234567890",
    "dea": "AB1234567"
  }
}
```

**Validation**: Performed at application layer (Edge Functions, Temporal workflows)

**Indexing**: No GIN/GIST indexes currently - add if querying metadata frequently:
```sql
CREATE INDEX idx_organizations_metadata ON organizations_projection USING GIN (metadata);
```

## Migration History

### Initial Creation
- **Date**: 2024-10-15 (estimated)
- **Migration**: `001-organizations_projection.sql`
- **Purpose**: Initial CQRS projection table for organizational hierarchy

### Schema Changes
- **Date**: 2024-11-03 (estimated)
- **Migration**: `003-add-subdomain-columns.sql`
- **Changes**: Added subdomain provisioning columns
- **Reason**: Support custom subdomains for organizations

- **Date**: 2025-01-12 (estimated)
- **Migration**: `add_tags_column.sql`
- **Changes**: Added tags column for categorization
- **Reason**: Enable flexible organization tagging and filtering

## Performance Considerations

### Query Performance
- **Expected row count**: 100-1,000 organizations in typical deployment
- **Growth rate**: Slow (new organizations monthly, not daily)
- **Hot paths**:
  - Lookup by ID (primary key) - extremely fast
  - Hierarchy queries (ltree with GIST index) - fast
  - Type filtering (indexed) - fast
- **Optimization strategies**:
  - Use ltree operators for hierarchy queries (<@, @, ~, @>)
  - Partial indexes on is_active and deleted_at reduce index size

### Index Strategy
- **ltree indexes (GIST + BTREE)**: Enable efficient hierarchy traversal
- **Partial indexes**: Reduce index size by excluding deleted/inactive orgs
- **Trade-offs**:
  - Write performance slightly slower due to multiple indexes
  - Read performance significantly improved for common queries
- **Maintenance**: VACUUM regularly due to updates; REINDEX if performance degrades

## Security Considerations

### Data Sensitivity
- **Sensitivity Level**: INTERNAL
- **PII/PHI**: Contains organization names and contact info (not patient data)
- **Compliance**:
  - Organizational data may be subject to business confidentiality
  - No direct HIPAA/PHI concerns
  - GDPR applies if EU organizations present

### Access Control
- **RLS policies**: Enforce multi-tenant isolation
- **Super admin bypass**: Platform administrators can view all organizations
- **Org admin access**: Organization administrators can only view their own org
- **Regular users**: No direct access (organization context via JWT claims)

### Encryption
- **At-rest encryption**: Handled by PostgreSQL/Supabase (AES-256)
- **In-transit encryption**: TLS/SSL connections required
- **Column-level encryption**: Not required (no sensitive PII)

## Troubleshooting

### Common Issues

#### RLS Policy Errors
**Symptom**: `new row violates row-level security policy`

**Cause**: Trying to insert organization without super_admin or org_admin role

**Solution**:
```sql
-- Verify current user role
SELECT is_super_admin(get_current_user_id());
SELECT is_org_admin(get_current_user_id(), '<org-uuid>');
```

#### Unique Constraint Violations
**Symptom**: `duplicate key value violates unique constraint "organizations_projection_slug_key"`

**Cause**: Attempting to create organization with existing slug

**Solution**: Generate unique slug or query existing:
```sql
SELECT id, name, slug FROM organizations_projection WHERE slug = 'acme-healthcare';
```

#### Hierarchy Check Constraint Violations
**Symptom**: `new row for relation "organizations_projection" violates check constraint`

**Cause**: Mismatch between path depth and parent_path (e.g., depth 2 with non-NULL parent_path)

**Solution**: Ensure root orgs (depth 2) have NULL parent_path, sub-orgs (depth > 2) have parent_path

**Example Fix**:
```sql
-- Root organization (depth 2)
INSERT INTO organizations_projection (..., path, parent_path, ...)
VALUES (..., 'root.org_acme', NULL, ...);  -- ✅ Correct

-- Sub-organization (depth 3)
INSERT INTO organizations_projection (..., path, parent_path, ...)
VALUES (..., 'root.org_acme.north', 'root.org_acme', ...);  -- ✅ Correct
```

### Performance Issues

#### Slow Hierarchy Queries
**Symptom**: Ltree queries taking > 100ms

**Diagnosis**:
```sql
EXPLAIN ANALYZE
SELECT * FROM organizations_projection
WHERE path <@ 'root.org_acme_healthcare';
```

**Expected Plan**: Should use `idx_organizations_path_gist` index

**Solution**:
- Verify GIST index exists: `\d organizations_projection`
- REINDEX if needed: `REINDEX INDEX idx_organizations_path_gist;`
- VACUUM table: `VACUUM ANALYZE organizations_projection;`

## Related Documentation

- [Schema Overview](../schema-overview.md) - Complete database schema and ER diagrams
- [RLS Policies](../rls-policies.md) - Comprehensive RLS policy reference
- [Migration Guide](../../guides/database/migration-guide.md) - How to create migrations
- [Event Sourcing](../../../architecture/data/event-sourcing-overview.md) - CQRS pattern explanation
- [Multi-Tenancy Architecture](../../../architecture/data/multi-tenancy-architecture.md) - Organizational isolation design

## See Also

- **Related Tables**:
  - [organization_business_profiles_projection](organization_business_profiles_projection.md) - Business metadata
  - [users](users.md) - User accounts
  - [clients](clients.md) - Patient records
- **AsyncAPI Contracts**: `infrastructure/supabase/contracts/asyncapi/domains/organization.yaml`
- **Database Functions**:
  - [is_super_admin()](../functions/authorization.md#is_super_admin)
  - [is_org_admin()](../functions/authorization.md#is_org_admin)
- **Ltree Documentation**: [PostgreSQL ltree](https://www.postgresql.org/docs/current/ltree.html)

---

**Last Updated**: 2025-01-12
**Applies To**: Database schema v1.0.0
**Status**: current
