---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection for sub-organization hierarchy (regions, campuses, departments, teams) using PostgreSQL ltree. OUs have depth > 2 (orgs have depth = 2). Deactivation cascades to descendants. Deletion requires inactive status and no role assignments. RLS enforces scope_path-based access.

**When to read**:
- Building organization unit management UI with tree navigation
- Implementing hierarchical scope-based authorization
- Understanding ltree path queries for ancestor/descendant operations
- Debugging cascade deactivation or role assignment validation

**Prerequisites**: [organizations_projection](./organizations_projection.md), [user_roles_projection](./user_roles_projection.md)

**Key topics**: `organization-units`, `ltree`, `hierarchy`, `cascade-deactivation`, `scope-path`, `rls-policies`

**Estimated read time**: 15 minutes
<!-- TL;DR-END -->

# organization_units_projection

## Overview

The `organization_units_projection` table maintains sub-organization hierarchy within a provider's organizational structure using PostgreSQL's ltree extension. This is a CQRS projection maintained by the `process_organization_unit_event()` function, with the source of truth being `organization_unit.*` events in the `domain_events` table.

Organization Units (OUs) are sub-divisions within a provider organization:
- **Regions** (e.g., "Northern Region", "Southern Region")
- **Campuses** (e.g., "Oak Street Group Home", "Main Campus")
- **Departments** (e.g., "Pediatrics", "Emergency")
- **Teams** (e.g., "Night Shift", "Intake Team")

Key difference from `organizations_projection`:
- Organizations have `depth = 2` (root level)
- Organization Units have `depth > 2` (sub-organization level)
- OUs always belong to a root organization via `organization_id`

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | - | Primary key |
| organization_id | uuid | NO | - | FK to root organization (provider) this unit belongs to |
| name | text | NO | - | Human-readable organization unit name |
| display_name | text | YES | - | Display name for UI (may differ from name) |
| slug | text | NO | - | ltree-safe identifier (a-z, 0-9, underscore only) |
| path | ltree | NO | - | Full hierarchical path (e.g., root.org_acme.north_campus.pediatrics) |
| parent_path | ltree | NO | - | Direct parent ltree path (required for all OUs) |
| depth | integer | - | GENERATED | Computed depth in hierarchy (always > 2) |
| timezone | text | YES | 'America/New_York' | Organization unit timezone |
| is_active | boolean | YES | true | OU active status - when false, role assignments blocked |
| deactivated_at | timestamptz | YES | - | Deactivation timestamp (cascade sets on children) |
| deleted_at | timestamptz | YES | - | Soft deletion timestamp (OUs never physically deleted) |
| created_at | timestamptz | NO | NOW() | Record creation timestamp |
| updated_at | timestamptz | NO | NOW() | Record update timestamp |

### Column Details

#### organization_id
- **Type**: `uuid`
- **Purpose**: Links OU to its root organization (provider)
- **Constraints**: NOT NULL, FOREIGN KEY to `organizations_projection(id)`
- **Usage**: Multi-tenant isolation - all OUs belong to exactly one provider

#### path
- **Type**: `ltree`
- **Purpose**: Hierarchical path enabling tree queries
- **Format**: `root.org_slug.unit_slug.sub_unit_slug`
- **Example**: `root.org_acme_healthcare.north_campus.pediatrics`
- **Constraints**: UNIQUE, NOT NULL
- **Check**: Last segment must equal `slug` (`path_ends_with_slug`)

#### parent_path
- **Type**: `ltree`
- **Purpose**: Reference to direct parent organization/unit path
- **Constraints**: NOT NULL (unlike `organizations_projection` where root has NULL)
- **Check**: `path <@ parent_path` and `nlevel(path) = nlevel(parent_path) + 1`
- **Usage**: Enables parent-child relationships and tree navigation

#### depth
- **Type**: `integer`
- **Purpose**: Computed depth in organizational hierarchy
- **Calculation**: `nlevel(path)` (number of labels in path)
- **Values**: Always > 2 (enforced by `valid_ou_depth` constraint)
  - `3`: First-level OUs (e.g., regions, campuses)
  - `4+`: Nested OUs (e.g., departments within campuses)
- **Storage**: GENERATED ALWAYS AS (nlevel(path)) STORED

#### is_active
- **Type**: `boolean`
- **Purpose**: Control whether role assignments can be made to this OU
- **Default**: `true`
- **Impact**:
  - Inactive OUs block new role assignments (via `validate_role_scope_path_active` trigger)
  - Deactivation cascades to all descendant OUs
  - Reactivation also cascades to all descendant OUs
- **Audit**: Sets `deactivated_at` when changing to false

#### deleted_at
- **Type**: `timestamptz`
- **Purpose**: Soft delete timestamp (OUs never physically deleted)
- **Prerequisites**: OU must be inactive and have no role assignments
- **Impact**: Deleted OUs excluded from queries but preserved for audit

