---
status: current
last_updated: 2025-01-13
---

# roles_projection

## Overview

The `roles_projection` table is a **CQRS read model** that stores role definitions for the RBAC (Role-Based Access Control) system. Roles are collections of permissions that can be assigned to users. The table supports two distinct patterns:

1. **System Role** - `super_admin` only - platform-level with `NULL` organization scope (global access)
2. **Organization-Scoped Roles** - All other roles tied to specific organizations with hierarchical scope inheritance via ltree paths

**Built-in Org-Scoped Roles**: `provider_admin`, `partner_admin`, `clinician`, `viewer` are built-in role names that MUST be created with an `organization_id` when assigned. They are not global templates.

This dual-pattern design enables both platform administration (super_admin) and multi-tenant organization management within a single table structure.

**Data Sensitivity**: INTERNAL (access control configuration)
**CQRS Role**: Read model projection (event-sourced)
**Multi-Tenancy**: Hybrid (global templates + org-scoped instances)

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | - | Primary key (role identifier) |
| name | text | NO | - | Role name (unique across platform) |
| description | text | NO | - | Human-readable role purpose explanation |
| organization_id | uuid | YES | NULL | Internal organization UUID (NULL for global roles) |
| org_hierarchy_scope | ltree | YES | NULL | Hierarchical scope path (NULL for global roles) |
| created_at | timestamptz | NO | now() | Role creation timestamp |
| updated_at | timestamptz | YES | NULL | Last modification timestamp |
| deleted_at | timestamptz | YES | NULL | Soft delete timestamp |
| is_active | boolean | YES | true | Active status flag |

### Column Details

#### id
- **Type**: `uuid`
- **Purpose**: Unique identifier for each role
- **Generation**: Assigned from domain event payload
- **Constraints**: PRIMARY KEY
- **Usage**: Referenced by `role_permissions_projection` and `user_roles_projection`

#### name
- **Type**: `text`
- **Purpose**: Role identifier and display name
- **Constraints**: UNIQUE, NOT NULL
- **Patterns**:
  - **System role**: `super_admin` (NULL organization_id)
  - **Built-in org-scoped**: `provider_admin`, `partner_admin`, `clinician`, `viewer` (requires organization_id)
  - **Custom org-scoped**: `nurse`, `facility_admin`, `program_coordinator` (requires organization_id)
- **Case Sensitivity**: Lowercase with underscores (e.g., `facility_admin`)
- **Index**: `idx_roles_name` (BTREE) for fast lookups

#### description
- **Type**: `text`
- **Purpose**: Human-readable explanation of role purpose and capabilities
- **Examples**:
  - `'Platform super administrator with global access'`
  - `'Clinician with client care and medication management permissions'`
  - `'Facility administrator managing staff and operations'`
- **Constraints**: NOT NULL
- **Audience**: Platform admins, organization admins configuring access

#### organization_id
- **Type**: `uuid`
- **Purpose**: Links role to owning organization (NULL for global templates)
- **Nullable**: YES
- **Foreign Key**: References `organizations_projection(id)` (implicit, not enforced for global roles)
- **Index**: `idx_roles_organization_id` (partial WHERE NOT NULL)
- **Scoping Rules**:
  - `NULL` - System role (`super_admin` only - global platform access)
  - `<uuid>` - Organization-scoped role (all other roles including `provider_admin`, `partner_admin`)
- **Multi-Tenancy**: Enables organization-isolated role management

#### org_hierarchy_scope
- **Type**: `ltree` (PostgreSQL hierarchical label tree)
- **Purpose**: Hierarchical scope path for permission inheritance
- **Nullable**: YES (NULL for `super_admin` system role only)
- **Format**: `analytics4change.org_<uuid>.facility_<uuid>.program_<uuid>`
- **Examples**:
  - System role (`super_admin`): `NULL`
  - Org-level (`provider_admin`, `clinician`): `analytics4change.org_123`
  - Facility-level: `analytics4change.org_123.facility_456`
  - Program-level: `analytics4change.org_123.facility_456.program_789`
