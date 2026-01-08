---
status: current
last_updated: 2025-01-05
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS junction table assigning roles to users with organization and ltree scope. NULL org_id indicates global super_admin access; non-null indicates org-scoped assignment. Supports temporal role assignments via `role_valid_from`/`role_valid_until` columns for time-limited access. Used by JWT custom claims hook.

**When to read**:
- Implementing role assignment/revocation workflows
- Understanding RBAC authorization patterns
- Debugging user permissions or JWT claims
- Working with hierarchical scope_path inheritance
- Implementing temporal (time-limited) role assignments

**Prerequisites**: [roles_projection](roles_projection.md), [permissions_projection](permissions_projection.md)

**Key topics**: `user-roles`, `rbac`, `jwt-claims`, `scope-path`, `null-org-super-admin`, `role-access-dates`, `temporal-roles`, `role-validity`

**Estimated read time**: 35 minutes
<!-- TL;DR-END -->

# user_roles_projection

## Overview

The `user_roles_projection` table is a **CQRS read model** that assigns roles to users with organization-level scoping. This table implements the critical link between user identities and their RBAC permissions, supporting both global super administrator access (`org_id = NULL`) and organization-scoped role assignments with hierarchical path inheritance via ltree. Each row represents a role assignment to a user within a specific organizational scope.

**Data Sensitivity**: INTERNAL (access control configuration)
**CQRS Role**: Read model projection (event-sourced)
**Multi-Tenancy**: Hybrid (global super_admin + org-scoped assignments)
**Relationship Type**: Junction table with scoping metadata

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| user_id | uuid | NO | - | Foreign key to users table |
| role_id | uuid | NO | - | Foreign key to roles_projection |
| org_id | uuid | YES | NULL | Organization UUID (NULL for super_admin global access) |
| scope_path | ltree | YES | NULL | Hierarchical scope path (NULL for global access) |
| assigned_at | timestamptz | NO | now() | When role was assigned to user |
| role_valid_from | date | YES | NULL | First date role assignment is active (NULL = immediate) |
| role_valid_until | date | YES | NULL | Last date role assignment is active (NULL = no expiration) |

### Column Details

#### user_id
- **Type**: `uuid`
- **Purpose**: References the user receiving the role assignment
- **Foreign Key**: References `users(id)` (implicit, not enforced)
- **Constraints**: Part of composite UNIQUE constraint with role_id and org_id
- **Index**: `idx_user_roles_user` (BTREE) for user → roles lookups
- **Usage**: JWT custom claims query by user_id to populate role and permissions

#### role_id
- **Type**: `uuid`
- **Purpose**: References the role being assigned to the user
- **Foreign Key**: References `roles_projection(id)` (implicit, not enforced)
- **Constraints**: Part of composite UNIQUE constraint with user_id and org_id
- **Index**: `idx_user_roles_role` (BTREE) for role → users reverse lookup
- **Usage**: Determines user's permission set via `role_permissions_projection`

#### org_id
- **Type**: `uuid`
- **Purpose**: Organization scope for role assignment
- **Nullable**: YES
- **Scoping Rules**:
  - `NULL` - Global super_admin access (no organization boundaries)
  - `<uuid>` - Organization-scoped access (isolated to specific org)
- **Constraints**: Part of composite UNIQUE with NULLS NOT DISTINCT
- **Index**: `idx_user_roles_org` (partial WHERE NOT NULL)
- **Multi-Tenancy**: Enables users to have different roles in different organizations

#### scope_path
- **Type**: `ltree` (PostgreSQL hierarchical label tree)
- **Purpose**: Hierarchical scope for granular permission scoping
- **Nullable**: YES (NULL for global access)
- **Format**: `analytics4change.org_<uuid>.facility_<uuid>.program_<uuid>`
- **Examples**:
  - Global super_admin: `NULL`
  - Org-level admin: `analytics4change.org_123`
  - Facility-level manager: `analytics4change.org_123.facility_456`
  - Program coordinator: `analytics4change.org_123.facility_456.program_789`
- **Index**: `idx_user_roles_scope_path` (GIST WHERE NOT NULL)
- **CHECK Constraint**: `(org_id IS NULL AND scope_path IS NULL) OR (org_id IS NOT NULL AND scope_path IS NOT NULL)`
- **JWT Claims**: Included in custom claims for hierarchical permission checks

#### assigned_at
- **Type**: `timestamptz`
- **Purpose**: Audit trail - when role was assigned to user
- **Default**: `now()`
- **Usage**: Historical analysis, role assignment timeline tracking
- **Immutable**: Role assignments are created/deleted (not updated), so timestamp never changes