## Relationships

### Parent Relationships (Foreign Keys)

- **organizations_projection** ← `organization_id`
  - Many-to-one relationship
  - Root organization that owns this OU
  - Cascade behavior: ON DELETE (implicit via RLS)

### Hierarchical Self-Relationship

- **organization_units_projection.parent_path** → **path**
  - Self-referencing hierarchy via ltree paths
  - All OUs have a parent (either organization or another OU)
  - Enables ancestor/descendant queries

### Child Relationships (Referenced By)

- **user_roles_projection** ← `scope_path`
  - Role assignments scoped to this OU
  - Checked before deletion (prevents delete if roles exist)
  - Note: Uses hard-delete, not soft-delete

## Indexes

### Primary Index
```sql
PRIMARY KEY (id)
```

### Unique Constraint
```sql
UNIQUE (path)  -- organization_units_projection_path_key
```

### Ltree Hierarchy Indexes

```sql
-- GIST index for hierarchy queries (ancestors, descendants, subtrees)
CREATE INDEX idx_ou_path_gist ON organization_units_projection USING GIST (path);

-- BTREE index for exact path lookups
CREATE INDEX idx_ou_path_btree ON organization_units_projection USING BTREE (path);

-- Parent path indexes for finding children
CREATE INDEX idx_ou_parent_path_gist ON organization_units_projection USING GIST (parent_path);
CREATE INDEX idx_ou_parent_path_btree ON organization_units_projection USING BTREE (parent_path);
```

### Business Logic Indexes

```sql
-- Organization membership
CREATE INDEX idx_ou_organization_id ON organization_units_projection(organization_id);

-- Slug lookups
CREATE INDEX idx_ou_slug ON organization_units_projection(slug);

-- Active units (partial index)
CREATE INDEX idx_ou_active ON organization_units_projection(is_active) WHERE is_active = true;

-- Non-deleted units (partial index)
CREATE INDEX idx_ou_deleted ON organization_units_projection(deleted_at) WHERE deleted_at IS NULL;
```

## RLS Policies

### enable_rls
```sql
ALTER TABLE organization_units_projection ENABLE ROW LEVEL SECURITY;
```

### Policy: ou_super_admin_all
```sql
CREATE POLICY ou_super_admin_all ON organization_units_projection
  USING (is_super_admin(get_current_user_id()));
```
**Purpose**: Super administrators have full access to all organization units across all tenants.

### Policy: ou_org_admin_select
```sql
CREATE POLICY ou_org_admin_select ON organization_units_projection
  FOR SELECT
  USING (organization_id IS NOT NULL AND is_org_admin(get_current_user_id(), organization_id));
```
**Purpose**: Organization admins can view all OUs within their organization.

### Policy: ou_scope_select
```sql
CREATE POLICY ou_scope_select ON organization_units_projection
  FOR SELECT
  USING (get_current_scope_path() IS NOT NULL AND get_current_scope_path() @> path);
```
**Purpose**: Users can view OUs within their `scope_path` hierarchy (from JWT claims).

### Policy: ou_scope_insert
```sql
CREATE POLICY ou_scope_insert ON organization_units_projection
  FOR INSERT
  WITH CHECK (get_current_scope_path() IS NOT NULL AND get_current_scope_path() @> path);
```
**Purpose**: Users can create OUs within their scope_path hierarchy.

### Policy: ou_scope_update
```sql
CREATE POLICY ou_scope_update ON organization_units_projection
  FOR UPDATE
  USING (get_current_scope_path() IS NOT NULL AND get_current_scope_path() @> path)
  WITH CHECK (get_current_scope_path() IS NOT NULL AND get_current_scope_path() @> path);
```
**Purpose**: Users can update OUs within their scope_path hierarchy.

### Policy: ou_scope_delete
```sql
CREATE POLICY ou_scope_delete ON organization_units_projection
  FOR DELETE
  USING (get_current_scope_path() IS NOT NULL AND get_current_scope_path() @> path);
```
**Purpose**: Users can delete OUs within their scope_path (child/role validation in RPC).

## Constraints

### Check Constraints

```sql
-- Path must end with slug
CONSTRAINT path_ends_with_slug CHECK (subpath(path, nlevel(path) - 1, 1)::text = slug)

-- Depth must be > 1 (i.e., > 2 when counting from root)
CONSTRAINT valid_ou_depth CHECK (nlevel(path) > 1)

-- Parent path must exist and be exactly one level above
CONSTRAINT valid_parent_path CHECK (
  parent_path IS NOT NULL
  AND path <@ parent_path
  AND nlevel(path) = nlevel(parent_path) + 1
)

-- Slug must be ltree-safe
CONSTRAINT valid_slug CHECK (slug ~ '^[a-z0-9_]+$')
```

