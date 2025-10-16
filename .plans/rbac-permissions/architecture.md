# Permission-Based RBAC Architecture

## Overview

A4C AppSuite implements a **permission-based Role-Based Access Control (RBAC)** system built on an event-sourced foundation. All permission grants, role assignments, and authorization changes are captured as immutable events in the `domain_events` table and projected to queryable tables for efficient access control checks.

**Core Principle**: Permissions are the atomic unit of authorization. Roles are collections of permissions. This provides maximum flexibility for future expansion while starting with just two foundational roles.

---

## Event Sourcing Foundation

### CRITICAL: All Tables Are Projections

**Source of Truth**: The `domain_events` table is the single source of truth for all permission and role data.

**Read Models (Projections)**: All schemas shown in this document are CQRS projections—materialized views of the event stream optimized for querying. They are **NOT** directly updated; instead, they are automatically maintained by database triggers that process events.

**Reference Documentation**: For complete CQRS/Event Sourcing architecture details, see:
- `/infrastructure/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md` - Full event-driven architecture specification
- `/frontend/docs/EVENT-DRIVEN-GUIDE.md` - Frontend implementation patterns

**How It Works**:
```
Permission Change Request
  ↓
Emit Event (e.g., role.permission.granted)
  ↓
Insert into domain_events table
  ↓
Database Trigger Fires
  ↓
Event Processor Updates Projection Tables
  ↓
Authorization Check Queries Projection
```

**Benefits for RBAC**:
- **Full Audit Trail**: Every permission change is permanently recorded
- **Temporal Queries**: Can reconstruct permissions at any point in time
- **Compliance**: HIPAA-compliant immutable audit log
- **Debugging**: Trace exactly when/why permissions changed
- **Rollback**: Can replay events to recover from errors

---

## Permission Model

### Permission Structure

Permissions are defined per **applet** (distinct functional modules in the application). Each permission represents a specific action that can be performed within that applet.

**Naming Convention**: `applet.action`

**Permission Types**:
- **CRUD Permissions**: `create`, `view`, `update`, `delete`
- **Custom Permissions**: Domain-specific actions beyond CRUD

### Initial Permission Catalog

#### Medication Management Applet

- `medication.create` - Create new medication prescriptions
- `medication.view` - View medication history and prescriptions
- `medication.update` - Modify existing prescriptions
- `medication.delete` - Discontinue/archive medications
- `medication.approve` - Approve prescription changes (requires higher role)

#### Organization Management Applet

- `organization.create_root` - Create top-level organizations (Platform Owner only) - **IMPLEMENTED ✅** via bootstrap architecture
- `organization.create_sub` - Create sub-organizations within hierarchy
- `organization.view` - View organization information and hierarchy
- `organization.update` - Update organization information
- `organization.deactivate` - Deactivate organizations (billing, compliance, operational)
- `organization.delete` - Delete organizations with cascade handling
- `organization.business_profile_create` - Create business profiles (Platform Owner only) - **IMPLEMENTED ✅** via bootstrap architecture
- `organization.business_profile_update` - Update business profiles

**Bootstrap Integration**: Organization creation now uses event-driven bootstrap architecture documented in `.plans/provider-management/bootstrap-workflows.md`. The `organization.create_root` permission triggers the `orchestrate_organization_bootstrap()` workflow.

#### Client Management Applet

- `client.create` - Register new clients
- `client.view` - View client records
- `client.update` - Modify client information
- `client.delete` - Archive clients
- `client.discharge` - Discharge clients from programs

#### User Management Applet

- `user.create` - Create new user accounts
- `user.view` - View user profiles
- `user.update` - Modify user accounts
- `user.delete` - Deactivate users
- `user.assign_role` - Grant roles to users

#### Access Grant Applet (Cross-Tenant) - **IMPLEMENTED ✅**

- `access_grant.create` - Create cross-tenant access grants - **IMPLEMENTED ✅**
- `access_grant.view` - View existing grants - **IMPLEMENTED ✅**
- `access_grant.revoke` - Revoke cross-tenant access - **IMPLEMENTED ✅**
- `access_grant.approve` - Approve Provider Partner access requests

