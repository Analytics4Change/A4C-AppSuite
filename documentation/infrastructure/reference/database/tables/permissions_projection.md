---
status: current
last_updated: 2025-01-13
---

# permissions_projection

## Overview

The `permissions_projection` table is a **CQRS read model** that stores atomic authorization units (permissions) for the RBAC system. Each permission represents a specific action within an applet (e.g., `clients.create`, `medications.view`). This table is populated from `permission.defined` domain events and serves as the foundation for role-based access control throughout the application.

**Data Sensitivity**: INTERNAL (system configuration data)
**CQRS Role**: Read model projection (event-sourced)
**Multi-Tenancy**: Global reference data (not tenant-scoped)

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | - | Primary key (permission identifier) |
| applet | text | NO | - | Application module name (e.g., 'clients', 'medications') |
| action | text | NO | - | Operation name (e.g., 'create', 'view', 'update', 'delete') |
| name | text | NO | GENERATED | Permission identifier: `applet.action` (e.g., 'clients.create') |
| description | text | NO | - | Human-readable explanation of permission purpose |
| scope_type | text | NO | - | Hierarchical scope level (global, org, facility, program, client) |
| requires_mfa | boolean | NO | false | Whether MFA verification is required to use this permission |
| created_at | timestamptz | NO | now() | Permission definition timestamp |

### Column Details

#### id
- **Type**: `uuid`
- **Purpose**: Unique identifier for each permission
- **Generation**: Assigned from domain event payload
- **Constraints**: PRIMARY KEY
- **Usage**: Referenced by `role_permissions_projection` for role-permission mapping

#### applet
- **Type**: `text`
- **Purpose**: Categorizes permissions by application module/feature area
- **Examples**: `'clients'`, `'medications'`, `'organizations'`, `'reports'`
- **Constraints**: NOT NULL, part of UNIQUE constraint with `action`
- **Index**: `idx_permissions_applet` (BTREE) for filtering by module

#### action
- **Type**: `text`
- **Purpose**: Specific operation within an applet
- **Examples**: `'create'`, `'view'`, `'update'`, `'delete'`, `'export'`, `'approve'`
- **Constraints**: NOT NULL, part of UNIQUE constraint with `applet`
- **Pattern**: Typically CRUD operations, but can include custom actions

#### name
- **Type**: `text` (GENERATED ALWAYS)
- **Purpose**: Computed permission identifier for human readability and lookups
- **Formula**: `applet || '.' || action`
- **Examples**: `'clients.create'`, `'medications.view'`, `'reports.export'`
- **Constraints**: STORED (computed column), GENERATED ALWAYS
- **Index**: `idx_permissions_name` (BTREE) for direct permission lookups
- **Usage**: JWT custom claims include permissions array using this format

#### description
- **Type**: `text`
- **Purpose**: Human-readable explanation displayed in UI permission management
- **Examples**:
  - `'Create new client records'`
  - `'View medication catalog and prescriptions'`
  - `'Export client data to CSV'`
- **Constraints**: NOT NULL
- **Audience**: Platform administrators configuring roles

#### scope_type
- **Type**: `text`
- **Purpose**: Defines hierarchical level where permission applies
- **Valid Values**:
  - `'global'` - Platform-wide access (visible only to platform_owner org_type)
  - `'org'` - Organization-level access (visible to all org types)
- **Constraints**: CHECK constraint enforces enum values
- **Index**: `idx_permissions_scope_type` (BTREE) for scope-based filtering
- **Usage**: Used by `api.get_permissions()` to filter permissions based on user's `org_type` JWT claim

#### requires_mfa
- **Type**: `boolean`
- **Purpose**: Flags permissions requiring multi-factor authentication verification
- **Default**: `false`
- **Use Cases**: Sensitive operations (data export, bulk delete, permission grants)
- **Index**: `idx_permissions_requires_mfa` (partial index WHERE true) for MFA-required lookups
- **Future**: Step-up authentication workflow for sensitive actions

#### created_at
- **Type**: `timestamptz`
- **Purpose**: Audit trail - when permission was defined
- **Default**: `now()`
- **Usage**: Troubleshooting, historical analysis of permission evolution

## Relationships

### Parent Relationships (Foreign Keys)

**None** - This is reference data table with no foreign key dependencies.

### Child Relationships (Referenced By)