- **Index**: `idx_roles_hierarchy_scope` (GIST WHERE NOT NULL) for hierarchical queries
- **Operations**:
  - `@>` (ancestor) - Check if role has higher scope than target
  - `<@` (descendant) - Check if role falls under parent scope
  - `~` (match pattern) - Find roles matching hierarchy pattern

#### created_at
- **Type**: `timestamptz`
- **Purpose**: Audit trail - when role was created
- **Default**: `now()`
- **Usage**: Troubleshooting, role lifecycle tracking

#### updated_at
- **Type**: `timestamptz`
- **Purpose**: Last modification timestamp
- **Nullable**: YES (NULL if never updated)
- **Usage**: Track role definition changes (name, description updates)

#### deleted_at
- **Type**: `timestamptz`
- **Purpose**: Soft delete timestamp (preserves historical role assignments)
- **Nullable**: YES (NULL for active roles)
- **Pattern**: Soft delete preserves `user_roles_projection` history
- **Cleanup**: Archived roles can be permanently deleted after retention period

#### is_active
- **Type**: `boolean`
- **Purpose**: Active status flag (quick active/inactive toggle)
- **Default**: `true`
- **Usage**: Temporarily disable role without soft delete
- **RLS**: Typically filter for `is_active = true` in application queries

## Relationships

### Parent Relationships (Foreign Keys)

- **organizations_projection** → `organization_id` (implicit, not enforced)
  - Organization-scoped roles belong to specific organization
  - Global role templates have `NULL` organization_id
  - Deletion behavior: Managed at application level (not database CASCADE)

### Child Relationships (Referenced By)

- **role_permissions_projection** ← `role_id`
  - Many-to-many mapping of permissions to roles
  - One role can have multiple permissions
  - One permission can belong to multiple roles

- **user_roles_projection** ← `role_id`
  - User role assignments (maps users to roles with org scoping)
  - One role can be assigned to multiple users
  - Users can have multiple roles across different organizations

## Indexes

| Index Name | Type | Columns | Purpose | Notes |
|------------|------|---------|---------|-------|
| PRIMARY KEY | BTREE | id | Unique identification | Automatic |
| UNIQUE | BTREE | name | Prevent duplicate role names | Platform-wide uniqueness |
| idx_roles_name | BTREE | name | Role lookup by name | Fast name resolution |
| idx_roles_organization_id | BTREE (partial) | organization_id WHERE NOT NULL | Filter org-scoped roles | Excludes global templates |
| idx_roles_hierarchy_scope | GIST (partial) | org_hierarchy_scope WHERE NOT NULL | Hierarchical scope queries | ltree-specific operations |

### Index Usage Patterns

**Role Lookup by Name**:
```sql
SELECT * FROM roles_projection
WHERE name = 'clinician';
-- Uses: idx_roles_name (or UNIQUE index)
```

**Find Roles for Organization**:
```sql
SELECT * FROM roles_projection
WHERE organization_id = 'org-123'
  AND is_active = true;
-- Uses: idx_roles_organization_id (partial index)
```

**Hierarchical Scope Queries**:
```sql
-- Find all roles with access to specific facility
SELECT * FROM roles_projection
WHERE org_hierarchy_scope @> 'analytics4change.org_123.facility_456'::ltree
  AND is_active = true;
-- Uses: idx_roles_hierarchy_scope (GIST index)
```

## Row-Level Security (RLS)

**Status**: ✅ ENABLED with comprehensive policies

### Policy 1: Super Admin Full Access
```sql
CREATE POLICY roles_super_admin_all
  ON roles_projection FOR ALL
  USING (is_super_admin(get_current_user_id()));
```
- **Purpose**: Platform super administrators have complete access to all roles
- **Operations**: SELECT, INSERT, UPDATE, DELETE
- **Use Case**: Global role management, creating role templates