**Implementation Status**: Cross-tenant access grant management is fully implemented via event-sourced `access_grant.*` events. See:
- Event contracts: `/infrastructure/supabase/contracts/asyncapi/domains/access_grant.yaml`
- Event processors: `/infrastructure/supabase/sql/03-functions/event-processing/006-process-access-grant-events.sql`
- Projection table: `/infrastructure/supabase/sql/02-tables/rbac/005-cross_tenant_access_grants_projection.sql`

#### Audit Applet

- `audit.view` - View audit logs
- `audit.export` - Export audit trails for compliance

### Permission Metadata

Each permission includes:
- **applet**: Functional module (e.g., "medication")
- **action**: Specific capability (e.g., "create")
- **name**: Full permission identifier (e.g., "medication.create")
- **description**: Human-readable explanation
- **requires_mfa**: Boolean flag for sensitive operations
- **scope_type**: `'global' | 'org' | 'unit' | 'client'` - **Semantic tag** for permission scope (NOT enforced hierarchy levels)

**IMPORTANT**: `scope_type` values are semantic labels, not enforced organizational structure. Providers define their own hierarchies (`facility`, `program`, `campus`, `home`, `pod`, etc.), and permissions use flexible `scope_path` (ltree) for actual scoping.

---

## Role Model

### Initial Roles (Phase 1)

We start with just **two foundational roles** that map cleanly to Zitadel organization ownership models:

#### 1. `super_admin`

**Zitadel Mapping**: `IAM_OWNER` (Instance-level owner)

**Scope**: All organizations (present and future)

**Permissions**: **ALL** permissions across **ALL** applets

**Characteristics**:
- Instance-wide access (cross-tenant by design)
- Can impersonate any user in any organization
- Can create/manage all Provider and Provider Partner organizations
- Can assign roles to any user
- Requires MFA for all operations

**Use Cases**:
- A4C platform support staff
- Emergency access scenarios
- Platform administration and configuration
- Compliance audits requiring cross-tenant visibility

**Event Assignment**:
```json
{
  "event_type": "user.role.assigned",
  "stream_id": "user-id",
  "stream_type": "user",
  "event_data": {
    "role_id": "super_admin_role_id",
    "org_id": "*",  // Wildcard indicates all orgs
    "scope_path": "*",  // Global scope
    "assigned_by": "super-admin-id"
  },
  "event_metadata": {
    "user_id": "assigning-super-admin-id",
    "reason": "Granting platform-wide administrative access to new A4C support engineer",
    "requires_mfa": true
  }
}
```

#### 2. `provider_admin`

**Zitadel Mapping**: `ORG_OWNER` (Organization-level owner)

**Scope**: Single Provider organization (their subdomain only)

**Permissions**: **ALL** permissions within their organization's applets

**Characteristics**:
- Organization-scoped access (single tenant)
- Can manage all users, clients, facilities, programs within their org
- Can view/approve cross-tenant access grants to their data
- Cannot access other Provider organizations
- Cannot impersonate users (not in permission set)

**Use Cases**:
- Healthcare organization administrators
- Facility directors
- Organization-level configuration and user management

**Event Assignment**:
```json
{
  "event_type": "user.role.assigned",
  "stream_id": "user-id",
  "stream_type": "user",
  "event_data": {
    "role_id": "provider_admin_role_id",
    "org_id": "acme_healthcare_001",
    "scope_path": "org_acme_healthcare_001",  // ltree path
    "assigned_by": "super-admin-id"
  },
  "event_metadata": {
    "user_id": "assigning-super-admin-id",
    "reason": "Granting organization administrator role to new Acme Healthcare facility director"
  }
}
```

### Role Extensibility (Future Phases)

The event-sourced architecture allows easy addition of new roles:

**Planned Future Roles**:
- `facility_admin` - Scoped to specific facility within organization
- `program_manager` - Scoped to specific program
- `clinician` - Limited to client care operations
- `read_only_auditor` - Audit log access only
- `partner_admin` - Provider Partner scoped access

**Adding a New Role**:
1. Emit `role.created` event with role definition
2. Emit `role.permission.granted` events for each permission
3. Assign to users via `user.role.assigned` events
4. Projections automatically updated

