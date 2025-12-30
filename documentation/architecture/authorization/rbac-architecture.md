---
status: current
last_updated: 2025-12-29
---

# Permission-Based RBAC Architecture

**Status**: ✅ Integrated with Supabase Auth + Temporal.io
**Last Updated**: 2025-10-27
**Authentication**: Supabase Auth with custom JWT claims (frontend implementation complete)

## Overview

A4C AppSuite implements a **permission-based Role-Based Access Control (RBAC)** system built on an event-sourced foundation. All permission grants, role assignments, and authorization changes are captured as immutable events in the `domain_events` table and projected to queryable tables for efficient access control checks.

**Core Principle**: Permissions are the atomic unit of authorization. Roles are collections of permissions. This provides maximum flexibility for future expansion while starting with just two foundational roles.

### Integration with Supabase Auth

**IMPORTANT**: This RBAC system is integrated with **Supabase Auth** (not Zitadel). Key integration points:

1. **JWT Custom Claims**: User permissions are added to JWT tokens via database hook
   - `permissions`: Array of permission strings (e.g., `["medication.create", "client.view"]`)
   - `user_role`: User's primary role (e.g., `"provider_admin"`)
   - `org_id`: User's active organization for RLS isolation
   - `scope_path`: Hierarchical scope for ltree queries

2. **RLS Policies**: Row-level security policies use JWT claims for authorization
   ```sql
   -- Example: Permission-based access
   CREATE POLICY "medication_create"
   ON medications FOR INSERT
   USING (
     'medication.create' = ANY(
       string_to_array(auth.jwt()->>'permissions', ',')
     )
   );
   ```

3. **Event-Driven Updates**: Permission changes emit events that trigger:
   - Projection updates (user_permissions_projection)
   - JWT refresh required for updated claims

**See Also**:
- **Supabase Auth Integration**: `.plans/supabase-auth-integration/overview.md`
- **Custom JWT Claims Setup**: `.plans/supabase-auth-integration/custom-claims-setup.md`
- **Temporal Workflows**: `.plans/temporal-integration/` (for organization bootstrap and user invitations)

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

- `medication.create` - Create new medication records
- `medication.view` - View medication records
- `medication.update` - Modify medication records
- `medication.delete` - Delete medication records
- `medication.administer` - Administer medications to clients

#### Organization Management Applet

**Global Scope (10 permissions):**
- `organization.activate` - Activate/reactivate organizations
- `organization.create` - Create organizations (general)
- `organization.create_root` - Create top-level organizations (Platform Owner only)
- `organization.deactivate` - Deactivate organizations
- `organization.delete` - Delete organizations with cascade handling
- `organization.search` - Search across all organizations
- `organization.suspend` - Suspend organization access
- `permission.grant` - Grant permissions to roles (catalog)
- `permission.revoke` - Revoke permissions from roles (catalog)
- `permission.view` - View permission catalog

**Org Scope (4 permissions):**
- `organization.view` - View organization details
- `organization.update` - Update organization settings
- `organization.view_ou` - View organizational unit hierarchy - **IMPLEMENTED ✅**
- `organization.create_ou` - Create organizational units within hierarchy - **IMPLEMENTED ✅**

**Bootstrap Integration**: Organization creation now uses event-driven bootstrap architecture. The bootstrap workflow grants all 23 org-scoped permissions to the provider_admin role.

#### Client Management Applet

- `client.create` - Create new clients in the organization
- `client.view` - View client records
- `client.update` - Update client information
- `client.delete` - Delete client records

#### User Management Applet

- `user.create` - Create/invite users to organization
- `user.view` - View user profiles and assignments
- `user.update` - Update user profiles
- `user.delete` - Remove users from organization
- `user.role_assign` - Assign roles to users
- `user.role_revoke` - Revoke roles from users

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
- **scope_type**: `'global' | 'org'` - Controls permission visibility by org_type

**Note**: `scope_type` determines which permissions are visible in the UI:
- `global`: Visible only to `platform_owner` org_type (A4C organization)
- `org`: Visible to all org_types (providers, provider partners, platform owner)

See [Scoping Architecture](./scoping-architecture.md) for details on how the three scoping mechanisms interact.

---