#### role_valid_from
- **Type**: `date`
- **Purpose**: Optional start date for when role assignment becomes active
- **Nullable**: YES (NULL = role active immediately upon assignment)
- **Constraint**: `user_roles_date_order_check` ensures `role_valid_from <= role_valid_until`
- **Index**: `idx_user_roles_pending_start` (partial WHERE NOT NULL) for notification queries
- **Use Cases**:
  - Future-dated role assignments (e.g., promotion effective next month)
  - Contractor start dates aligned with project kickoff
  - Scheduled privilege escalation for temporary tasks
- **Interaction with user_org_access**: Role-level dates work independently but intersection with org-level dates determines actual access. See `get_user_active_roles()` function.

#### role_valid_until
- **Type**: `date`
- **Purpose**: Optional expiration date for role assignment
- **Nullable**: YES (NULL = role never expires)
- **Constraint**: `user_roles_date_order_check` ensures `role_valid_from <= role_valid_until`
- **Index**: `idx_user_roles_expiring` (partial WHERE NOT NULL) for expiration notification queries
- **Use Cases**:
  - Temporary admin access (e.g., 30-day audit assistance)
  - Contract end dates for external consultants
  - Rotation schedules for sensitive roles (e.g., security officer)
  - Time-limited elevated privileges for specific projects
- **Interaction with user_org_access**: Effective access requires both role dates AND org-level dates to be valid. See `get_user_active_roles()` function.

## Relationships

### Parent Relationships (Foreign Keys)

- **users** → `user_id`
  - Each assignment belongs to exactly one user
  - Foreign key constraint not enforced (application-level management)
  - User deletion should cascade to remove all role assignments

- **roles_projection** → `role_id`
  - Each assignment references exactly one role
  - Foreign key constraint not enforced (application-level management)
  - Role deletion should cascade to remove all user assignments

### Child Relationships (Referenced By)

**None** - This is a junction table with scoping metadata

## Indexes

| Index Name | Type | Columns | Purpose | Notes |
|------------|------|---------|---------|-------|
| UNIQUE (NULLS NOT DISTINCT) | BTREE | (user_id, role_id, org_id) | Prevent duplicate assignments | PostgreSQL 15+ feature |
| idx_user_roles_user | BTREE | user_id | Find all roles for a user | JWT generation, profile queries |
| idx_user_roles_role | BTREE | role_id | Find all users with a role | Reverse lookup, notifications |
| idx_user_roles_org | BTREE (partial) | org_id WHERE NOT NULL | Filter by organization | Org-scoped queries |
| idx_user_roles_scope_path | GIST (partial) | scope_path WHERE NOT NULL | Hierarchical scope queries | ltree operations |
| idx_user_roles_auth_lookup | BTREE | (user_id, org_id) | Authorization queries | Composite index for common pattern |
| idx_user_roles_expiring | BTREE (partial) | role_valid_until WHERE NOT NULL | Find roles expiring soon | Notification/cleanup queries |
| idx_user_roles_pending_start | BTREE (partial) | role_valid_from WHERE NOT NULL | Find future-starting roles | Activation notification queries |

### Index Usage Patterns

**Find All Roles for a User**:
```sql
SELECT
  r.name as role_name,
  ur.org_id,
  ur.scope_path,
  ur.assigned_at
FROM user_roles_projection ur
JOIN roles_projection r ON r.id = ur.role_id
WHERE ur.user_id = '<user-uuid>'
ORDER BY ur.org_id NULLS FIRST, r.name;
-- Uses: idx_user_roles_user
```

**Find Users with Specific Role in Organization**:
```sql
SELECT
  u.email,
  u.first_name,
  u.last_name,
  ur.scope_path
FROM user_roles_projection ur
JOIN users u ON u.id = ur.user_id
JOIN roles_projection r ON r.id = ur.role_id
WHERE r.name = 'clinician'
  AND ur.org_id = 'org-123'
ORDER BY u.last_name, u.first_name;
-- Uses: idx_user_roles_role + idx_user_roles_org
```

**Authorization Lookup (User + Org)**:
```sql
SELECT
  r.name as role_name,
  ur.scope_path
FROM user_roles_projection ur
JOIN roles_projection r ON r.id = ur.role_id
WHERE ur.user_id = '<user-uuid>'
  AND ur.org_id = '<org-uuid>';
-- Uses: idx_user_roles_auth_lookup (composite index)
```