---

## Event Schemas

### Permission Events

#### `permission.defined`

Emitted when a new permission is created in the system.

```typescript
interface PermissionDefinedEvent {
  event_type: 'permission.defined';
  stream_id: string;  // Permission UUID
  stream_type: 'permission';
  event_data: {
    applet: string;  // e.g., 'medication'
    action: string;  // e.g., 'create'
    name: string;  // Generated: 'medication.create'
    description: string;
    scope_type: 'global' | 'org' | 'facility' | 'program' | 'client';
    requires_mfa: boolean;
  };
  event_metadata: {
    user_id: string;  // Super Admin who defined permission
    reason: string;  // e.g., "Adding new permission for medication approval workflow"
  };
}
```

**Projection Processing**:
```sql
INSERT INTO permissions_projection (id, applet, action, description, scope_type, requires_mfa)
VALUES (
  p_event.stream_id,
  p_event.event_data->>'applet',
  p_event.event_data->>'action',
  p_event.event_data->>'description',
  p_event.event_data->>'scope_type',
  (p_event.event_data->>'requires_mfa')::BOOLEAN
);
```

### Role Events

#### `role.created`

Emitted when a new role is defined.

```typescript
interface RoleCreatedEvent {
  event_type: 'role.created';
  stream_id: string;  // Role UUID
  stream_type: 'role';
  event_data: {
    name: string;  // e.g., 'provider_admin'
    description: string;
    zitadel_org_id?: string;  // NULL for super_admin (all orgs)
    org_hierarchy_scope?: string;  // ltree path or wildcard
  };
  event_metadata: {
    user_id: string;
    reason: string;  // e.g., "Creating provider administrator role for organization-level management"
  };
}
```

#### `role.permission.granted`

Emitted when a permission is added to a role.

```typescript
interface RolePermissionGrantedEvent {
  event_type: 'role.permission.granted';
  stream_id: string;  // Role UUID
  stream_type: 'role';
  event_data: {
    permission_id: string;  // UUID of permission being granted
    permission_name: string;  // e.g., 'medication.create' (for logging)
  };
  event_metadata: {
    user_id: string;
    reason: string;  // e.g., "Granting medication creation permission to provider_admin role"
  };
}
```

**Projection Processing**:
```sql
INSERT INTO role_permissions_projection (role_id, permission_id)
VALUES (
  p_event.stream_id,
  (p_event.event_data->>'permission_id')::UUID
)
ON CONFLICT DO NOTHING;  -- Idempotent
```

#### `role.permission.revoked`

Emitted when a permission is removed from a role.

```typescript
interface RolePermissionRevokedEvent {
  event_type: 'role.permission.revoked';
  stream_id: string;  // Role UUID
  stream_type: 'role';
  event_data: {
    permission_id: string;
    permission_name: string;
    revocation_reason: string;
  };
  event_metadata: {
    user_id: string;
    reason: string;  // e.g., "Removing impersonation permission from provider_admin due to security policy change"
  };
}
```

**Projection Processing**:
```sql
DELETE FROM role_permissions_projection
WHERE role_id = p_event.stream_id
  AND permission_id = (p_event.event_data->>'permission_id')::UUID;
```

### User Role Events

#### `user.role.assigned`

Emitted when a role is granted to a user.

```typescript
interface UserRoleAssignedEvent {
  event_type: 'user.role.assigned';
  stream_id: string;  // User UUID
  stream_type: 'user';
  event_data: {
    role_id: string;
    role_name: string;  // e.g., 'provider_admin'
    org_id: string;  // '*' for super_admin, specific org for provider_admin
    scope_path: string;  // ltree path or '*' for global
    assigned_by: string;  // User who performed assignment
  };
  event_metadata: {
    user_id: string;  // User performing the assignment
    reason: string;  // e.g., "Granting provider administrator access to manage Acme Healthcare organization"
  };
}
```