- **role_permissions_projection** ← `permission_id`
  - Many-to-many junction table mapping permissions to roles
  - One permission can be granted to multiple roles
  - Cascade behavior: Deletion would orphan role assignments (not expected in production)

## Indexes

| Index Name | Type | Columns | Purpose | Notes |
|------------|------|---------|---------|-------|
| PRIMARY KEY | BTREE | id | Unique identification | Automatic |
| UNIQUE | BTREE | (applet, action) | Prevent duplicate permission definitions | Composite key |
| idx_permissions_applet | BTREE | applet | Filter permissions by module | Used in permission management UI |
| idx_permissions_name | BTREE | name | Direct permission lookup by identifier | JWT claim validation |
| idx_permissions_scope_type | BTREE | scope_type | Filter by hierarchical scope | Role configuration |
| idx_permissions_requires_mfa | BTREE (partial) | requires_mfa WHERE true | Find MFA-protected permissions | Performance optimization |

### Index Usage Patterns

**Permission Lookup by Name**:
```sql
SELECT * FROM permissions_projection
WHERE name = 'clients.create';
-- Uses: idx_permissions_name
```

**Filter by Applet**:
```sql
SELECT * FROM permissions_projection
WHERE applet = 'medications'
ORDER BY action;
-- Uses: idx_permissions_applet
```

**Find MFA-Required Permissions**:
```sql
SELECT name, description FROM permissions_projection
WHERE requires_mfa = true;
-- Uses: idx_permissions_requires_mfa (partial index)
```

## Row-Level Security (RLS)

**Status**: ✅ ENABLED with comprehensive policies

### Policy 1: Super Admin Full Access
```sql
CREATE POLICY permissions_super_admin_all
  ON permissions_projection FOR ALL
  USING (is_super_admin(get_current_user_id()));
```
- **Purpose**: Allows platform super administrators complete access to permission definitions
- **Operations**: SELECT, INSERT, UPDATE, DELETE
- **Use Case**: Permission system management, adding new permissions via admin UI

### Policy 2: Authenticated User Read Access
```sql
CREATE POLICY permissions_authenticated_select
  ON permissions_projection FOR SELECT
  USING (get_current_user_id() IS NOT NULL);
```
- **Purpose**: All authenticated users can view available permissions (reference data)
- **Operations**: SELECT only
- **Rationale**: Users need to see permission definitions for:
  - Understanding their role capabilities
  - Permission request workflows
  - Self-service role exploration
- **Security**: Read-only prevents privilege escalation

### Testing RLS Policies

**Test as Super Admin**:
```sql
-- Set JWT claims to simulate super_admin role
SET request.jwt.claims = '{"sub": "test-super-admin-id", "role": "super_admin"}';

-- Should succeed (super_admin has ALL access)
SELECT * FROM permissions_projection;

-- Should succeed (super_admin can manage permissions)
INSERT INTO permissions_projection (id, applet, action, description, scope_type)
VALUES (gen_random_uuid(), 'reports', 'export_phi', 'Export PHI data', 'org');
```

**Test as Regular User**:
```sql
-- Set JWT claims to simulate org-scoped user
SET request.jwt.claims = '{"sub": "test-user-id", "org_id": "org-123", "role": "clinician"}';

-- Should succeed (authenticated users can view)
SELECT * FROM permissions_projection;

-- Should FAIL (only super_admin can insert)
INSERT INTO permissions_projection (id, applet, action, description, scope_type)
VALUES (gen_random_uuid(), 'test', 'forbidden', 'Test permission', 'org');
-- ERROR: new row violates row-level security policy
```

**Test as Anonymous User**:
```sql
-- Clear JWT claims
RESET request.jwt.claims;

-- Should FAIL (not authenticated)
SELECT * FROM permissions_projection;
-- Returns 0 rows (RLS denies access)
```

## CQRS Event Sourcing

### Source Events

**Event Type**: `permission.defined`

**Event Payload**:
```typescript
{
  event_type: 'permission.defined',
  aggregate_id: '<permission-uuid>',  // Permission ID
  aggregate_type: 'permission',
  payload: {
    id: '<uuid>',                      // Permission ID
    applet: 'clients',                 // Module name
    action: 'create',                  // Operation
    description: 'Create new client records',
    scope_type: 'org',                 // Hierarchical scope
    requires_mfa: false                // MFA requirement
  },
  metadata: {
    user_id: '<super-admin-uuid>',
    correlation_id: '<uuid>',
    timestamp: '2025-01-13T10:30:00Z'
  }
}
```