**Find Roles Expiring Within N Days**:
```sql
SELECT
  u.email,
  r.name as role_name,
  o.name as org_name,
  ur.role_valid_until,
  ur.role_valid_until - CURRENT_DATE as days_remaining
FROM user_roles_projection ur
JOIN users u ON u.id = ur.user_id
JOIN roles_projection r ON r.id = ur.role_id
LEFT JOIN organizations_projection o ON o.id = ur.org_id
WHERE ur.role_valid_until IS NOT NULL
  AND ur.role_valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
ORDER BY ur.role_valid_until;
-- Uses: idx_user_roles_expiring (partial index)
```

**Find Roles with Future Start Dates**:
```sql
SELECT
  u.email,
  r.name as role_name,
  ur.role_valid_from,
  ur.role_valid_from - CURRENT_DATE as days_until_active
FROM user_roles_projection ur
JOIN users u ON u.id = ur.user_id
JOIN roles_projection r ON r.id = ur.role_id
WHERE ur.role_valid_from IS NOT NULL
  AND ur.role_valid_from > CURRENT_DATE
ORDER BY ur.role_valid_from;
-- Uses: idx_user_roles_pending_start (partial index)
```

## Row-Level Security (RLS)

**Status**: ✅ ENABLED with comprehensive policies

### Policy 1: Super Admin Full Access
```sql
CREATE POLICY user_roles_super_admin_all
  ON user_roles_projection FOR ALL
  USING (is_super_admin(get_current_user_id()));
```
- **Purpose**: Platform super administrators can manage all user role assignments
- **Operations**: SELECT, INSERT, DELETE (UPDATE not applicable)
- **Use Case**: Global user management, cross-org role assignments

### Policy 2: Organization Admin Role Assignment Management
```sql
CREATE POLICY user_roles_org_admin_select
  ON user_roles_projection FOR SELECT
  USING (
    org_id IS NOT NULL
    AND has_org_admin_permission()
    AND org_id = get_current_org_id()
  );
```
- **Purpose**: Organization admins can view role assignments within their organization
- **Operations**: SELECT only (assign/revoke via API with permission checks)
- **Scope**: Only organization-scoped assignments (not global super_admin)
- **Function**: `has_org_admin_permission()` checks JWT claims for admin role (no DB query)

### Policy 3: User Self-Access
```sql
CREATE POLICY user_roles_own_select
  ON user_roles_projection FOR SELECT
  USING (user_id = get_current_user_id());
```
- **Purpose**: Users can view their own role assignments
- **Operations**: SELECT only
- **Rationale**: Self-service role exploration, permission understanding
- **Security**: Users cannot modify their own roles (prevents privilege escalation)

### Testing RLS Policies

**Test as Super Admin**:
```sql
SET request.jwt.claims = '{"sub": "super-admin-id", "role": "super_admin"}';

-- Should return ALL user role assignments (all orgs, all users)
SELECT
  u.email,
  r.name as role_name,
  ur.org_id,
  ur.scope_path
FROM user_roles_projection ur
JOIN users u ON u.id = ur.user_id
JOIN roles_projection r ON r.id = ur.role_id;

-- Should succeed (super_admin can assign roles)
INSERT INTO user_roles_projection (user_id, role_id, org_id, scope_path)
VALUES ('<user-uuid>', '<role-uuid>', 'org-123', 'analytics4change.org_123'::ltree);
```

**Test as Organization Admin**:
```sql
SET request.jwt.claims = '{"sub": "org-admin-id", "org_id": "org-123", "role": "provider_admin"}';

-- Should return:
-- 1. Own role assignments (via user_roles_own_select)
-- 2. All role assignments for org-123 (via user_roles_org_admin_select)
SELECT
  u.email,
  r.name as role_name,
  ur.org_id
FROM user_roles_projection ur
JOIN users u ON u.id = ur.user_id
JOIN roles_projection r ON r.id = ur.role_id
WHERE ur.org_id = 'org-123' OR ur.user_id = 'org-admin-id';
```

**Test as Regular User**:
```sql
SET request.jwt.claims = '{"sub": "user-id", "org_id": "org-456", "role": "clinician"}';

-- Should return ONLY own role assignments
SELECT
  r.name as role_name,
  ur.org_id,
  ur.scope_path
FROM user_roles_projection ur
JOIN roles_projection r ON r.id = ur.role_id
WHERE ur.user_id = 'user-id';
```

## Constraints

### Unique Constraint with NULLS NOT DISTINCT
```sql
UNIQUE NULLS NOT DISTINCT (user_id, role_id, org_id)
```

**PostgreSQL 15+ Feature**: Treats `NULL` as a distinct value for uniqueness