**Projection Processing**:
```sql
INSERT INTO user_roles_projection (user_id, role_id, org_id, scope_path)
VALUES (
  p_event.stream_id,
  (p_event.event_data->>'role_id')::UUID,
  p_event.event_data->>'org_id',
  (p_event.event_data->>'scope_path')::LTREE
)
ON CONFLICT (user_id, role_id, org_id) DO NOTHING;
```

**Bootstrap Integration**: Role assignment events are automatically emitted during organization bootstrap. When a new provider organization is created via the bootstrap architecture, a `user.role.assigned` event is emitted to grant the `provider_admin` role to the initial administrator. See implementation in `/infrastructure/supabase/sql/04-triggers/bootstrap-event-listener.sql`.

#### `user.role.revoked`

Emitted when a role is removed from a user.

```typescript
interface UserRoleRevokedEvent {
  event_type: 'user.role.revoked';
  stream_id: string;  // User UUID
  stream_type: 'user';
  event_data: {
    role_id: string;
    role_name: string;
    org_id: string;
    revoked_by: string;
  };
  event_metadata: {
    user_id: string;
    reason: string;  // e.g., "User terminated employment, revoking all access"
  };
}
```

---

## Database Schema (CQRS Projections)

**REMINDER**: These are read-model projections, not source-of-truth tables. They are automatically maintained by event processors.

### Permissions Projection

```sql
CREATE TABLE permissions_projection (
  id UUID PRIMARY KEY,
  applet TEXT NOT NULL,
  action TEXT NOT NULL,
  name TEXT GENERATED ALWAYS AS (applet || '.' || action) STORED,
  description TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'org', 'unit', 'client')),  -- Semantic tags, not enforced levels
  requires_mfa BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (applet, action)
);

CREATE INDEX idx_permissions_applet ON permissions_projection(applet);
CREATE INDEX idx_permissions_name ON permissions_projection(name);

COMMENT ON COLUMN permissions_projection.scope_type IS
  'Semantic label for permission scope. Values are flexible tags (not enforced hierarchy levels).
   Providers define their own organizational structure (facility/campus/home/pod/wing/etc).
   Actual scoping uses ltree paths in user_roles_projection.scope_path.';
```

### Roles Projection

```sql
CREATE TABLE roles_projection (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  zitadel_org_id TEXT,  -- NULL for super_admin (all orgs)
  org_hierarchy_scope LTREE,  -- NULL for super_admin, ltree path for org-scoped roles
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (
    (name = 'super_admin' AND zitadel_org_id IS NULL AND org_hierarchy_scope IS NULL)
    OR
    (name != 'super_admin' AND zitadel_org_id IS NOT NULL AND org_hierarchy_scope IS NOT NULL)
  )
);

CREATE INDEX idx_roles_zitadel_org ON roles_projection(zitadel_org_id);
```

### Role Permissions Projection

```sql
CREATE TABLE role_permissions_projection (
  role_id UUID NOT NULL REFERENCES roles_projection(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions_projection(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX idx_role_permissions_role ON role_permissions_projection(role_id);
CREATE INDEX idx_role_permissions_permission ON role_permissions_projection(permission_id);
```

### User Roles Projection

```sql
CREATE TABLE user_roles_projection (
  user_id UUID NOT NULL,
  role_id UUID NOT NULL REFERENCES roles_projection(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,  -- '*' for super_admin, specific org ID for org-scoped roles
  scope_path LTREE,  -- ltree hierarchy scope, NULL for global
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, role_id, org_id)
);

CREATE INDEX idx_user_roles_user ON user_roles_projection(user_id);
CREATE INDEX idx_user_roles_org ON user_roles_projection(org_id);
CREATE INDEX idx_user_roles_scope_path ON user_roles_projection USING GIST(scope_path);
```

---

## Authorization Patterns

### Permission Check Function

Authorization queries the projection tables to determine if a user has a specific permission:

```sql
CREATE OR REPLACE FUNCTION user_has_permission(
  p_user_id UUID,
  p_permission_name TEXT,
  p_org_id TEXT,
  p_scope_path LTREE DEFAULT NULL
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
        -- Super admin: wildcard org access
        ur.org_id = '*'
        OR
        -- Org-scoped: exact org match + hierarchical scope check
        (
          ur.org_id = p_org_id
          AND (
            p_scope_path IS NULL  -- No scope constraint
            OR p_scope_path <@ ur.scope_path  -- Scope within user's hierarchy
          )
        )
      )
  );
END;
$$ LANGUAGE plpgsql STABLE;
```