### Event Processor

**Function**: `process_rbac_events()` (infrastructure/supabase/sql/03-functions/event-processing/004-process-rbac-events.sql)

**Processing Logic**:
```sql
WHEN 'permission.defined' THEN
  INSERT INTO permissions_projection (
    id, applet, action, description, scope_type, requires_mfa
  )
  SELECT
    (event_payload->>'id')::UUID,
    event_payload->>'applet',
    event_payload->>'action',
    event_payload->>'description',
    event_payload->>'scope_type',
    COALESCE((event_payload->>'requires_mfa')::BOOLEAN, false)
  FROM jsonb_to_record(event_payload) AS x(...)
  ON CONFLICT (id) DO UPDATE SET
    description = EXCLUDED.description,
    scope_type = EXCLUDED.scope_type,
    requires_mfa = EXCLUDED.requires_mfa;
```

**Idempotency**: `ON CONFLICT (id) DO UPDATE` ensures reprocessing events is safe

**Trigger**: Executed automatically via `process_domain_event_trigger` on `domain_events` table INSERT

## Constraints

### Primary Key
```sql
PRIMARY KEY (id)
```
- Ensures each permission has unique identifier
- Used for foreign key references from `role_permissions_projection`

### Unique Constraint
```sql
UNIQUE (applet, action)
```
- Prevents duplicate permission definitions
- Enforces "one permission per applet.action pair" rule
- Example: Cannot have two different permissions named 'clients.create'

### Check Constraint: scope_type
```sql
CHECK (scope_type IN ('global', 'org'))
```
- **Purpose**: Enforces valid scope levels
- **Validation**: Prevents typos like 'organisation' or 'global_scope'
- **Semantics**:
  - `global` = Platform-level (permission.*, organization.create/delete/activate/etc.)
  - `org` = Organization-level (role.*, user.*, client.*, medication.*, etc.)
- **Usage**: `api.get_permissions()` filters based on user's `org_type` JWT claim

## Common Queries

### List All Permissions by Applet

```sql
SELECT
  applet,
  action,
  name,
  description,
  scope_type,
  requires_mfa
FROM permissions_projection
ORDER BY applet, action;
```

**Output**:
```
applet        | action | name                     | description                     | scope_type | requires_mfa
--------------|--------|--------------------------|--------------------------------|------------|-------------
clients       | create | clients.create           | Create new client records       | org        | false
clients       | delete | clients.delete           | Delete client records           | org        | true
clients       | update | clients.update           | Update client information       | org        | false
clients       | view   | clients.view             | View client records             | org        | false
medications   | create | medications.create       | Add medications to catalog      | org        | false
medications   | view   | medications.view         | View medication catalog         | org        | false
reports       | export | reports.export           | Export reports to CSV/PDF       | org        | true
```

### Find Permissions Requiring MFA

```sql
SELECT
  name,
  description,
  scope_type
FROM permissions_projection
WHERE requires_mfa = true
ORDER BY applet, action;
```

**Use Case**: Security audit, step-up authentication configuration

### Get Permission Details by Name

```sql
SELECT
  id,
  applet,
  action,
  description,
  scope_type,
  requires_mfa
FROM permissions_projection
WHERE name = 'clients.delete';
```

**Use Case**: Permission validation in authorization checks

### Filter Permissions by Scope Type

```sql
-- Get global permissions (platform_owner only)
SELECT name, description
FROM permissions_projection
WHERE scope_type = 'global'
ORDER BY applet, action;

-- Get org-scoped permissions (all org types)
SELECT name, description
FROM permissions_projection
WHERE scope_type = 'org'
ORDER BY applet, action;
```

**Use Case**: Show permissions available at specific scope level

### Count Permissions by Applet

```sql
SELECT
  applet,
  COUNT(*) as permission_count
FROM permissions_projection
GROUP BY applet
ORDER BY permission_count DESC, applet;
```

**Use Case**: Permission coverage analysis, module complexity assessment

## Usage Examples

### 1. Define New Permission (via Event)

**Scenario**: Add permission for medication refill approval