### Policy 2: Organization Admin Role Management
```sql
CREATE POLICY roles_org_admin_select
  ON roles_projection FOR SELECT
  USING (
    organization_id IS NOT NULL
    AND is_org_admin(get_current_user_id(), organization_id)
  );
```
- **Purpose**: Organization admins can view roles in their organization
- **Operations**: SELECT only (create/update via API with permission checks)
- **Scope**: Only organization-scoped roles (excludes global templates)
- **Function**: `is_org_admin(user_id, org_id)` checks user's admin role assignment

### Policy 3: System Role Visibility (super_admin)
```sql
CREATE POLICY roles_global_select
  ON roles_projection FOR SELECT
  USING (
    organization_id IS NULL
    AND get_current_user_id() IS NOT NULL
  );
```
- **Purpose**: All authenticated users can view the system role (`super_admin`)
- **Operations**: SELECT only
- **Rationale**: Users need to see the platform hierarchy for:
  - Understanding super_admin capabilities
  - Platform administration visibility
- **Security**: Read-only prevents modification
- **Note**: This only returns `super_admin`. Organization-scoped roles (`provider_admin`, etc.) are visible via Policy 2.

### Testing RLS Policies

**Test as Super Admin**:
```sql
SET request.jwt.claims = '{"sub": "super-admin-id", "role": "super_admin"}';

-- Should return ALL roles (global + all org-scoped)
SELECT name, organization_id, org_hierarchy_scope
FROM roles_projection;

-- Should succeed (super_admin can create roles)
INSERT INTO roles_projection (id, name, description, organization_id, org_hierarchy_scope)
VALUES (
  gen_random_uuid(),
  'test_role',
  'Test role',
  'org-123',
  'analytics4change.org_123'::ltree
);
```

**Test as Organization Admin**:
```sql
SET request.jwt.claims = '{"sub": "org-admin-id", "org_id": "org-123", "role": "provider_admin"}';

-- Should return:
-- 1. System role (super_admin only - NULL organization_id)
-- 2. Organization-scoped roles for org-123 (provider_admin, clinician, etc.)
SELECT name, organization_id
FROM roles_projection
ORDER BY organization_id NULLS FIRST, name;

-- Should FAIL (org admins cannot insert via RLS, must use application API)
INSERT INTO roles_projection (...) VALUES (...);
-- ERROR: new row violates row-level security policy
```

**Test as Regular User**:
```sql
SET request.jwt.claims = '{"sub": "user-id", "org_id": "org-456", "role": "clinician"}';

-- Should return system role (super_admin) and roles for org-456 only
SELECT name, organization_id
FROM roles_projection;

-- Returns: super_admin (NULL org), plus any org-456 scoped roles
-- Does NOT return roles from other organizations
```

## Constraints

### Check Constraint: roles_projection_scope_check
```sql
ALTER TABLE roles_projection ADD CONSTRAINT roles_projection_scope_check CHECK (
  (name = 'super_admin'
   AND organization_id IS NULL
   AND org_hierarchy_scope IS NULL)
  OR
  (name <> 'super_admin'
   AND organization_id IS NOT NULL
   AND org_hierarchy_scope IS NOT NULL)
);
```

**Purpose**: Enforces system role vs org-scoped role pattern

**Rules**:
1. **System role** (`super_admin` only):
   - MUST have `organization_id = NULL`
   - MUST have `org_hierarchy_scope = NULL`
   - Has global platform access

2. **Organization-scoped roles** (all others including `provider_admin`, `partner_admin`, `clinician`, `viewer`):
   - MUST have `organization_id = <uuid>`
   - MUST have `org_hierarchy_scope = <ltree>`