**Usage Examples (Provider-Defined Hierarchies)**:

```sql
-- Check if user can create medications in a specific organizational unit
-- Example 1: Detention Center (complex hierarchy)
SELECT user_has_permission(
  'user-uuid',
  'medication.create',
  'youth_detention_services_org_id',
  'org_youth_detention_services.main_facility.behavioral_health_wing'::LTREE
);

-- Example 2: Group Home Provider (simple flat hierarchy)
SELECT user_has_permission(
  'user-uuid',
  'medication.create',
  'homes_inc_org_id',
  'org_homes_inc.home_2'::LTREE
);

-- Example 3: Treatment Center (campus-based hierarchy)
SELECT user_has_permission(
  'user-uuid',
  'medication.create',
  'healing_horizons_org_id',
  'org_healing_horizons.north_campus.residential_unit_a'::LTREE
);
```

**Note**: Each Provider defines their own organizational structure. The permission system uses ltree paths for scoping, NOT prescribed hierarchy levels.

### Row-Level Security with Permissions

Integrate permission checks into RLS policies:

```sql
-- Example: Medications table RLS policy
CREATE POLICY medication_view_policy ON medications_projection
FOR SELECT
USING (
  -- Same-tenant access
  organization_id = current_setting('app.current_org')
  AND user_has_permission(
    current_setting('app.current_user')::UUID,
    'medication.view',
    organization_id,
    hierarchy_path
  )
  OR
  -- Cross-tenant access via grant
  EXISTS (
    SELECT 1 FROM cross_tenant_access_grants
    WHERE consultant_org_id = current_setting('app.current_org')
      AND provider_org_id = organization_id
      AND (expires_at IS NULL OR expires_at > NOW())
      AND revoked_at IS NULL
      AND user_has_permission(
        current_setting('app.current_user')::UUID,
        'medication.view',
        consultant_org_id
      )
  )
);
```

### Frontend Permission Checks

Frontend queries user permissions to conditionally render UI:

```typescript
// src/services/auth/permission.service.ts
import { supabase } from '@/lib/supabase';

export class PermissionService {
  async hasPermission(
    permissionName: string,
    orgId: string,
    scopePath?: string
  ): Promise<boolean> {
    const { data, error } = await supabase.rpc('user_has_permission', {
      p_user_id: this.currentUser.id,
      p_permission_name: permissionName,
      p_org_id: orgId,
      p_scope_path: scopePath
    });

    if (error) {
      console.error('Permission check failed:', error);
      return false;
    }

    return data === true;
  }

  async getUserPermissions(orgId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('user_permissions_view')  // Materialized view for efficiency
      .select('permission_name')
      .eq('user_id', this.currentUser.id)
      .eq('org_id', orgId);

    if (error) throw error;
    return data.map(row => row.permission_name);
  }
}
```

**React Component Example**:
```tsx
import { usePermissions } from '@/hooks/usePermissions';

export function MedicationForm() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('medication.create', currentOrg.id);

  if (!canCreate) {
    return <Alert>You do not have permission to create medications.</Alert>;
  }

  return <MedicationFormContent />;
}
```

### API Authorization

API endpoints validate permissions before processing commands:

```typescript
// Edge function example
import { PermissionService } from '@/services/permission.service';

export async function createMedication(req: Request) {
  const user = await authenticateRequest(req);
  const permissionService = new PermissionService(user);

  // Check permission
  const hasPermission = await permissionService.hasPermission(
    'medication.create',
    req.body.organization_id
  );

  if (!hasPermission) {
    return new Response(
      JSON.stringify({ error: 'Insufficient permissions' }),
      { status: 403 }
    );
  }

  // Emit event (permission already validated)
  await emitEvent('medication.prescribed', req.body, user);
}
```

### Impersonation Permission Inheritance

During impersonation, the Super Admin inherits the **target user's permissions** for the session:

```typescript
interface ImpersonationContext {
  sessionId: string;
  originalUserId: string;  // Super Admin
  targetUserId: string;    // User being impersonated
  targetOrgId: string;
  effectivePermissions: string[];  // Target user's permissions
}

// Authorization check during impersonation
async function checkPermissionDuringImpersonation(
  permissionName: string,
  impersonationCtx: ImpersonationContext
): Promise<boolean> {
  // Use target user's permissions, NOT super admin's
  return await hasPermission(
    impersonationCtx.targetUserId,  // Check as target user
    permissionName,
    impersonationCtx.targetOrgId
  );
}
```

**Rationale**: Super Admin should experience the application exactly as the target user sees it, including permission restrictions. This ensures accurate testing and support.

---

## Zitadel Integration

### Organization Ownership Mapping

Zitadel provides two levels of ownership that map to our role model:

**IAM_OWNER (Instance Admin)**:
- Zitadel instance-level owner
- Can manage all organizations
- Maps to: `super_admin` role
- Scope: All organizations (`org_id = '*'`)

**ORG_OWNER (Organization Admin)**:
- Zitadel organization-level owner
- Can manage single organization
- Maps to: `provider_admin` role
- Scope: Single organization (`org_id = specific org`)

### JWT Claims Structure

JWT tokens include permission context for authorization:

```json
{
  "sub": "user-id",
  "email": "user@example.com",
  "org_id": "acme_healthcare_001",
  "zitadel_org_role": "ORG_OWNER",
  "roles": ["provider_admin"],
  "permissions": [
    "medication.create",
    "medication.view",
    "client.create",
    "client.view"
  ],
  "scope_path": "org_acme_healthcare_001",
  "iat": 1728484000,
  "exp": 1728487600
}
```

**For Super Admin**:
```json
{
  "sub": "super-admin-id",
  "email": "admin@a4c.app",
  "org_id": "*",
  "zitadel_org_role": "IAM_OWNER",
  "roles": ["super_admin"],
  "permissions": ["*"],  // Wildcard indicates all permissions
  "scope_path": "*",
  "iat": 1728484000,
  "exp": 1728487600
}
```

### Role Synchronization

Roles are synchronized between Zitadel and PostgreSQL projections:

**Process**:
1. User assigned `ORG_OWNER` in Zitadel for an organization
2. Webhook triggers `user.role.assigned` event
3. Event processor updates `user_roles_projection`
4. User gains all permissions associated with `provider_admin` role

**Event Flow**:
```
Zitadel Role Assignment
  ↓
Webhook to Edge Function
  ↓
Emit user.role.assigned Event
  ↓
domain_events Table
  ↓
Trigger: process_user_role_event()
  ↓
user_roles_projection Updated
```

---

## Cross-Tenant Permissions

### Provider Partner Access

Provider Partners (VARs, court systems, families) access Provider data via **cross-tenant access grants**, which are also event-sourced:

**Event**: `access_grant.created`

```typescript
interface AccessGrantCreatedEvent {
  event_type: 'access_grant.created';
  stream_id: string;  // Grant UUID
  stream_type: 'access_grant';
  event_data: {
    consultant_org_id: string;  // Provider Partner org
    consultant_user_id?: string;  // Specific user or NULL for org-wide
    provider_org_id: string;  // Target Provider org
    scope: 'full_org' | 'facility' | 'client';
    scope_id?: string;  // Resource ID if scoped
    authorization_type: 'court_order' | 'parental_consent' | 'var_contract';
    legal_reference?: string;  // Court order #, consent form ID
    expires_at?: string;  // ISO timestamp
  };
  event_metadata: {
    user_id: string;  // Provider Admin or Super Admin
    reason: string;  // e.g., "Granting court access per order #2024-1234"
  };
}
```

**Projection Table**:
```sql
CREATE TABLE cross_tenant_access_grants_projection (
  id UUID PRIMARY KEY,
  consultant_org_id TEXT NOT NULL,
  consultant_user_id UUID,
  provider_org_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  scope_id UUID,
  granted_by UUID NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  authorization_type TEXT NOT NULL,
  legal_reference TEXT,
  metadata JSONB
);
```