**Purpose**: Prevents duplicate role assignments

**Behavior**:
- `(user-1, role-clinician, org-123)` - ✅ Allowed
- `(user-1, role-clinician, org-123)` - ❌ Duplicate (violation)
- `(user-1, role-super_admin, NULL)` - ✅ Allowed
- `(user-1, role-super_admin, NULL)` - ❌ Duplicate (violation)

**Benefits**: Ensures super_admin (org_id = NULL) can only be assigned once per user

### Check Constraint: Scope Consistency
```sql
CHECK (
  (org_id IS NULL AND scope_path IS NULL)
  OR
  (org_id IS NOT NULL AND scope_path IS NOT NULL)
)
```

**Purpose**: Enforces global vs org-scoped assignment pattern

### Check Constraint: Role Date Order (user_roles_date_order_check)
```sql
CHECK (
  role_valid_from IS NULL
  OR role_valid_until IS NULL
  OR role_valid_from <= role_valid_until
)
```

**Purpose**: Ensures valid date ranges for temporal role assignments

**Rules**:
1. Both dates NULL → ✅ Valid (always active)
2. Only `role_valid_from` set → ✅ Valid (starts on date, never expires)
3. Only `role_valid_until` set → ✅ Valid (immediately active, expires on date)
4. Both dates set with `from <= until` → ✅ Valid (bounded window)
5. Both dates set with `from > until` → ❌ Invalid (constraint violation)

**Validation Examples**:
```sql
-- ✅ VALID: No date restrictions (default)
INSERT INTO user_roles_projection (user_id, role_id, org_id, scope_path)
VALUES ('user-1', 'role-clinician', 'org-123', 'analytics4change.org_123'::ltree);

-- ✅ VALID: Future start date, no expiration
INSERT INTO user_roles_projection (user_id, role_id, org_id, scope_path, role_valid_from)
VALUES ('user-2', 'role-admin', 'org-123', 'analytics4change.org_123'::ltree, '2025-02-01');

-- ✅ VALID: Immediate start, expires in 30 days
INSERT INTO user_roles_projection (user_id, role_id, org_id, scope_path, role_valid_until)
VALUES ('user-3', 'role-temp_admin', 'org-123', 'analytics4change.org_123'::ltree, '2025-02-05');

-- ✅ VALID: Bounded window (30-day temporary access)
INSERT INTO user_roles_projection (user_id, role_id, org_id, scope_path, role_valid_from, role_valid_until)
VALUES ('user-4', 'role-auditor', 'org-123', 'analytics4change.org_123'::ltree, '2025-01-15', '2025-02-14');

-- ❌ INVALID: End date before start date
INSERT INTO user_roles_projection (user_id, role_id, org_id, scope_path, role_valid_from, role_valid_until)
VALUES ('user-5', 'role-admin', 'org-123', 'analytics4change.org_123'::ltree, '2025-02-01', '2025-01-15');
-- ERROR: new row violates check constraint "user_roles_date_order_check"
```

### Scope Consistency Rules

1. **Global assignments** (super_admin):
   - MUST have `org_id = NULL`
   - MUST have `scope_path = NULL`

2. **Organization-scoped assignments**:
   - MUST have `org_id = <uuid>`
   - MUST have `scope_path = <ltree>`

**Validation Examples**:
```sql
-- ✅ VALID: Global super_admin assignment
INSERT INTO user_roles_projection (user_id, role_id, org_id, scope_path)
VALUES ('user-1', 'role-super_admin', NULL, NULL);

-- ✅ VALID: Org-scoped clinician assignment
INSERT INTO user_roles_projection (user_id, role_id, org_id, scope_path)
VALUES ('user-2', 'role-clinician', 'org-123', 'analytics4change.org_123'::ltree);

-- ❌ INVALID: org_id without scope_path
INSERT INTO user_roles_projection (user_id, role_id, org_id, scope_path)
VALUES ('user-3', 'role-admin', 'org-456', NULL);
-- ERROR: new row violates check constraint

-- ❌ INVALID: scope_path without org_id
INSERT INTO user_roles_projection (user_id, role_id, org_id, scope_path)
VALUES ('user-4', 'role-manager', NULL, 'analytics4change.org_789'::ltree);
-- ERROR: new row violates check constraint
```

## Helper Functions

### is_role_active(date, date)

**Signature**:
```sql
CREATE OR REPLACE FUNCTION public.is_role_active(
    p_role_valid_from date,
    p_role_valid_until date
)
RETURNS boolean
```

**Purpose**: Checks if a role assignment is currently active based on its date window.