## Role Model

### Initial Roles (Phase 1)

We start with just **two foundational roles** that map cleanly to organization ownership models:

#### 1. `super_admin`

**Mapping**: Platform-level administrator (instance-wide owner)

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

**Mapping**: Organization-level administrator (single org owner)

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
    scope_type: 'global' | 'org';
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
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'org')),  -- Controls permission visibility by org_type
  requires_mfa BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (applet, action)
);

CREATE INDEX idx_permissions_applet ON permissions_projection(applet);
CREATE INDEX idx_permissions_name ON permissions_projection(name);

COMMENT ON COLUMN permissions_projection.scope_type IS
  'Controls permission visibility by org_type JWT claim.
   global = visible only to platform_owner org_type (A4C organization).
   org = visible to all org_types (providers, provider partners, platform owner).
   See scoping-architecture.md for details on the three scoping mechanisms.';
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

## Supabase Auth Integration

### Organization Ownership Mapping

The RBAC system maps to organization ownership models:

**Platform Administrator (super_admin)**:
- Platform-level instance owner
- Can manage all organizations
- Maps to: `super_admin` role
- Scope: All organizations (`org_id = '*'`)

**Organization Administrator (provider_admin)**:
- Organization-level owner
- Can manage single organization
- Maps to: `provider_admin` role
- Scope: Single organization (`org_id = specific org`)

### JWT Claims Structure

JWT tokens include permission context for authorization via Supabase Auth custom claims hook:

```json
{
  "sub": "user-id",
  "email": "user@example.com",
  "org_id": "acme_healthcare_001",
  "org_type": "provider",
  "user_role": "provider_admin",
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
  "org_type": "platform_owner",
  "user_role": "super_admin",
  "permissions": ["*"],  // Wildcard indicates all permissions
  "scope_path": "*",
  "iat": 1728484000,
  "exp": 1728487600
}
```

### Role Synchronization

Roles are synchronized between Supabase Auth and PostgreSQL projections:

**Process**:
1. User assigned role via admin action or organization bootstrap workflow
2. Action emits `user.role.assigned` event
3. Event processor updates `user_roles_projection`
4. User gains all permissions associated with assigned role
5. JWT custom claims hook includes permissions on next token refresh