**Permission Check with Grant**:
```sql
-- Provider Partner user accessing Provider data
SELECT user_has_permission(
  'provider-partner-user-id',
  'client.view',
  'provider-partner-org-id'  -- Their own org
)
AND EXISTS (
  SELECT 1 FROM cross_tenant_access_grants_projection
  WHERE consultant_org_id = 'provider-partner-org-id'
    AND provider_org_id = 'target-provider-org-id'
    AND (consultant_user_id IS NULL OR consultant_user_id = 'provider-partner-user-id')
    AND (expires_at IS NULL OR expires_at > NOW())
    AND revoked_at IS NULL
);
```

---

## Audit and Compliance

### Permission Change Audit Trail

Every permission change is captured as an immutable event:

**Queries for Compliance**:

```sql
-- All permission changes for a user
SELECT
  de.event_type,
  de.event_data->>'role_name' as role,
  de.event_metadata->>'reason' as reason,
  de.created_at,
  u.name as changed_by
FROM domain_events de
JOIN users u ON u.id = (de.event_metadata->>'user_id')::UUID
WHERE de.stream_id = 'user-id'
  AND de.stream_type = 'user'
  AND de.event_type IN ('user.role.assigned', 'user.role.revoked')
ORDER BY de.created_at DESC;

-- All role permission grants
SELECT
  de.event_type,
  de.stream_id as role_id,
  de.event_data->>'permission_name' as permission,
  de.event_metadata->>'reason' as reason,
  de.created_at
FROM domain_events de
WHERE de.stream_type = 'role'
  AND de.event_type = 'role.permission.granted'
ORDER BY de.created_at DESC;

-- Cross-tenant access grants with legal basis
SELECT
  de.event_data->>'consultant_org_id' as provider_partner_org,
  de.event_data->>'provider_org_id' as provider_org,
  de.event_data->>'authorization_type' as legal_basis,
  de.event_data->>'legal_reference' as reference,
  de.event_metadata->>'reason' as reason,
  de.created_at as granted_at
FROM domain_events de
WHERE de.event_type = 'access_grant.created'
ORDER BY de.created_at DESC;
```

### HIPAA Compliance

**Required Audit Tracking**:
- **Who**: User ID in event metadata
- **What**: Permission granted/revoked in event data
- **When**: Event created_at timestamp
- **Why**: Required reason field in event metadata
- **Legal Basis**: Authorization type and reference for cross-tenant grants

**Retention**: All events retained for 7 years (standard healthcare compliance requirement)

**Immutability**: Events cannot be updated or deleted (enforced by database trigger)

---

## Implementation Roadmap

### Phase 1: Foundation (Current)

**Goal**: Establish event-driven RBAC with 2 foundational roles

**Deliverables**:
1. **Event Schemas**: Define all permission/role event types
2. **Database Projections**: Create projection tables and indexes
3. **Event Processors**: Implement triggers to maintain projections
4. **Initial Permissions**: Define permission catalog for core applets
5. **Initial Roles**: Create `super_admin` and `provider_admin` roles
6. **Permission Check Functions**: Implement `user_has_permission()` SQL function
7. **RLS Integration**: Add permission checks to existing RLS policies
8. **Frontend Service**: Create `PermissionService` for UI authorization
9. **API Middleware**: Add permission validation to API endpoints

**Testing**:
- Unit tests for event processors
- Integration tests for permission checks
- E2E tests for role assignment flows

### Phase 2: Zitadel Synchronization

**Goal**: Bidirectional sync between Zitadel and PostgreSQL projections

**Deliverables**:
1. **Webhook Integration**: Zitadel role assignment webhooks
2. **JWT Parsing**: Extract permissions from Zitadel tokens
3. **Sync Edge Function**: Handle Zitadel → PostgreSQL sync
4. **Conflict Resolution**: Handle out-of-sync scenarios

### Phase 3: Advanced Roles

**Goal**: Expand role model for granular access control

**Deliverables**:
1. **New Roles**: `facility_admin`, `program_manager`, `clinician`, etc.
2. **Hierarchical Scoping**: Fine-grained ltree-based permission scoping
3. **Role Templates**: Pre-configured role bundles for common use cases