**Validation Examples**:
```sql
-- ✅ VALID: System super_admin (only role with NULL org scope)
INSERT INTO roles_projection (id, name, description, organization_id, org_hierarchy_scope)
VALUES (gen_random_uuid(), 'super_admin', 'Platform super admin', NULL, NULL);

-- ✅ VALID: Org-scoped provider_admin role (MUST have org_id)
INSERT INTO roles_projection (id, name, description, organization_id, org_hierarchy_scope)
VALUES (
  gen_random_uuid(),
  'provider_admin',
  'Provider organization administrator',
  'org-123',
  'analytics4change.org_123'::ltree
);

-- ✅ VALID: Org-scoped clinician role
INSERT INTO roles_projection (id, name, description, organization_id, org_hierarchy_scope)
VALUES (
  gen_random_uuid(),
  'clinician',
  'Clinical staff role',
  'org-123',
  'analytics4change.org_123'::ltree
);

-- ❌ INVALID: super_admin with org scope (system role must be global)
INSERT INTO roles_projection (id, name, description, organization_id, org_hierarchy_scope)
VALUES (gen_random_uuid(), 'super_admin', 'Super admin', 'org-123', 'analytics4change.org_123'::ltree);
-- ERROR: new row violates check constraint "roles_projection_scope_check"

-- ❌ INVALID: provider_admin without org_id (built-in roles must have org scope)
INSERT INTO roles_projection (id, name, description, organization_id, org_hierarchy_scope)
VALUES (gen_random_uuid(), 'provider_admin', 'Provider admin', NULL, NULL);
-- ERROR: new row violates check constraint "roles_projection_scope_check"

-- ❌ INVALID: clinician without org_id
INSERT INTO roles_projection (id, name, description, organization_id, org_hierarchy_scope)
VALUES (gen_random_uuid(), 'clinician', 'Clinician', NULL, NULL);
-- ERROR: new row violates check constraint "roles_projection_scope_check"
```

## CQRS Event Sourcing

### Source Events

**Event Types**:
1. `role.created` - New role defined
2. `role.updated` - Role description/properties changed
3. `role.deleted` - Role soft deleted

**Event Payload (role.created)**:
```typescript
{
  event_type: 'role.created',
  aggregate_id: '<role-uuid>',
  aggregate_type: 'role',
  payload: {
    id: '<role-uuid>',
    name: 'clinician',
    description: 'Clinical staff with patient care permissions',
    organization_id: 'org-123',              // NULL for global templates
    org_hierarchy_scope: 'analytics4change.org_123'  // NULL for global
  },
  metadata: {
    user_id: '<admin-uuid>',
    correlation_id: '<uuid>',
    timestamp: '2025-01-13T10:30:00Z'
  }
}
```

### Event Processor

**Function**: `process_rbac_events()` (infrastructure/supabase/sql/03-functions/event-processing/004-process-rbac-events.sql)

**Processing Logic (role.created)**:
```sql
WHEN 'role.created' THEN
  INSERT INTO roles_projection (
    id,
    name,
    description,
    organization_id,
    org_hierarchy_scope,
    created_at,
    is_active
  )
  SELECT
    (event_payload->>'id')::UUID,
    event_payload->>'name',
    event_payload->>'description',
    NULLIF(event_payload->>'organization_id', 'null')::UUID,
    NULLIF(event_payload->>'org_hierarchy_scope', 'null')::LTREE,
    NOW(),
    true
  ON CONFLICT (id) DO NOTHING;
```

**Processing Logic (role.updated)**:
```sql
WHEN 'role.updated' THEN
  UPDATE roles_projection
  SET
    description = event_payload->>'description',
    updated_at = NOW()
  WHERE id = event.aggregate_id;
```

**Processing Logic (role.deleted)**:
```sql
WHEN 'role.deleted' THEN
  UPDATE roles_projection
  SET
    deleted_at = NOW(),
    is_active = false
  WHERE id = event.aggregate_id;
```

**Idempotency**: `ON CONFLICT (id) DO NOTHING` for inserts, WHERE clause for updates