**Event Flow**:
```
Role Assignment (UI or Workflow)
  ↓
Emit user.role.assigned Event
  ↓
domain_events Table
  ↓
Trigger: process_user_role_event()
  ↓
user_roles_projection Updated
  ↓
JWT Refresh → Updated Claims
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
- `organization.delete` (for organization deletion)
- `organization.deactivate` (for organization deactivation)
- `access_grant.create` (for cross-tenant grants)
- `user.role_assign` (for super_admin assignments)

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

### A. Complete Permission Catalog (31 Total)

**Global Permissions (10):**

| Permission | Description |
|------------|-------------|
| `organization.activate` | Activate/reactivate organizations |
| `organization.create` | Create organizations (general) |
| `organization.create_root` | Create top-level provider organizations |
| `organization.deactivate` | Deactivate organizations |
| `organization.delete` | Delete organizations with cascade handling |
| `organization.search` | Search across all organizations |
| `organization.suspend` | Suspend organization access |
| `permission.grant` | Grant permissions to roles (catalog) |
| `permission.revoke` | Revoke permissions from roles (catalog) |
| `permission.view` | View permission catalog |

**Org-Scoped Permissions (21):**

| Applet | Permissions | Description |
|--------|------------|-------------|
| organization | view, update, view_ou, create_ou | Org-level management (4) |
| client | create, view, update, delete | Client records management (4) |
| medication | create, view, update, delete, administer | Medication management (5) |
| role | create, view, update, delete | Role management (4) |
| user | create, view, update, delete, role_assign, role_revoke | User account management (6) |

### B. Role Permission Matrix

| Permission | super_admin | provider_admin |
|-----------|-------------|----------------|
| **Global (10)** | | |
| organization.activate | ✅ | ❌ |
| organization.create | ✅ | ❌ |
| organization.create_root | ✅ | ❌ |
| organization.deactivate | ✅ | ❌ |
| organization.delete | ✅ | ❌ |
| organization.search | ✅ | ❌ |
| organization.suspend | ✅ | ❌ |
| permission.grant | ✅ | ❌ |
| permission.revoke | ✅ | ❌ |
| permission.view | ✅ | ❌ |
| **Org-Scoped (21)** | | |
| organization.view | ✅ | ✅ (own org) |
| organization.update | ✅ | ✅ (own org) |
| organization.view_ou | ✅ | ✅ (own org) |
| organization.create_ou | ✅ | ✅ (own org) |
| client.* | ✅ | ✅ (own org) |
| medication.* | ✅ | ✅ (own org) |
| role.* | ✅ | ✅ (own org) |
| user.* | ✅ | ✅ (own org) |

### B.1 Organization Deletion Constraints and UX Requirements

The `organization.delete` permission implements role-specific constraints and mandatory UX safeguards to prevent accidental data loss while enabling safe organizational cleanup.

#### Permission Behavior by Role

**super_admin (Platform Owner)**:
- **Scope**: Unrestricted deletion of any organization
- **Constraints**: None (can delete organizations with active roles, users, and data)
- **MFA**: Required for all deletions
- **Use Case**: Platform-level cleanup, tenant offboarding, emergency operations

**provider_admin / partner_admin**:
- **Scope**: Organization-scoped deletion (`scope_type: 'org'`)
- **Constraints**: Can only delete **empty** organizational units within their hierarchy
- **MFA**: Required for all deletions
- **Use Case**: Restructuring provider hierarchies, removing obsolete organizational units

#### Empty Organizational Unit Definition

An OU is considered **empty** when ALL of the following conditions are met:

1. **No Roles Scoped to OU**: `COUNT(*) = 0 FROM roles_projection WHERE org_hierarchy_scope <@ target_ou_path AND deleted_at IS NULL`
2. **No Users Assigned to OU**: `COUNT(*) = 0 FROM user_roles_projection WHERE scope_path <@ target_ou_path AND deleted_at IS NULL`
3. **Child OUs Allowed**: Child organizational units do NOT block deletion (they will cascade delete if they are also empty)

**Validation Point**: Emptiness validation is enforced at the command handler level BEFORE emitting `organization.deleted` events. The event processor performs the same cascade deletion logic for all roles.

#### Cascade Deletion Behavior

**Event Processing**:
- Deletion emits `organization.deleted` event for parent OU
- Event processor automatically emits child `organization.deleted` events for all descendant OUs
- Roles scoped to deleted OUs receive `role.deleted` events
- All events preserve audit trail with `parent_deletion_event_id` metadata

**Soft Delete Strategy**:
- Organizations are logically deleted (`deleted_at` timestamp set)
- All data is preserved for audit/compliance
- No physical data deletion occurs

#### Mandatory UX Requirements

All deletion interfaces MUST implement these UX safeguards:

1. **Pre-Deletion Impact Analysis**: Display exact impact (OUs, roles, users, data) before allowing deletion
2. **Risk-Tiered Warnings**: LOW/MEDIUM/CRITICAL based on deletion scope
3. **Typed Confirmation**: Require user to type organization name (prevents accidental clicks)
4. **MFA Challenge**: Enforce multi-factor authentication for CRITICAL deletions (>10 OUs OR >50 users)
5. **Reversible Alternative**: Always offer `organization.deactivate` as safer option
6. **Blocker Guidance**: For provider_admin, show exact blockers (roles, users) with actionable cleanup paths
7. **Guided Workflow**: Optional step-by-step cleanup assistant for complex hierarchies
8. **Export Option**: Allow data export before deletion (compliance requirement)

**Detailed UX Specifications**: See [Organizational Deletion UX Guide](./organizational-deletion-ux.md)

#### Implementation Status

- ✅ Event processing: `organization.deleted` cascade implemented
- ✅ Projection tables: Support logical deletion
- ⏸️ Permission scope change: `scope_type: 'global'` → `'org'` (Phase B)
- ⏸️ Command handler: Emptiness validation (Phase B)
- ⏸️ Frontend UX: Zero-regret deletion flows (Phase B)

**Related Documentation**:
- Event processor: `/infrastructure/supabase/sql/03-functions/event-processing/002-process-organization-events.sql:168-237`
- UX specification: `.plans/rbac-permissions/organizational-deletion-ux.md`
- Implementation guide: `.plans/rbac-permissions/implementation-guide.md` (Phase 4.5)

### C. Event Naming Conventions

**Format**: `entity.action`

**Examples**:
- `permission.defined`
- `role.created`
- `role.permission.granted`
- `user.role.assigned`
- `access_grant.created`

**Tense**: Past tense for state changes (created, granted, assigned)

### D. Frontend Integration

The React frontend integrates with this RBAC system through the auth provider interface:

#### Permission Checking

```typescript
import { useAuth } from '@/contexts/AuthContext';