### Phase 4: Self-Service

**Goal**: Enable Provider Admins to manage roles/permissions

**Deliverables**:
1. **Role Management UI**: Create/edit roles via events
2. **Permission Assignment UI**: Grant/revoke permissions to roles
3. **User Role Assignment UI**: Assign roles to users
4. **Approval Workflows**: Multi-step approval for sensitive permissions

---

## Security Considerations

### MFA Requirements

Sensitive permissions require MFA before assignment or use:

**Permissions Requiring MFA**:
- `provider.impersonate`
- `access_grant.create` (for cross-tenant grants)
- `user.assign_role` (for super_admin assignments)

**Enforcement**:
```typescript
// Before emitting sensitive event
if (permission.requires_mfa && !user.mfa_verified) {
  throw new Error('MFA verification required for this operation');
}
```

### Permission Escalation Prevention

**Rule**: Users can only grant permissions they themselves possess.

```sql
-- Validate before emitting user.role.assigned event
CREATE OR REPLACE FUNCTION validate_role_assignment(
  p_assigner_id UUID,
  p_assignee_id UUID,
  p_role_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
  -- Super admins can assign any role
  IF is_super_admin(p_assigner_id) THEN
    RETURN TRUE;
  END IF;

  -- Provider admins can only assign roles within their org
  IF is_provider_admin(p_assigner_id) THEN
    RETURN role_is_within_org(p_role_id, get_user_org(p_assigner_id));
  END IF;

  -- Others cannot assign roles
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;
```

### Event Tampering Protection

Events are immutable and cryptographically verified:

```sql
-- Prevent event modification
CREATE TRIGGER prevent_event_tampering
BEFORE UPDATE OR DELETE ON domain_events
FOR EACH ROW
EXECUTE FUNCTION raise_exception('Events are immutable for audit integrity');
```

---

## Appendix

### A. Complete Permission Catalog (Initial)

| Applet | Permissions | Description |
|--------|------------|-------------|
| medication | create, view, update, delete, approve | Medication management |
| organization | create_root, create_sub, view, update, deactivate, delete, business_profile_create, business_profile_update | Organization management |
| client | create, view, update, delete, discharge | Client records management |
| user | create, view, update, delete, assign_role | User account management |
| access_grant | create, view, revoke, approve | Cross-tenant access grants |
| audit | view, export | Audit log access |

### B. Role Permission Matrix

| Permission | super_admin | provider_admin |
|-----------|-------------|----------------|
| medication.* | ✅ | ✅ |
| organization.create_root | ✅ | ❌ |
| organization.create_sub | ✅ | ✅ (own org) |
| organization.view | ✅ | ✅ (own org) |
| organization.update | ✅ | ✅ (own org) |
| organization.deactivate | ✅ | ✅ (own org) |
| organization.delete | ✅ | ❌ |
| organization.business_profile_create | ✅ | ❌ |
| organization.business_profile_update | ✅ | ✅ (own org) |
| client.* | ✅ | ✅ (own org) |
| user.* | ✅ | ✅ (own org) |
| access_grant.create | ✅ | ✅ (own org data) |
| access_grant.approve | ✅ | ✅ (own org data) |
| audit.view | ✅ | ✅ (own org) |
| audit.export | ✅ | ✅ (own org) |

### C. Event Naming Conventions

**Format**: `entity.action`

**Examples**:
- `permission.defined`
- `role.created`
- `role.permission.granted`
- `user.role.assigned`
- `access_grant.created`

**Tense**: Past tense for state changes (created, granted, assigned)

### D. Related Documentation

- `/infrastructure/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md` - Event sourcing foundation
- `.plans/multi-tenancy/multi-tenancy-organization.html` - Multi-tenancy architecture
- `.plans/auth-integration/tenants-as-organization-thoughts.md` - Zitadel integration
- `.plans/impersonation/architecture.md` - Super Admin impersonation
- `.plans/consolidated/agent-observations.md` - Architectural overview

---

**Document Version**: 1.0
**Last Updated**: 2025-10-09
**Status**: Approved for Implementation
**Owner**: A4C Development Team