**Trigger**: Executed automatically via `process_domain_event_trigger` on `domain_events` INSERT

## Common Queries

### List All Active Roles for Organization

```sql
SELECT
  id,
  name,
  description,
  organization_id,
  org_hierarchy_scope
FROM roles_projection
WHERE organization_id = 'org-123'
  AND is_active = true
  AND deleted_at IS NULL
ORDER BY name;
```

### Get System Role (super_admin)

```sql
SELECT
  id,
  name,
  description
FROM roles_projection
WHERE organization_id IS NULL
  AND is_active = true
ORDER BY name;
```

**Output**:
```
id                                   | name              | description
-------------------------------------|-------------------|------------------------------------------
uuid-1                               | super_admin       | Platform super administrator with global access
```

**Note**: Only `super_admin` has NULL organization_id. Other built-in roles (`provider_admin`, `partner_admin`) must be created per-organization.

### Find Roles with Facility-Level or Higher Access

```sql
SELECT
  r.id,
  r.name,
  r.description,
  r.org_hierarchy_scope
FROM roles_projection r
WHERE r.org_hierarchy_scope @> 'analytics4change.org_123.facility_456'::ltree
  AND r.is_active = true
ORDER BY r.org_hierarchy_scope;
```

**Use Case**: Determine which roles can access specific facility

### Count Roles by Organization

```sql
SELECT
  o.name as organization_name,
  COUNT(r.id) as role_count
FROM organizations_projection o
LEFT JOIN roles_projection r ON r.organization_id = o.id AND r.is_active = true
GROUP BY o.id, o.name
ORDER BY role_count DESC;
```

**Use Case**: Organization role coverage analysis

### Find Users with Specific Role

```sql
SELECT
  u.email,
  u.first_name,
  u.last_name,
  r.name as role_name,
  ur.org_id,
  ur.scope_path
FROM users u
JOIN user_roles_projection ur ON ur.user_id = u.id
JOIN roles_projection r ON r.id = ur.role_id
WHERE r.name = 'clinician'
  AND ur.org_id = 'org-123'
  AND r.is_active = true
ORDER BY u.last_name, u.first_name;
```

**Use Case**: Audit role assignments, contact users with specific role

## Usage Examples

### 1. Create System Role (super_admin) - Administrative Only

**Scenario**: System role creation is typically done via seed data, not runtime events.

**Note**: Only `super_admin` can be a system role with NULL organization_id. All other roles (including `provider_admin`, `partner_admin`) must be organization-scoped.

```typescript
// System role (super_admin) is created via seed data, not dynamically
// See: infrastructure/supabase/sql/99-seeds/001-system-roles.sql

// If dynamic creation needed (rare):
async function createSystemRole() {
  const roleId = uuidv4();

  await supabase.from('domain_events').insert({
    event_type: 'role.created',
    aggregate_id: roleId,
    aggregate_type: 'role',
    payload: {
      id: roleId,
      name: 'super_admin',  // Only super_admin can have NULL org
      description: 'Platform super administrator with global access',
      organization_id: null,  // System role - global scope
      org_hierarchy_scope: null
    },
    metadata: {
      user_id: getCurrentUserId(),
      correlation_id: uuidv4()
    }
  });

  return roleId;
}
```

### 2. Create Organization-Scoped Role (via Event)

**Scenario**: Create `facility_admin` role for specific organization

```typescript
// Temporal Activity: CreateOrgScopedRoleActivity
async function createOrgScopedRole(params: {
  name: string;
  description: string;
  organization_id: string;
  scope_path: string;
}) {
  const roleId = uuidv4();

  await supabase.from('domain_events').insert({
    event_type: 'role.created',
    aggregate_id: roleId,
    aggregate_type: 'role',
    payload: {
      id: roleId,
      name: params.name,
      description: params.description,
      organization_id: params.organization_id,
      org_hierarchy_scope: params.scope_path
    },
    metadata: {
      user_id: getCurrentUserId(),
      correlation_id: uuidv4()
    }
  });

  return roleId;
}

// Usage
await createOrgScopedRole({
  name: 'facility_admin',
  description: 'Facility administrator with operational permissions',
  organization_id: 'org-123',
  scope_path: 'analytics4change.org_123.facility_456'
});
```