const MyComponent = () => {
  const { hasPermission } = useAuth();

  // Check single permission
  const canCreate = await hasPermission('medication.create');

  // Permissions available in session
  const { session } = useAuth();
  const permissions = session?.claims.permissions || [];
};
```

#### Role-Based UI Rendering

```typescript
const AdminPanel = () => {
  const { session } = useAuth();
  const isAdmin = session?.claims.user_role === 'provider_admin';

  if (!isAdmin) {
    return <AccessDenied />;
  }

  return <AdminDashboard />;
};
```

**See**: [../authentication/frontend-auth-architecture.md](../authentication/frontend-auth-architecture.md) for complete frontend implementation

---

### E. Related Documentation

#### Authentication & Authorization
- **Frontend Auth Architecture**: [../authentication/frontend-auth-architecture.md](../authentication/frontend-auth-architecture.md) - Three-mode auth system ✅
- **Custom JWT Claims**: [../authentication/custom-claims-setup.md](../authentication/custom-claims-setup.md) - JWT claims configuration
- **RBAC Implementation Guide**: [./rbac-implementation-guide.md](./rbac-implementation-guide.md) - Detailed implementation steps
- **Impersonation Architecture**: [../authentication/impersonation-architecture.md](../authentication/impersonation-architecture.md) - Super admin impersonation (aspirational)

#### Multi-Tenancy & Data
- **Multi-Tenancy Architecture**: [../data/multi-tenancy-architecture.md](../data/multi-tenancy-architecture.md) - Organization-based isolation
- **Organization Management**: [../data/organization-management-architecture.md](../data/organization-management-architecture.md) - Hierarchical organization structure
- **Event Sourcing**: [../data/event-sourcing-overview.md](../data/event-sourcing-overview.md) - CQRS and domain events

#### Infrastructure & Database
- **RBAC Tables**: [../../infrastructure/reference/database/tables/](../../infrastructure/reference/database/tables/) - Database schema
  - [permissions_projection.md](../../infrastructure/reference/database/tables/permissions_projection.md) - Permission definitions
  - [roles_projection.md](../../infrastructure/reference/database/tables/roles_projection.md) - Role templates and assignments
  - [role_permissions_projection.md](../../infrastructure/reference/database/tables/role_permissions_projection.md) - Role-permission junction
  - [user_roles_projection.md](../../infrastructure/reference/database/tables/user_roles_projection.md) - User role assignments
- **Supabase RLS**: [../../infrastructure/guides/supabase/RLS-POLICY-DESIGN.md](../../infrastructure/guides/supabase/RLS-POLICY-DESIGN.md) - Row-level security patterns

#### Workflows & Operations
- **Organization Bootstrap**: [../workflows/organization-bootstrap-workflow-design.md](../workflows/organization-bootstrap-workflow-design.md) - Temporal workflow for org setup ✅
- **Temporal Overview**: [../workflows/temporal-overview.md](../workflows/temporal-overview.md) - Workflow orchestration architecture
- **Activities Reference**: [../../workflows/reference/activities-reference.md](../../workflows/reference/activities-reference.md) - Workflow activity catalog

#### Frontend Implementation
- **Frontend Event-Driven Guide**: [../../frontend/guides/EVENT-DRIVEN-GUIDE.md](../../frontend/guides/EVENT-DRIVEN-GUIDE.md) - Event-driven patterns in React

---

**Document Version**: 1.2
**Last Updated**: 2025-12-29
**Status**: Approved for Implementation (Frontend Complete, RBAC Cleanup Complete)
**Owner**: A4C Development Team
