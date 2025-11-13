---
status: current
last_updated: 2025-01-13
---

# role_permissions_projection

## Overview

The `role_permissions_projection` table is a **CQRS read model** that implements the many-to-many junction table between roles and permissions in the RBAC system. Each row represents a permission grant to a role, defining what actions users with that role can perform. This table is the core of the permission bundling system - roles serve as named collections of permissions that can be assigned to users.

**Data Sensitivity**: INTERNAL (access control configuration)
**CQRS Role**: Read model projection (event-sourced)
**Multi-Tenancy**: Implicitly scoped via roles (inherits role's organization context)
**Relationship Type**: Junction table (many-to-many)

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| role_id | uuid | NO | - | Foreign key to roles_projection |
| permission_id | uuid | NO | - | Foreign key to permissions_projection |
| granted_at | timestamptz | NO | now() | When permission was granted to role |

### Column Details

#### role_id
- **Type**: `uuid`
- **Purpose**: References the role receiving the permission
- **Foreign Key**: References `roles_projection(id)` (implicit, not enforced)
- **Constraints**: Part of composite PRIMARY KEY
- **Index**: `idx_role_permissions_role` (BTREE) for role → permissions lookups
- **Cascade Behavior**: Managed at application level (role deletion should remove grants)

#### permission_id
- **Type**: `uuid`
- **Purpose**: References the permission being granted to the role
- **Foreign Key**: References `permissions_projection(id)` (implicit, not enforced)
- **Constraints**: Part of composite PRIMARY KEY
- **Index**: `idx_role_permissions_permission` (BTREE) for permission → roles reverse lookup
- **Cascade Behavior**: Permissions should not be deleted if granted to roles

#### granted_at
- **Type**: `timestamptz`
- **Purpose**: Audit trail - when permission was granted to role
- **Default**: `now()`
- **Usage**: Historical analysis, permission grant timeline tracking
- **Immutable**: Permissions are granted/revoked (not updated), so this timestamp never changes

## Relationships

### Parent Relationships (Foreign Keys)

- **roles_projection** → `role_id`
  - Each grant belongs to exactly one role
  - Foreign key constraint not enforced (application-level management)
  - Deletion: Application should clean up grants when role deleted

- **permissions_projection** → `permission_id`
  - Each grant references exactly one permission
  - Foreign key constraint not enforced (application-level management)
  - Deletion: Prevent permission deletion if still granted to roles

### Child Relationships (Referenced By)

**None** - This is a pure junction table with no child dependencies

## Indexes

| Index Name | Type | Columns | Purpose | Notes |
|------------|------|---------|---------|-------|
| PRIMARY KEY | BTREE | (role_id, permission_id) | Unique grant constraint | Composite key prevents duplicate grants |
| idx_role_permissions_role | BTREE | role_id | Find all permissions for a role | Common query pattern |
| idx_role_permissions_permission | BTREE | permission_id | Find all roles with a permission | Reverse lookup, audit |

### Index Usage Patterns

**Find All Permissions for a Role**:
```sql
SELECT
  p.name,
  p.description,
  p.scope_type,
  rp.granted_at
FROM role_permissions_projection rp
JOIN permissions_projection p ON p.id = rp.permission_id
WHERE rp.role_id = '<role-uuid>'
ORDER BY p.applet, p.action;
-- Uses: idx_role_permissions_role
```

**Find All Roles with Specific Permission**:
```sql
SELECT
  r.name,
  r.description,
  r.organization_id,
  rp.granted_at
FROM role_permissions_projection rp
JOIN roles_projection r ON r.id = rp.role_id
WHERE rp.permission_id = '<permission-uuid>'
ORDER BY r.organization_id, r.name;
-- Uses: idx_role_permissions_permission
```

**Check if Role Has Permission**:
```sql
SELECT EXISTS (
  SELECT 1
  FROM role_permissions_projection
  WHERE role_id = '<role-uuid>'
    AND permission_id = '<permission-uuid>'
) AS has_permission;
-- Uses: PRIMARY KEY (optimal)
```

## Row-Level Security (RLS)

**Status**: ✅ ENABLED with comprehensive policies

### Policy 1: Super Admin Full Access
```sql
CREATE POLICY role_permissions_super_admin_all
  ON role_permissions_projection FOR ALL
  USING (is_super_admin(get_current_user_id()));
```
- **Purpose**: Platform super administrators can manage all permission grants
- **Operations**: SELECT, INSERT, DELETE (UPDATE not applicable - grants are immutable)
- **Use Case**: Global RBAC configuration, permission audits

### Policy 2: Organization Admin Permission Management
```sql
CREATE POLICY role_permissions_org_admin_select
  ON role_permissions_projection FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM roles_projection r
      WHERE r.id = role_permissions_projection.role_id
        AND r.organization_id IS NOT NULL
        AND is_org_admin(get_current_user_id(), r.organization_id)
    )
  );
```
- **Purpose**: Organization admins can view permission grants for their organization's roles
- **Operations**: SELECT only (grant/revoke via API with permission checks)
- **Scope**: Only organization-scoped roles (not global templates)
- **Function**: `is_org_admin(user_id, org_id)` checks admin role assignment

### Policy 3: Global Role Permissions Visibility
```sql
CREATE POLICY role_permissions_global_select
  ON role_permissions_projection FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM roles_projection r
      WHERE r.id = role_permissions_projection.role_id
        AND r.organization_id IS NULL
    )
    AND get_current_user_id() IS NOT NULL
  );
```
- **Purpose**: All authenticated users can view permissions for global role templates
- **Operations**: SELECT only
- **Rationale**: Transparency about global role capabilities
- **Security**: Read-only prevents unauthorized permission grants

### Testing RLS Policies

**Test as Super Admin**:
```sql
SET request.jwt.claims = '{"sub": "super-admin-id", "role": "super_admin"}';

-- Should return ALL permission grants (global + all orgs)
SELECT
  r.name as role_name,
  p.name as permission_name,
  rp.granted_at
FROM role_permissions_projection rp
JOIN roles_projection r ON r.id = rp.role_id
JOIN permissions_projection p ON p.id = rp.permission_id;

-- Should succeed (super_admin can grant permissions)
INSERT INTO role_permissions_projection (role_id, permission_id)
VALUES ('<role-uuid>', '<permission-uuid>');
```

**Test as Organization Admin**:
```sql
SET request.jwt.claims = '{"sub": "org-admin-id", "org_id": "org-123", "role": "provider_admin"}';

-- Should return:
-- 1. Global role permissions (super_admin, provider_admin, partner_admin)
-- 2. Permissions for org-123 roles only
SELECT
  r.name as role_name,
  r.organization_id,
  p.name as permission_name
FROM role_permissions_projection rp
JOIN roles_projection r ON r.id = rp.role_id
JOIN permissions_projection p ON p.id = rp.permission_id
ORDER BY r.organization_id NULLS FIRST, r.name, p.name;
```

**Test as Regular User**:
```sql
SET request.jwt.claims = '{"sub": "user-id", "org_id": "org-456", "role": "clinician"}';

-- Should return ONLY global role template permissions
-- Organization-specific role permissions NOT visible
SELECT COUNT(*) FROM role_permissions_projection rp
JOIN roles_projection r ON r.id = rp.role_id
WHERE r.organization_id IS NULL;
```

## CQRS Event Sourcing

### Source Events

**Event Types**:
1. `role.permission.granted` - Permission added to role
2. `role.permission.revoked` - Permission removed from role

**Event Payload (role.permission.granted)**:
```typescript
{
  event_type: 'role.permission.granted',
  aggregate_id: '<role-uuid>',     // Role receiving permission
  aggregate_type: 'role',
  payload: {
    role_id: '<role-uuid>',
    permission_id: '<permission-uuid>'
  },
  metadata: {
    user_id: '<admin-uuid>',
    correlation_id: '<uuid>',
    timestamp: '2025-01-13T10:30:00Z'
  }
}
```

**Event Payload (role.permission.revoked)**:
```typescript
{
  event_type: 'role.permission.revoked',
  aggregate_id: '<role-uuid>',
  aggregate_type: 'role',
  payload: {
    role_id: '<role-uuid>',
    permission_id: '<permission-uuid>'
  },
  metadata: {
    user_id: '<admin-uuid>',
    correlation_id: '<uuid>',
    timestamp: '2025-01-13T14:45:00Z'
  }
}
```

### Event Processor

**Function**: `process_rbac_events()` (infrastructure/supabase/sql/03-functions/event-processing/004-process-rbac-events.sql)

**Processing Logic (role.permission.granted)**:
```sql
WHEN 'role.permission.granted' THEN
  INSERT INTO role_permissions_projection (role_id, permission_id, granted_at)
  SELECT
    (event_payload->>'role_id')::UUID,
    (event_payload->>'permission_id')::UUID,
    NOW()
  ON CONFLICT (role_id, permission_id) DO NOTHING;
```

**Processing Logic (role.permission.revoked)**:
```sql
WHEN 'role.permission.revoked' THEN
  DELETE FROM role_permissions_projection
  WHERE role_id = (event_payload->>'role_id')::UUID
    AND permission_id = (event_payload->>'permission_id')::UUID;
```

**Idempotency**:
- Grant: `ON CONFLICT DO NOTHING` prevents duplicate grants
- Revoke: DELETE is idempotent (no error if row doesn't exist)

**Trigger**: Executed automatically via `process_domain_event_trigger` on `domain_events` INSERT

## Constraints

### Primary Key
```sql
PRIMARY KEY (role_id, permission_id)
```
- **Purpose**: Ensures one grant per role-permission pair (prevents duplicates)
- **Enforcement**: Database-level uniqueness constraint
- **Benefit**: Prevents accidental duplicate grants from concurrent events

## Common Queries

### List All Permissions for a Role

```sql
SELECT
  p.applet,
  p.action,
  p.name,
  p.description,
  p.scope_type,
  p.requires_mfa,
  rp.granted_at
FROM role_permissions_projection rp
JOIN permissions_projection p ON p.id = rp.permission_id
WHERE rp.role_id = '<role-uuid>'
ORDER BY p.applet, p.action;
```

**Output**:
```
applet      | action | name              | description                | scope_type | requires_mfa | granted_at
------------|--------|-------------------|----------------------------|------------|--------------|--------------------
clients     | create | clients.create    | Create new client records  | org        | false        | 2025-01-10 10:30:00
clients     | update | clients.update    | Update client information  | org        | false        | 2025-01-10 10:30:00
clients     | view   | clients.view      | View client records        | org        | false        | 2025-01-10 10:30:00
medications | view   | medications.view  | View medication catalog    | org        | false        | 2025-01-10 10:31:00
```

### Find All Roles with a Specific Permission

```sql
SELECT
  r.name as role_name,
  r.description,
  r.organization_id,
  o.name as organization_name,
  rp.granted_at
FROM role_permissions_projection rp
JOIN roles_projection r ON r.id = rp.role_id
JOIN permissions_projection p ON p.id = rp.permission_id
LEFT JOIN organizations_projection o ON o.id = r.organization_id
WHERE p.name = 'clients.delete'
ORDER BY r.organization_id NULLS FIRST, r.name;
```

**Use Case**: Audit which roles can perform sensitive operation (e.g., delete clients)

### Check if User Has Permission Through Any Role

```sql
-- Function: user_has_permission(user_id, permission_name)
SELECT EXISTS (
  SELECT 1
  FROM user_roles_projection ur
  JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
  JOIN permissions_projection p ON p.id = rp.permission_id
  WHERE ur.user_id = '<user-uuid>'
    AND p.name = 'clients.create'
) AS has_permission;
```

**Use Case**: Authorization check before allowing user action

### Count Permissions by Role

```sql
SELECT
  r.name as role_name,
  r.organization_id,
  COUNT(rp.permission_id) as permission_count
FROM roles_projection r
LEFT JOIN role_permissions_projection rp ON rp.role_id = r.id
WHERE r.is_active = true
GROUP BY r.id, r.name, r.organization_id
ORDER BY permission_count DESC;
```

**Use Case**: Role complexity analysis, identify over-privileged roles

### Find Permissions Common to Multiple Roles

```sql
SELECT
  p.name,
  p.description,
  COUNT(DISTINCT rp.role_id) as role_count
FROM permissions_projection p
JOIN role_permissions_projection rp ON rp.permission_id = p.id
JOIN roles_projection r ON r.id = rp.role_id
WHERE r.organization_id = 'org-123'
  AND r.is_active = true
GROUP BY p.id, p.name, p.description
HAVING COUNT(DISTINCT rp.role_id) >= 2
ORDER BY role_count DESC;
```

**Use Case**: Identify commonly needed permissions (candidates for base role)

## Usage Examples

### 1. Grant Permission to Role (via Event)

**Scenario**: Grant 'clients.create' permission to 'clinician' role

```typescript
// Temporal Activity: GrantPermissionToRoleActivity
async function grantPermissionToRole(params: {
  role_name: string;
  permission_name: string;
}) {
  // Look up role and permission IDs
  const [{ data: role }, { data: permission }] = await Promise.all([
    supabase.from('roles_projection').select('id').eq('name', params.role_name).single(),
    supabase.from('permissions_projection').select('id').eq('name', params.permission_name).single()
  ]);

  if (!role || !permission) {
    throw new Error('Role or permission not found');
  }

  // Emit domain event
  await supabase.from('domain_events').insert({
    event_type: 'role.permission.granted',
    aggregate_id: role.id,
    aggregate_type: 'role',
    payload: {
      role_id: role.id,
      permission_id: permission.id
    },
    metadata: {
      user_id: getCurrentUserId(),
      correlation_id: uuidv4()
    }
  });

  // role_permissions_projection updated automatically via trigger
}

// Usage
await grantPermissionToRole({
  role_name: 'clinician',
  permission_name: 'clients.create'
});
```

### 2. Revoke Permission from Role (via Event)

**Scenario**: Remove 'clients.delete' permission from 'clinician' role

```typescript
// Temporal Activity: RevokePermissionFromRoleActivity
async function revokePermissionFromRole(params: {
  role_name: string;
  permission_name: string;
}) {
  const [{ data: role }, { data: permission }] = await Promise.all([
    supabase.from('roles_projection').select('id').eq('name', params.role_name).single(),
    supabase.from('permissions_projection').select('id').eq('name', params.permission_name).single()
  ]);

  if (!role || !permission) {
    throw new Error('Role or permission not found');
  }

  // Emit domain event
  await supabase.from('domain_events').insert({
    event_type: 'role.permission.revoked',
    aggregate_id: role.id,
    aggregate_type: 'role',
    payload: {
      role_id: role.id,
      permission_id: permission.id
    },
    metadata: {
      user_id: getCurrentUserId(),
      correlation_id: uuidv4()
    }
  });

  // Grant removed automatically via trigger
}

// Usage
await revokePermissionFromRole({
  role_name: 'clinician',
  permission_name: 'clients.delete'
});
```

### 3. Bulk Grant Permissions to Role

**Scenario**: Configure new 'data_analyst' role with read-only permissions

```typescript
// Temporal Workflow: ConfigureRolePermissionsWorkflow
async function configureRolePermissions(params: {
  role_name: string;
  permission_names: string[];
}) {
  const { data: role } = await supabase
    .from('roles_projection')
    .select('id')
    .eq('name', params.role_name)
    .single();

  if (!role) {
    throw new Error(`Role not found: ${params.role_name}`);
  }

  // Grant each permission (workflow ensures transactional-like behavior)
  for (const permissionName of params.permission_names) {
    await grantPermissionToRole({
      role_name: params.role_name,
      permission_name: permissionName
    });

    // Small delay to avoid overwhelming event processor
    await sleep(100);
  }
}

// Usage
await configureRolePermissions({
  role_name: 'data_analyst',
  permission_names: [
    'clients.view',
    'medications.view',
    'dosage.view',
    'reports.view',
    'reports.export'
  ]
});
```

### 4. Clone Role Permissions to New Role

**Scenario**: Create 'senior_clinician' role with same permissions as 'clinician' plus extras

```typescript
// Temporal Activity: CloneRolePermissionsActivity
async function cloneRolePermissions(params: {
  source_role_name: string;
  target_role_name: string;
  additional_permissions?: string[];
}) {
  // Get source role permissions
  const { data: sourcePermissions } = await supabase
    .from('role_permissions_projection')
    .select('permission_id, permissions_projection(name)')
    .eq('roles_projection.name', params.source_role_name);

  // Grant all source permissions to target role
  for (const grant of sourcePermissions) {
    await grantPermissionToRole({
      role_name: params.target_role_name,
      permission_name: grant.permissions_projection.name
    });
  }

  // Grant additional permissions
  if (params.additional_permissions) {
    for (const permissionName of params.additional_permissions) {
      await grantPermissionToRole({
        role_name: params.target_role_name,
        permission_name: permissionName
      });
    }
  }
}

// Usage
await cloneRolePermissions({
  source_role_name: 'clinician',
  target_role_name: 'senior_clinician',
  additional_permissions: [
    'clients.delete',
    'medications.approve'
  ]
});
```

## Audit Trail

### Permission Grant History for Role
```sql
-- Find all permission grant/revoke events for specific role
SELECT
  de.event_type,
  de.occurred_at,
  de.payload->>'permission_id' as permission_id,
  p.name as permission_name,
  de.metadata->>'user_id' as granted_by
FROM domain_events de
LEFT JOIN permissions_projection p ON p.id = (de.payload->>'permission_id')::UUID
WHERE de.aggregate_type = 'role'
  AND de.aggregate_id = '<role-uuid>'
  AND de.event_type IN ('role.permission.granted', 'role.permission.revoked')
ORDER BY de.occurred_at DESC;
```

**Use Case**: Role permission evolution over time, identify who made changes

### Find Recently Granted Permissions
```sql
SELECT
  r.name as role_name,
  p.name as permission_name,
  rp.granted_at,
  EXTRACT(epoch FROM (NOW() - rp.granted_at)) / 3600 as hours_ago
FROM role_permissions_projection rp
JOIN roles_projection r ON r.id = rp.role_id
JOIN permissions_projection p ON p.id = rp.permission_id
WHERE rp.granted_at > NOW() - INTERVAL '7 days'
ORDER BY rp.granted_at DESC;
```

**Use Case**: Recent RBAC configuration changes, security audit

## Troubleshooting

### Issue: Permission Grant Not Appearing

**Symptoms**: Permission granted via event but not visible in projection

**Diagnosis**:
```sql
-- Check if domain event was recorded
SELECT * FROM domain_events
WHERE event_type = 'role.permission.granted'
  AND payload->>'role_id' = '<role-uuid>'
  AND payload->>'permission_id' = '<permission-uuid>'
ORDER BY occurred_at DESC
LIMIT 1;

-- Check if projection was updated
SELECT * FROM role_permissions_projection
WHERE role_id = '<role-uuid>'
  AND permission_id = '<permission-uuid>';

-- Check event processing errors
-- (Look for errors in trigger logs or failed event processing)
```

**Common Causes**:
1. Event not emitted (application logic error)
2. Event processor trigger failed (check PostgreSQL logs)
3. RLS policy blocking INSERT (unlikely for event processor with service role)

### Issue: Duplicate Grant Error

**Symptoms**: Cannot grant permission that's already granted

**Error**: Should be handled gracefully by `ON CONFLICT DO NOTHING`

**Diagnosis**:
```sql
-- Check if permission already granted
SELECT * FROM role_permissions_projection
WHERE role_id = '<role-uuid>'
  AND permission_id = '<permission-uuid>';
```

**Resolution**: Idempotency ensures duplicate grants are safe (no error thrown)

### Issue: Permission Still Active After Revoke

**Symptoms**: User still has permission after revocation event

**Diagnosis**:
```sql
-- Check if revoke event was processed
SELECT * FROM domain_events
WHERE event_type = 'role.permission.revoked'
  AND payload->>'role_id' = '<role-uuid>'
  AND payload->>'permission_id' = '<permission-uuid>';

-- Check if grant still exists
SELECT * FROM role_permissions_projection
WHERE role_id = '<role-uuid>'
  AND permission_id = '<permission-uuid>';

-- Check user's JWT age (may contain stale permissions)
-- User needs to re-authenticate to get fresh JWT with updated permissions
```

**Common Causes**:
1. Revoke event not processed → Check trigger logs
2. User's JWT issued before revocation → User needs to re-login
3. Permission granted via different role → Check all user's roles

## Performance Considerations

### Join Performance
```sql
EXPLAIN ANALYZE
SELECT p.name
FROM role_permissions_projection rp
JOIN permissions_projection p ON p.id = rp.permission_id
WHERE rp.role_id = '<role-uuid>';

-- Expected: Nested Loop with Index Scans
-- Cost: < 1ms for typical role (10-50 permissions)
```

### Authorization Query Optimization
- **Pattern**: JOIN with `user_roles_projection` for permission checks
- **Index Coverage**: Both junction tables indexed on foreign keys
- **Caching**: Application-level caching of role → permissions mapping

### Write Pattern
- **Frequency**: Rare (role configuration is infrequent)
- **Batch Operations**: Bulk grants handled by workflow with delays
- **Idempotency**: Safe to replay events (ON CONFLICT DO NOTHING)

## Related Tables

- **roles_projection** - Role definitions that bundle permissions
- **permissions_projection** - Individual permission definitions
- **user_roles_projection** - User role assignments (determines effective permissions)
- **domain_events** - Source of truth for permission grants/revokes

## Migration History

**Initial Schema**: Created with RBAC system (2024-Q4)

**Schema Changes**:
- No schema changes since initial creation
- Migration from Zitadel to Supabase Auth (2025-10-27) - No table changes, only JWT hook updates

## References

- **RLS Policies**: `infrastructure/supabase/sql/06-rls/001-core-projection-policies.sql:155-202`
- **Event Processor**: `infrastructure/supabase/sql/03-functions/event-processing/004-process-rbac-events.sql:76-93`
- **Table Definition**: `infrastructure/supabase/sql/02-tables/rbac/003-role_permissions_projection.sql`
- **Authorization Function**: `infrastructure/supabase/sql/03-functions/authorization/001-user_has_permission.sql:13-15`
- **JWT Hook**: `infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql:104-106`