### 3. Check User's Role in JWT Claims

**Scenario**: Frontend determines user's primary role for UI rendering

```typescript
const { data: { session } } = await supabase.auth.getSession();
const userRole = session?.user?.app_metadata?.role;  // 'clinician', 'super_admin', etc.

if (userRole === 'super_admin') {
  // Show platform-wide admin interface
} else if (userRole === 'provider_admin') {
  // Show organization admin interface
} else if (userRole === 'clinician') {
  // Show clinical operations interface
}
```

**JWT Payload**:
```json
{
  "sub": "user-123",
  "email": "admin@provider.org",
  "org_id": "org-456",
  "role": "provider_admin",
  "scope_path": "analytics4change.org_456"
}
```

### 4. Assign Role to User (via Event)

**Scenario**: Assign 'clinician' role to new user

```typescript
// Temporal Activity: AssignRoleToUserActivity
async function assignRoleToUser(params: {
  user_id: string;
  role_name: string;
  org_id: string | null;
  scope_path: string | null;
}) {
  // Look up role ID
  const { data: role } = await supabase
    .from('roles_projection')
    .select('id, organization_id')
    .eq('name', params.role_name)
    .single();

  if (!role) {
    throw new Error(`Role not found: ${params.role_name}`);
  }

  // Emit domain event
  await supabase.from('domain_events').insert({
    event_type: 'user.role.assigned',
    aggregate_id: params.user_id,
    aggregate_type: 'user',
    payload: {
      user_id: params.user_id,
      role_id: role.id,
      org_id: params.org_id,
      scope_path: params.scope_path
    },
    metadata: {
      user_id: getCurrentUserId(),
      correlation_id: uuidv4()
    }
  });
}

// Usage: Assign org-scoped clinician role
await assignRoleToUser({
  user_id: 'user-789',
  role_name: 'clinician',
  org_id: 'org-123',
  scope_path: 'analytics4change.org_123.facility_456'
});
```

## Audit Trail

### Role Creation History
```sql
SELECT
  name,
  organization_id,
  created_at,
  EXTRACT(epoch FROM (NOW() - created_at)) / 86400 as days_since_creation
FROM roles_projection
ORDER BY created_at DESC
LIMIT 20;
```

### Role Lifecycle Events
```sql
-- Full event history for specific role
SELECT
  de.event_type,
  de.occurred_at,
  de.payload,
  de.metadata
FROM domain_events de
WHERE de.aggregate_type = 'role'
  AND de.aggregate_id = '<role-uuid>'
ORDER BY de.occurred_at;
```

**Events**: `role.created`, `role.updated`, `role.deleted`

## Troubleshooting

### Issue: Role Not Visible to Organization Admin

**Symptoms**: Org admin can't see their organization's roles

**Diagnosis**:
```sql
-- Check role organization_id matches
SELECT
  r.id,
  r.name,
  r.organization_id,
  r.is_active
FROM roles_projection r
WHERE r.organization_id = '<org-uuid>';

-- Check user's org_admin status
SELECT is_org_admin('<user-uuid>', '<org-uuid>');

-- Verify JWT claims contain correct org_id
-- Check: request.jwt.claims->>'org_id'
```

**Common Causes**:
1. Role has different `organization_id` than user's `org_id` in JWT
2. Role is soft deleted (`deleted_at IS NOT NULL`)
3. Role is inactive (`is_active = false`)
4. User is not assigned `provider_admin` or `partner_admin` role

### Issue: System Role (super_admin) Has Org Scope