## Triggers

### None on this table directly

**Rationale**: This table is a CQRS projection maintained by the `process_organization_unit_event()` function. Events are emitted by RPC functions in the `api` schema, and the event processor updates this projection.

**Related Trigger** (on `user_roles_projection`):
- `validate_role_scope_path_active`: Prevents role assignments to inactive OUs

## API Functions

### api.create_organization_unit
Creates a new organization unit and emits `organization_unit.created` event.

### api.update_organization_unit
Updates OU fields (name, display_name, timezone) and emits `organization_unit.updated` event.

### api.deactivate_organization_unit
Deactivates OU and all descendants (cascade), emits `organization_unit.deactivated` event.

### api.reactivate_organization_unit
Reactivates OU and all descendants (cascade), emits `organization_unit.reactivated` event.

### api.delete_organization_unit
Soft-deletes OU (requires inactive, no children, no roles), emits `organization_unit.deleted` event.

### api.get_organization_units_for_user
Returns all OUs visible to current user based on their scope_path.

### api.get_organization_unit_tree_for_user
Returns hierarchical tree structure with child counts for UI rendering.

## Usage Examples

### Create an Organization Unit

```sql
-- Via RPC function (recommended)
SELECT api.create_organization_unit(
  p_organization_id := 'org-uuid',
  p_name := 'Northern Region',
  p_slug := 'northern_region',
  p_parent_path := 'root.org_acme_healthcare'::ltree,
  p_display_name := 'Northern Region',
  p_timezone := 'America/Chicago'
);
```

### Find All Child Units

```sql
-- Find all descendants of a specific OU
SELECT id, name, path, depth
FROM organization_units_projection
WHERE path <@ 'root.org_acme_healthcare.northern_region'
  AND path != 'root.org_acme_healthcare.northern_region'
  AND deleted_at IS NULL
ORDER BY path;
```

### Find Direct Children Only

```sql
-- Find immediate child units (not grandchildren)
SELECT id, name, path, depth
FROM organization_units_projection
WHERE parent_path = 'root.org_acme_healthcare.northern_region'
  AND deleted_at IS NULL
ORDER BY name;
```

### Cascade Deactivation Pattern

```sql
-- In event processor: batch update using ltree containment
UPDATE organization_units_projection
SET is_active = false, deactivated_at = p_event.created_at
WHERE path <@ (p_event.event_data->>'path')::ltree
  AND is_active = true
  AND deleted_at IS NULL;
```

## Audit Trail

### Events Emitted

- `organization_unit.created` - When new OU created
- `organization_unit.updated` - When OU details modified
- `organization_unit.deactivated` - When OU (and descendants) deactivated
- `organization_unit.reactivated` - When OU (and descendants) reactivated
- `organization_unit.deleted` - When OU soft deleted

### Event Contract

See `infrastructure/supabase/contracts/asyncapi/domains/organization-unit.yaml` for complete event schemas.

### Audit Queries

```sql
-- Who created/modified this OU?
SELECT event_type,
       event_metadata->>'user_id' as actor,
       event_metadata->>'reason' as reason,
       created_at
FROM domain_events
WHERE stream_id = '<ou-uuid>'
  AND stream_type = 'organization_unit'
ORDER BY created_at DESC;
```

## Comparison with organizations_projection

| Aspect | organizations_projection | organization_units_projection |
|--------|--------------------------|-------------------------------|
| Depth | 2 (root level) | > 2 (sub-organization) |
| parent_path | NULL for roots | Always NOT NULL |
| type column | platform_owner, provider, provider_partner | N/A (inherited from parent org) |
| organization_id | Self (id = organization_id) | FK to root organization |
| Soft delete | Uses deleted_at | Uses deleted_at |
| Deactivation cascade | N/A | Cascades to descendants |

## Security Considerations

### Data Sensitivity
- **Sensitivity Level**: INTERNAL
- **PII/PHI**: Contains organizational structure (not patient data)
- **Compliance**: Business confidentiality

### Access Control
- **RLS policies**: Enforce scope-based isolation via JWT `scope_path` claim
- **Super admin bypass**: Platform administrators can access all OUs
- **Org admin access**: Can view all OUs within their organization
- **Regular users**: Can only see OUs within their scope_path

## Related Documentation

- [organizations_projection](organizations_projection.md) - Root organizations
- [user_roles_projection](user_roles_projection.md) - Role assignments with scope
- [Multi-Tenancy Architecture](../../../architecture/data/multi-tenancy-architecture.md)
- [AsyncAPI Contract](../../../../infrastructure/supabase/contracts/asyncapi/domains/organization-unit.yaml)

---

**Last Updated**: 2025-12-24
**Applies To**: Database schema v1.0.0
**Status**: current