**Logic**:
- Returns `true` if `role_valid_from` is NULL or <= CURRENT_DATE
- AND `role_valid_until` is NULL or >= CURRENT_DATE

**Usage**:
```sql
SELECT
  r.name as role_name,
  is_role_active(ur.role_valid_from, ur.role_valid_until) as is_active
FROM user_roles_projection ur
JOIN roles_projection r ON r.id = ur.role_id
WHERE ur.user_id = '<user-uuid>';
```

**Location**: `infrastructure/supabase/supabase/migrations/20251231220940_role_access_dates.sql`

### get_user_active_roles(uuid, uuid)

**Signature**:
```sql
CREATE OR REPLACE FUNCTION public.get_user_active_roles(
    p_user_id uuid,
    p_org_id uuid DEFAULT NULL
)
RETURNS TABLE (
    role_id uuid,
    role_name text,
    organization_id uuid,
    scope_path extensions.ltree
)
```

**Purpose**: Returns user's currently active roles, respecting BOTH org-level access dates (from `user_org_access`) AND role-level access dates.

**Logic**:
1. Filters `user_roles_projection` by user_id (and optionally org_id)
2. Checks role-level dates: `role_valid_from <= CURRENT_DATE` and `role_valid_until >= CURRENT_DATE`
3. For org-scoped roles, also checks user-org level dates from `user_org_access`
4. Global roles (`org_id IS NULL`) skip org-level access check
5. Returns intersection: roles active within BOTH windows

**Access Date Intersection**:
```
Effective Access = (User-Org Access Window) ∩ (Role-Level Window)

Example:
  User-Org Access: 2025-01-01 to 2025-12-31
  Role Window: 2025-03-01 to 2025-06-30
  Effective: 2025-03-01 to 2025-06-30 (role window is narrower)

Example 2:
  User-Org Access: 2025-06-01 to 2025-12-31
  Role Window: 2025-03-01 to 2025-09-30
  Effective: 2025-06-01 to 2025-09-30 (intersection of both)
```

**Usage**:
```sql
-- Get all active roles for a user
SELECT * FROM get_user_active_roles('user-123');

-- Get active roles for a user in specific organization
SELECT * FROM get_user_active_roles('user-123', 'org-456');
```

**Security**: `SECURITY DEFINER` with `SET search_path = public` for RLS bypass during authorization queries.

**Location**: `infrastructure/supabase/supabase/migrations/20251231220940_role_access_dates.sql`

## CQRS Event Sourcing

### Source Events

**Event Types**:
1. `user.role.assigned` - Role assigned to user
2. `user.role.revoked` - Role removed from user

**Event Payload (user.role.assigned)**:
```typescript
{
  event_type: 'user.role.assigned',
  aggregate_id: '<user-uuid>',
  aggregate_type: 'user',
  payload: {
    user_id: '<user-uuid>',
    role_id: '<role-uuid>',
    org_id: '<org-uuid>' | null,       // NULL for super_admin
    scope_path: 'analytics4change.org_123' | null
  },
  metadata: {
    user_id: '<admin-uuid>',            // Who made the assignment
    correlation_id: '<uuid>',
    timestamp: '2025-01-13T10:30:00Z'
  }
}
```

**Event Payload (user.role.revoked)**:
```typescript
{
  event_type: 'user.role.revoked',
  aggregate_id: '<user-uuid>',
  aggregate_type: 'user',
  payload: {
    user_id: '<user-uuid>',
    role_id: '<role-uuid>',
    org_id: '<org-uuid>' | null
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

**Processing Logic (user.role.assigned)**:
```sql
WHEN 'user.role.assigned' THEN
  INSERT INTO user_roles_projection (
    user_id,
    role_id,
    org_id,
    scope_path,
    assigned_at
  )
  SELECT
    (event_payload->>'user_id')::UUID,
    (event_payload->>'role_id')::UUID,
    NULLIF(event_payload->>'org_id', 'null')::UUID,
    NULLIF(event_payload->>'scope_path', 'null')::LTREE,
    NOW()
  ON CONFLICT (user_id, role_id, org_id) DO NOTHING;
```

**Processing Logic (user.role.revoked)**:
```sql
WHEN 'user.role.revoked' THEN
  DELETE FROM user_roles_projection
  WHERE user_id = (event_payload->>'user_id')::UUID
    AND role_id = (event_payload->>'role_id')::UUID
    AND org_id IS NOT DISTINCT FROM (event_payload->>'org_id')::UUID;