```typescript
// Temporal Activity: DefinePermissionActivity
async function definePermission(params: {
  applet: string;
  action: string;
  description: string;
  scope_type: 'global' | 'org';
  requires_mfa: boolean;
}) {
  const permissionId = uuidv4();

  // Emit domain event
  await supabase.from('domain_events').insert({
    event_type: 'permission.defined',
    aggregate_id: permissionId,
    aggregate_type: 'permission',
    payload: {
      id: permissionId,
      applet: params.applet,
      action: params.action,
      description: params.description,
      scope_type: params.scope_type,
      requires_mfa: params.requires_mfa
    },
    metadata: {
      user_id: getCurrentUserId(),
      correlation_id: uuidv4()
    }
  });

  // Projection updated automatically via trigger
  return permissionId;
}

// Usage
await definePermission({
  applet: 'medications',
  action: 'approve_refill',
  description: 'Approve medication refill requests',
  scope_type: 'org',
  requires_mfa: true
});
```

### 2. Check Permission in JWT Custom Claims

**Scenario**: Frontend checks if user has permission to create clients

```typescript
// Frontend: Check JWT claims
const { data: { session } } = await supabase.auth.getSession();
const permissions = session?.user?.app_metadata?.permissions || [];

const canCreateClients = permissions.includes('clients.create');

if (canCreateClients) {
  // Show "Add Client" button
} else {
  // Hide button, show read-only view
}
```

**JWT Payload**:
```json
{
  "sub": "user-123",
  "email": "clinician@provider.org",
  "org_id": "org-456",
  "role": "clinician",
  "permissions": [
    "clients.view",
    "clients.create",
    "clients.update",
    "medications.view",
    "dosage.administer"
  ],
  "scope_path": "analytics4change.provider_456.facility_789"
}
```

### 3. Validate Permission in RLS Policy

**Scenario**: Check if user has specific permission in database function

```sql
-- Function: user_has_permission(user_id, permission_name, org_id, scope_path)
SELECT user_has_permission(
  get_current_user_id(),
  'clients.delete',
  'org-123',
  'analytics4change.org_123.facility_456'
);

-- Returns: TRUE if user has permission through any assigned role
```

**Implementation** (simplified):
```sql
CREATE OR REPLACE FUNCTION user_has_permission(
  p_user_id UUID,
  p_permission_name TEXT,
  p_org_id UUID,
  p_scope_path LTREE
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
    JOIN permissions_projection p ON p.id = rp.permission_id
    WHERE ur.user_id = p_user_id
      AND p.name = p_permission_name
      AND (
        -- Global super_admin access
        ur.org_id IS NULL
        OR
        -- Org-scoped access with hierarchy check
        (ur.org_id = p_org_id AND p_scope_path <@ ur.scope_path)
      )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 4. Grant Permission to Role (via Event)

**Scenario**: Grant 'clients.create' permission to 'clinician' role

```typescript
// Temporal Activity: GrantPermissionToRoleActivity
async function grantPermissionToRole(params: {
  role_id: string;
  permission_name: string;
}) {
  // Look up permission ID
  const { data: permission } = await supabase
    .from('permissions_projection')
    .select('id')
    .eq('name', params.permission_name)
    .single();

  if (!permission) {
    throw new Error(`Permission not found: ${params.permission_name}`);
  }

  // Emit domain event
  await supabase.from('domain_events').insert({
    event_type: 'role.permission.granted',
    aggregate_id: params.role_id,
    aggregate_type: 'role',
    payload: {
      role_id: params.role_id,
      permission_id: permission.id
    },
    metadata: {
      user_id: getCurrentUserId(),
      correlation_id: uuidv4()
    }
  });

  // role_permissions_projection updated automatically
}

// Usage
await grantPermissionToRole({
  role_id: 'role-clinician-123',
  permission_name: 'clients.create'
});
```

## Audit Trail

### Created Timestamp
```sql
SELECT
  name,
  created_at,
  EXTRACT(epoch FROM (NOW() - created_at)) / 86400 as days_since_creation
FROM permissions_projection
ORDER BY created_at DESC
LIMIT 10;
```

**Use Case**: Track when permissions were added to the system

### Permission Evolution Query
```sql
-- Find all events related to a specific permission
SELECT
  de.event_type,
  de.occurred_at,
  de.payload,
  de.metadata
FROM domain_events de
WHERE de.aggregate_type = 'permission'
  AND de.aggregate_id = '<permission-uuid>'
ORDER BY de.occurred_at;
```

**Use Case**: Full history of permission definition and updates

## Troubleshooting

### Issue: Permission Not Found in JWT Claims

**Symptoms**: User should have permission but JWT claims don't include it

**Diagnosis**:
```sql
-- 1. Check if permission exists
SELECT * FROM permissions_projection WHERE name = 'clients.create';