**Symptoms**: Constraint violation when creating/updating super_admin with org_id

**Error**:
```
ERROR: new row violates check constraint "roles_projection_scope_check"
```

**Resolution**:
```sql
-- Only super_admin should have NULL org fields
-- All other roles (provider_admin, partner_admin, clinician) MUST have org_id
UPDATE roles_projection
SET
  organization_id = NULL,
  org_hierarchy_scope = NULL
WHERE name = 'super_admin';
```

**Note**: If you're getting this error for `provider_admin` or `partner_admin`, those roles **must** have an organization_id. They are not system roles.

### Issue: Organization Role Missing Scope Path

**Symptoms**: Constraint violation when creating org-scoped role

**Error**:
```
ERROR: new row violates check constraint "roles_projection_scope_check"
```

**Resolution**:
```sql
-- Org-scoped roles MUST have both organization_id and org_hierarchy_scope
UPDATE roles_projection
SET
  organization_id = '<org-uuid>',
  org_hierarchy_scope = 'analytics4change.org_<uuid>'::ltree
WHERE name = 'clinician' AND organization_id IS NULL;
```

### Issue: Duplicate Role Name Error

**Symptoms**: Cannot create role with existing name

**Error**:
```
ERROR: duplicate key value violates unique constraint "roles_projection_name_key"
DETAIL: Key (name)=(clinician) already exists.
```

**Diagnosis**:
```sql
-- Find existing role with same name
SELECT * FROM roles_projection WHERE name = 'clinician';
```

**Resolution**:
- Role names are globally unique
- For org-scoped roles, use naming convention: `<role>_<org_name>` (e.g., `clinician_abc_provider`)
- Or reuse existing global template and assign with org scoping via `user_roles_projection`

## Performance Considerations

### Read-Heavy Workload
- **Pattern**: Roles read during authorization checks, role assignment UI
- **Write Pattern**: Rare (only when defining new roles or updating descriptions)
- **Optimization**: All common queries covered by indexes

### Hierarchical Queries
```sql
EXPLAIN ANALYZE
SELECT * FROM roles_projection
WHERE org_hierarchy_scope @> 'analytics4change.org_123.facility_456'::ltree;

-- Expected: Bitmap Index Scan using idx_roles_hierarchy_scope (GIST)
-- Cost: < 5ms for typical organization hierarchy
```

### Caching Strategy
- Frontend: Cache organization's roles in application state
- Backend: PostgreSQL query cache handles repeated queries
- TTL: Roles change rarely, cache for session duration

## Related Tables

- **permissions_projection** - Permission definitions granted to roles
- **role_permissions_projection** - Many-to-many mapping of roles to permissions
- **user_roles_projection** - User role assignments with org scoping
- **organizations_projection** - Organization hierarchy for scope paths
- **domain_events** - Source of truth for role definitions

## Migration History

**Initial Schema**: Created with RBAC system (2024-Q4)

**Schema Changes**:
- Added `roles_projection_scope_check` constraint (2025-01-10) - Enforces global vs org-scoped pattern
- Removed `zitadel_org_id` column (2025-10-27) - Migration from Zitadel to Supabase Auth
- Added `org_hierarchy_scope` ltree column (2024-12-15) - Hierarchical permission scoping
- Added `is_active` boolean flag (2025-01-05) - Soft enable/disable without deletion

## References

- **RLS Policies**: `infrastructure/supabase/sql/06-rls/001-core-projection-policies.sql:117-153`
- **Event Processor**: `infrastructure/supabase/sql/03-functions/event-processing/004-process-rbac-events.sql:35-75`
- **JWT Hook**: `infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql:38-79`
- **Table Definition**: `infrastructure/supabase/sql/02-tables/rbac/002-roles_projection.sql`
- **Scope Check Constraint**: `infrastructure/supabase/sql/02-tables/rbac/002-roles_projection.sql:21-26`