```

**Idempotency**:
- Assign: `ON CONFLICT DO NOTHING` prevents duplicate assignments
- Revoke: DELETE with IS NOT DISTINCT FROM handles NULL org_id correctly

**Trigger**: Executed automatically via `process_domain_event_trigger` on `domain_events` INSERT

## Common Queries

### Get All Roles for a User

```sql
SELECT
  r.name as role_name,
  r.description,
  ur.org_id,
  o.name as organization_name,
  ur.scope_path,
  ur.assigned_at
FROM user_roles_projection ur
JOIN roles_projection r ON r.id = ur.role_id
LEFT JOIN organizations_projection o ON o.id = ur.org_id
WHERE ur.user_id = '<user-uuid>'
ORDER BY ur.org_id NULLS FIRST, r.name;
```

**Output**:
```
role_name       | description               | org_id   | organization_name | scope_path                        | assigned_at
----------------|---------------------------|----------|-------------------|-----------------------------------|--------------------
super_admin     | Platform super admin      | NULL     | NULL              | NULL                              | 2025-01-10 10:00:00
provider_admin  | Org administrator         | org-123  | ABC Provider      | analytics4change.org_123          | 2025-01-11 14:30:00
clinician       | Clinical staff            | org-456  | XYZ Health        | analytics4change.org_456.fac_789  | 2025-01-12 09:15:00
```

### Find All Users with Specific Role in Organization

```sql
SELECT
  u.id,
  u.email,
  u.first_name,
  u.last_name,
  ur.scope_path,
  ur.assigned_at
FROM user_roles_projection ur
JOIN users u ON u.id = ur.user_id
JOIN roles_projection r ON r.id = ur.role_id
WHERE r.name = 'clinician'
  AND ur.org_id = 'org-123'
ORDER BY u.last_name, u.first_name;
```

**Use Case**: Contact all clinicians in organization, role distribution analysis

### Check if User Has Role in Organization

```sql
SELECT EXISTS (
  SELECT 1
  FROM user_roles_projection ur
  JOIN roles_projection r ON r.id = ur.role_id
  WHERE ur.user_id = '<user-uuid>'
    AND r.name = 'provider_admin'
    AND ur.org_id = '<org-uuid>'
) AS has_role;
```

**Use Case**: Authorization check, admin privilege validation

### Find Users with Multiple Roles

```sql
SELECT
  u.email,
  u.first_name,
  u.last_name,
  COUNT(DISTINCT ur.role_id) as role_count,
  ARRAY_AGG(DISTINCT r.name) as roles
FROM users u
JOIN user_roles_projection ur ON ur.user_id = u.id
JOIN roles_projection r ON r.id = ur.role_id
GROUP BY u.id, u.email, u.first_name, u.last_name
HAVING COUNT(DISTINCT ur.role_id) > 1
ORDER BY role_count DESC;
```

**Use Case**: Identify power users, audit complex access patterns

### Find All Global Super Admins

```sql
SELECT
  u.id,
  u.email,
  u.first_name,
  u.last_name,
  ur.assigned_at
FROM user_roles_projection ur
JOIN users u ON u.id = ur.user_id
JOIN roles_projection r ON r.id = ur.role_id
WHERE r.name = 'super_admin'
  AND ur.org_id IS NULL
ORDER BY ur.assigned_at;
```

**Use Case**: Security audit, emergency contact list

### Find Users with Roles Across Multiple Organizations

```sql
SELECT
  u.email,
  COUNT(DISTINCT ur.org_id) as org_count,
  ARRAY_AGG(DISTINCT o.name) as organizations
FROM users u
JOIN user_roles_projection ur ON ur.user_id = u.id AND ur.org_id IS NOT NULL
JOIN organizations_projection o ON o.id = ur.org_id
GROUP BY u.id, u.email
HAVING COUNT(DISTINCT ur.org_id) > 1
ORDER BY org_count DESC;
```

**Use Case**: Multi-tenant access patterns, consultant accounts

## Usage Examples

### 1. Assign Role to User (via Event)

**Scenario**: Assign 'clinician' role to new hire

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
    .select('id')
    .eq('name', params.role_name)
    .maybeSingle();

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

  // user_roles_projection updated automatically via trigger
}

// Usage: Assign org-scoped clinician role
await assignRoleToUser({
  user_id: 'user-789',
  role_name: 'clinician',
  org_id: 'org-123',
  scope_path: 'analytics4change.org_123.facility_456'
});
```

### 2. Revoke Role from User (via Event)

**Scenario**: Remove 'facility_admin' role from transferred employee