-- 2. Check if permission is granted to user's roles
SELECT
  ur.user_id,
  r.name as role_name,
  p.name as permission_name
FROM user_roles_projection ur
JOIN roles_projection r ON r.id = ur.role_id
JOIN role_permissions_projection rp ON rp.role_id = r.id
JOIN permissions_projection p ON p.id = rp.permission_id
WHERE ur.user_id = '<user-uuid>'
  AND p.name = 'clients.create';

-- 3. Check JWT hook function
SELECT custom_access_token_hook(jsonb_build_object('user_id', '<user-uuid>'));
```

**Common Causes**:
1. Permission not granted to user's role → Grant permission via `role.permission.granted` event
2. User not assigned to role → Assign role via `user.role.assigned` event
3. JWT hook not refreshing → User needs to re-authenticate (JWT issued before permission grant)

### Issue: RLS Policy Blocking Access

**Symptoms**: Query returns 0 rows despite data existing

**Diagnosis**:
```sql
-- Check if RLS is enabled
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'permissions_projection';

-- Check active policies
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'permissions_projection';

-- Test policy with specific JWT claims
SET request.jwt.claims = '{"sub": "test-user-id"}';
SELECT COUNT(*) FROM permissions_projection;  -- Should work (authenticated)

RESET request.jwt.claims;
SELECT COUNT(*) FROM permissions_projection;  -- Should return 0 (anonymous)
```

**Resolution**: Ensure `request.jwt.claims` contains valid `sub` field

### Issue: Duplicate Permission Error

**Symptoms**: `INSERT` fails with unique constraint violation

**Error Message**:
```
ERROR: duplicate key value violates unique constraint "permissions_projection_applet_action_key"
DETAIL: Key (applet, action)=(clients, create) already exists.
```

**Resolution**:
```sql
-- Check existing permission
SELECT * FROM permissions_projection
WHERE applet = 'clients' AND action = 'create';

-- If updating description/scope, emit permission.updated event (future)
-- If truly duplicate, this is an application logic error
```

### Issue: MFA Requirement Not Enforced

**Symptoms**: Sensitive action allowed without MFA verification

**Diagnosis**:
```sql
-- Check if permission has MFA flag set
SELECT name, requires_mfa
FROM permissions_projection
WHERE name = 'clients.delete';

-- If requires_mfa = false, permission needs update
-- Emit permission.updated event to set requires_mfa = true
```

**Note**: MFA enforcement is application-level (not database-level)

## Performance Considerations

### Read-Heavy Workload
- **Pattern**: Permissions are read frequently (every authorization check)
- **Write Pattern**: Rare (only when defining new permissions)
- **Optimization**: All lookups covered by indexes

### Index Effectiveness
```sql
EXPLAIN ANALYZE
SELECT * FROM permissions_projection WHERE name = 'clients.create';

-- Expected: Index Scan using idx_permissions_name
-- Cost: < 1ms
```

### Caching Strategy
- Frontend: Cache permissions in user session after JWT decode
- Backend: PostgreSQL query cache handles repeated queries
- TTL: Permissions change rarely, cache until JWT refresh (typically 1 hour)

## Related Tables

- **role_permissions_projection** - Maps permissions to roles (many-to-many)
- **user_roles_projection** - Assigns roles to users (determines final permission set)
- **roles_projection** - Role definitions that bundle permissions
- **domain_events** - Source of truth for permission definitions

## Migration History

**Initial Schema**: Created with RBAC system (2024-Q4)

**Schema Changes**:
- Added `requires_mfa` column (2025-01-13) for step-up authentication
- Added `scope_type` constraint enforcement (2024-12-15)
- Migrated from Zitadel to Supabase Auth (2025-10-27) - No schema changes, JWT hook updated

## References

- **RLS Policies**: `infrastructure/supabase/sql/06-rls/001-core-projection-policies.sql:93-114`
- **Event Processor**: `infrastructure/supabase/sql/03-functions/event-processing/004-process-rbac-events.sql:13-28`
- **JWT Hook**: `infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql:99-106`
- **Authorization Function**: `infrastructure/supabase/sql/03-functions/authorization/001-user_has_permission.sql:13-15`
- **Table Definition**: `infrastructure/supabase/sql/02-tables/rbac/001-permissions_projection.sql`