```typescript
// Temporal Activity: RevokeRoleFromUserActivity
async function revokeRoleFromUser(params: {
  user_id: string;
  role_name: string;
  org_id: string | null;
}) {
  const { data: role } = await supabase
    .from('roles_projection')
    .select('id')
    .eq('name', params.role_name)
    .single();

  if (!role) {
    throw new Error(`Role not found: ${params.role_name}`);
  }

  await supabase.from('domain_events').insert({
    event_type: 'user.role.revoked',
    aggregate_id: params.user_id,
    aggregate_type: 'user',
    payload: {
      user_id: params.user_id,
      role_id: role.id,
      org_id: params.org_id
    },
    metadata: {
      user_id: getCurrentUserId(),
      correlation_id: uuidv4()
    }
  });
}

// Usage
await revokeRoleFromUser({
  user_id: 'user-456',
  role_name: 'facility_admin',
  org_id: 'org-123'
});
```

### 3. Populate JWT Custom Claims with User's Roles

**Scenario**: JWT hook queries user roles for custom claims

```sql
-- From: custom_access_token_hook()
-- infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql

-- Get user's primary role (first by org_id precedence)
SELECT
  r.name as role,
  ur.org_id,
  ur.scope_path
FROM public.user_roles_projection ur
JOIN public.roles_projection r ON r.id = ur.role_id
WHERE ur.user_id = auth_user_id
ORDER BY
  CASE WHEN ur.org_id IS NULL THEN 0 ELSE 1 END,  -- super_admin first
  ur.assigned_at DESC
LIMIT 1;

-- Get all user permissions (via roles)
SELECT DISTINCT p.name
FROM public.user_roles_projection ur
JOIN public.role_permissions_projection rp ON rp.role_id = ur.role_id
JOIN public.permissions_projection p ON p.id = rp.permission_id
WHERE ur.user_id = auth_user_id;
```

**Resulting JWT Claims**:
```json
{
  "sub": "user-123",
  "email": "clinician@provider.org",
  "org_id": "org-456",
  "role": "clinician",
  "scope_path": "analytics4change.org_456.facility_789",
  "permissions": ["clients.view", "clients.create", "medications.view", ...]
}
```

### 4. Bulk Role Assignment (Onboarding Workflow)

**Scenario**: Assign multiple roles during organization onboarding

```typescript
// Temporal Workflow: OnboardOrganizationStaffWorkflow
async function onboardStaff(params: {
  organization_id: string;
  staff: Array<{
    user_id: string;
    role_name: string;
    scope_path: string;
  }>;
}) {
  for (const staffMember of params.staff) {
    await assignRoleToUser({
      user_id: staffMember.user_id,
      role_name: staffMember.role_name,
      org_id: params.organization_id,
      scope_path: staffMember.scope_path
    });

    // Small delay to avoid overwhelming event processor
    await sleep(100);
  }
}

// Usage
await onboardStaff({
  organization_id: 'org-123',
  staff: [
    { user_id: 'user-1', role_name: 'provider_admin', scope_path: 'analytics4change.org_123' },
    { user_id: 'user-2', role_name: 'facility_admin', scope_path: 'analytics4change.org_123.facility_456' },
    { user_id: 'user-3', role_name: 'clinician', scope_path: 'analytics4change.org_123.facility_456' },
    { user_id: 'user-4', role_name: 'clinician', scope_path: 'analytics4change.org_123.facility_456' }
  ]
});
```

## Audit Trail

### User Role Assignment History
```sql
-- Full event history for user's role assignments
SELECT
  de.event_type,
  de.occurred_at,
  r.name as role_name,
  de.payload->>'org_id' as org_id,
  de.metadata->>'user_id' as assigned_by
FROM domain_events de
JOIN roles_projection r ON r.id = (de.payload->>'role_id')::UUID
WHERE de.aggregate_type = 'user'
  AND de.aggregate_id = '<user-uuid>'
  AND de.event_type IN ('user.role.assigned', 'user.role.revoked')
ORDER BY de.occurred_at DESC;
```

### Recent Role Assignments by Organization
```sql
SELECT
  u.email,
  r.name as role_name,
  ur.scope_path,
  ur.assigned_at,
  EXTRACT(epoch FROM (NOW() - ur.assigned_at)) / 86400 as days_ago
FROM user_roles_projection ur
JOIN users u ON u.id = ur.user_id
JOIN roles_projection r ON r.id = ur.role_id
WHERE ur.org_id = 'org-123'
  AND ur.assigned_at > NOW() - INTERVAL '30 days'
ORDER BY ur.assigned_at DESC;
```

## Troubleshooting

### Issue: User Not Getting Expected Permissions

**Symptoms**: User lacks permissions despite role assignment

**Diagnosis**:
```sql
-- 1. Check if user has role assignment
SELECT
  r.name as role_name,
  ur.org_id,
  ur.scope_path
FROM user_roles_projection ur
JOIN roles_projection r ON r.id = ur.role_id
WHERE ur.user_id = '<user-uuid>';

-- 2. Check if role has expected permissions
SELECT
  r.name as role_name,
  p.name as permission_name
FROM roles_projection r
JOIN role_permissions_projection rp ON rp.role_id = r.id
JOIN permissions_projection p ON p.id = rp.permission_id
WHERE r.id = '<role-uuid>';

-- 3. Check JWT age (may have stale claims)
-- User needs to re-authenticate to get updated permissions
```

**Common Causes**:
1. Role not assigned → Check domain events for `user.role.assigned`
2. Role missing permissions → Grant permissions to role
3. JWT issued before assignment → User must re-login
4. Wrong org_id → Verify org_id matches user's current organization

### Issue: Duplicate Role Assignment Error

**Symptoms**: Cannot assign role that user already has

**Expected Behavior**: Idempotent (ON CONFLICT DO NOTHING), no error

**Diagnosis**:
```sql
-- Check existing assignment
SELECT * FROM user_roles_projection
WHERE user_id = '<user-uuid>'
  AND role_id = '<role-uuid>'
  AND org_id IS NOT DISTINCT FROM '<org-uuid>';
```

**Resolution**: Duplicate assignments are handled gracefully (no action needed)

### Issue: Cannot Remove Super Admin Role

**Symptoms**: Platform requires at least one super_admin

**Solution**: Application-level validation (not database constraint)
```typescript
// Before revoking super_admin role
const { data: superAdminCount } = await supabase
  .from('user_roles_projection')
  .select('count', { count: 'exact' })
  .eq('roles_projection.name', 'super_admin')
  .is('org_id', null);

if (superAdminCount.count <= 1) {
  throw new Error('Cannot revoke last super_admin role');
}
```

## Performance Considerations

### Authorization Query Performance
```sql
EXPLAIN ANALYZE
SELECT r.name, ur.scope_path
FROM user_roles_projection ur
JOIN roles_projection r ON r.id = ur.role_id
WHERE ur.user_id = '<user-uuid>';

-- Expected: Nested Loop with Index Scans
-- Cost: < 1ms for typical user (1-5 role assignments)
```

### JWT Generation Performance
- **Pattern**: JWT hook queries user_roles_projection on every authentication
- **Optimization**: Composite index `idx_user_roles_auth_lookup (user_id, org_id)`
- **Caching**: JWTs cached until expiration (typically 1 hour)

### Write Pattern
- **Frequency**: Moderate (user onboarding, role changes)
- **Idempotency**: Safe to replay events
- **Cleanup**: Revoked roles removed from projection (not soft deleted)

## Related Tables

- **users** - User identity records
- **roles_projection** - Role definitions with org scoping
- **role_permissions_projection** - Permission grants to roles
- **permissions_projection** - Individual permission definitions
- **domain_events** - Source of truth for role assignments

## Migration History

**Initial Schema**: Created with RBAC system (2024-Q4)

**Schema Changes**:
- Added composite index `idx_user_roles_auth_lookup` (2025-01-08) - JWT generation optimization
- Changed UNIQUE constraint to NULLS NOT DISTINCT (2025-01-05) - PostgreSQL 15+ upgrade
- Migration from Zitadel to Supabase Auth (2025-10-27) - No schema changes
- Added role-level temporal columns (2025-12-31) - `role_valid_from`, `role_valid_until` for time-limited role assignments
  - Added `user_roles_date_order_check` constraint
  - Added `idx_user_roles_expiring` and `idx_user_roles_pending_start` indexes
  - Added `is_role_active()` and `get_user_active_roles()` helper functions

## References

- **RLS Policies**: `infrastructure/supabase/sql/06-rls/001-core-projection-policies.sql:204-238`
- **Event Processor**: `infrastructure/supabase/sql/03-functions/event-processing/004-process-rbac-events.sql:95-130`
- **JWT Hook**: `infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql:38-106`
- **Table Definition**: `infrastructure/supabase/sql/02-tables/rbac/004-user_roles_projection.sql`
- **Check Constraint**: `infrastructure/supabase/sql/02-tables/rbac/004-user_roles_projection.sql:18-23`
- **Role Access Dates Migration**: `infrastructure/supabase/supabase/migrations/20251231220940_role_access_dates.sql`
