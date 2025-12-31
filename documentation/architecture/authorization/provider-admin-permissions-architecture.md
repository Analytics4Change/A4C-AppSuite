---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Architecture for granting provider_admin permissions during org bootstrap, including database-driven templates, event-driven grants, and role scoping with LTREE hierarchy.

**When to read**:
- Understanding how provider_admin gets permissions
- Debugging permission grants during bootstrap
- Modifying role permission templates
- Adding new permissions to provider_admin

**Prerequisites**: [rbac-architecture.md](rbac-architecture.md), [permissions-reference.md](permissions-reference.md)

**Key topics**: `provider-admin`, `permissions`, `bootstrap`, `templates`, `role-scoping`, `ltree`

**Estimated read time**: 12 minutes
<!-- TL;DR-END -->

# Provider Admin Permissions Architecture

## Implementation Status

| Phase | Status | Date |
|-------|--------|------|
| Phase 1: Parallel Operation | Complete | 2024-12-08 |
| Phase 2: Event-Driven Grants | Complete | 2024-12-19 |
| Phase 3: Database-Driven Templates | **Complete** | 2025-12-20 |
| Phase 4: Cutover | Pending | - |

### What's Implemented (2025-12-20)

- **Database-driven permission templates**: New `role_permission_templates` table stores canonical permissions per role type
- **Activity queries templates at runtime**: `grantProviderAdminPermissions` activity now queries templates from database
- **Role scoping fixed**: Non-super_admin roles now require `organization_id` and `org_hierarchy_scope`
- **scopePath parameter added**: Workflow passes subdomain as scopePath for proper LTREE hierarchy

### What's Implemented (2024-12-19)

- **`grantProviderAdminPermissions` activity**: Created at `workflows/src/activities/organization-bootstrap/grant-provider-admin-permissions.ts`
- **Bootstrap workflow updated**: Now grants canonical permissions after organization creation (Step 1.5)
- **Canonical permissions defined**: See [permissions-reference.md](./permissions-reference.md) for the 23 provider_admin permissions
- **Backfill SQL scripts**: Created for existing provider_admin roles

### What's Remaining

- [ ] Remove implicit grant from `user_has_permission()` SQL function (Phase 4)
- [ ] Admin UI for managing permission templates (future enhancement)

## Overview

This document describes the architecture for granting permissions to `provider_admin` users during organization bootstrap. It covers the current short-term implementation and the planned long-term solution.

## Problem Statement

When a new organization is bootstrapped via Temporal workflow:
1. The organization record is created
2. A `provider_admin` user is invited
3. The user needs full control over their organization

The challenge: How should `provider_admin` permissions be granted?

### Design Principles

1. **Least Privilege**: Users should only have permissions they need
2. **Audit Trail**: Permission grants should be recorded as domain events
3. **Flexibility**: Different organizations may need different permission sets
4. **Forward Compatibility**: System should handle permissions that don't exist yet

## Current State (Short-Term Implementation)

### Approach: Mode-Specific Permission Resolution

The current implementation uses different permission resolution strategies based on deployment mode:

| Mode | Permission Source | Implementation |
|------|-------------------|----------------|
| **Mock** | `getDevProfilePermissions()` in `dev-auth.config.ts` | Implicit org grants for `provider_admin` |
| **Production** | JWT claims from database + RLS `user_has_permission()` | Implicit grant in SQL function (short-term) |

This separation ensures mock mode works without any backend infrastructure while production uses the database as the source of truth.

#### 1. Frontend Mock Mode: `dev-auth.config.ts`

The `DevAuthProvider` uses `getDevProfilePermissions()` to populate session claims:

```typescript
// frontend/src/config/dev-auth.config.ts
/**
 * Get permissions for a dev profile, including implicit org grants for provider_admin
 *
 * This is MOCK MODE ONLY - production gets permissions from JWT claims populated
 * by the Temporal workflow during organization bootstrap.
 */
export function getDevProfilePermissions(role: UserRole): Permission[] {
  const basePermissions = getRolePermissions(role);

  // In mock mode, provider_admin gets all organization-scoped permissions
  // This simulates the implicit grant that would come from Temporal workflow in production
  if (role === 'provider_admin') {
    const orgPermissions = Object.values(PERMISSIONS)
      .filter(p => p.scope === 'organization')
      .map(p => p.id);
    return [...new Set([...basePermissions, ...orgPermissions])];
  }

  return basePermissions;
}
```

**Key Points:**
- `getRolePermissions()` in `roles.config.ts` returns only explicitly defined permissions
- `getDevProfilePermissions()` adds implicit org permissions for `provider_admin` in mock mode only
- Mock session claims are populated via `createMockSession()` → `createMockJWTClaims()`
- `DevAuthProvider.hasPermission()` checks against these pre-populated claims

#### 2. Backend Production Mode: `user_has_permission()` SQL Function

```sql
-- infrastructure/supabase/sql/03-functions/authorization/001-user_has_permission.sql
CREATE OR REPLACE FUNCTION user_has_permission(
  p_user_id UUID,
  p_permission_name TEXT,
  p_org_id UUID,
  p_scope_path LTREE DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
  -- Check 1: provider_admin implicit grant (SHORT-TERM)
  -- This will be removed when Temporal workflow grants permissions explicitly
  IF EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND r.name = 'provider_admin'
      AND ur.org_id = p_org_id
      AND r.deleted_at IS NULL
  ) THEN
    -- Allow if permission is not global-only
    IF NOT EXISTS (
      SELECT 1 FROM permissions_projection p
      WHERE p.name = p_permission_name
        AND p.scope_type = 'global'
    ) THEN
      RETURN TRUE;
    END IF;
  END IF;

  -- Check 2: Explicit permission grant via role_permissions_projection
  RETURN EXISTS (...);
END;
$$;
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Permission Resolution                            │
├──────────────────────────────┬──────────────────────────────────────────┤
│         MOCK MODE            │           PRODUCTION MODE                │
├──────────────────────────────┼──────────────────────────────────────────┤
│  DevAuthProvider             │  SupabaseAuthProvider                    │
│       │                      │       │                                  │
│       ▼                      │       ▼                                  │
│  getDevProfilePermissions()  │  JWT from Supabase Auth                  │
│       │                      │       │                                  │
│       ▼                      │       ▼                                  │
│  [Adds implicit org perms    │  [Claims populated by database hook]    │
│   for provider_admin]        │       │                                  │
│       │                      │       ▼                                  │
│       ▼                      │  user_has_permission() SQL function     │
│  session.claims.permissions  │  [Checks projections + implicit grant]  │
│       │                      │       │                                  │
│       ▼                      │       ▼                                  │
│  hasPermission() check       │  RLS policy enforcement                  │
└──────────────────────────────┴──────────────────────────────────────────┘
```

### Limitations of Current Approach

| Limitation | Impact | Applies To |
|------------|--------|------------|
| No audit trail | Cannot see when/why permissions were granted | Production |
| No flexibility | All provider_admins get identical permissions | Both |
| Implicit magic | Permissions come from code, not data | Both |
| SQL implicit grant | Backend has temporary implicit grant logic | Production |

### What Stays vs. What Changes

When the long-term solution is implemented:

| Component | Current | Long-Term |
|-----------|---------|-----------|
| `getDevProfilePermissions()` | Implicit grants for mock | **STAYS** - Mock mode always needs this |
| `user_has_permission()` | Implicit grant check | **REMOVED** - Replaced by explicit grants |
| `role_permissions_projection` | Not populated for provider_admin | **POPULATED** - Via Temporal workflow |

## Long-Term Solution: Event-Driven Permission Grants

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Organization Bootstrap Workflow                       │
├─────────────────────────────────────────────────────────────────────────┤
│  Step 1: Create Organization                                            │
│  Step 2: Configure DNS (if subdomain)                                   │
│  Step 3: Generate Invitations                                           │
│  Step 4: Grant Provider Admin Permissions  ← NEW STEP                   │
│  Step 5: Send Invitation Emails                                         │
│  Step 6: Activate Organization                                          │
└─────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              grantProviderAdminPermissions Activity                     │
├─────────────────────────────────────────────────────────────────────────┤
│  For each organization-scoped permission:                               │
│    - Emit role.permission_granted event                                 │
│    - Event contains: role_id, permission_id, org_id, granted_by        │
│    - PostgreSQL trigger updates role_permissions_projection            │
└─────────────────────────────────────────────────────────────────────────┘
```

### New Domain Events

#### `role.permission_granted`

```yaml
# AsyncAPI Schema
role.permission_granted:
  payload:
    type: object
    properties:
      event_id:
        type: string
        format: uuid
      event_type:
        const: role.permission_granted
      aggregate_id:
        type: string
        format: uuid
        description: Role ID
      org_id:
        type: string
        format: uuid
      data:
        type: object
        properties:
          role_id:
            type: string
            format: uuid
          permission_id:
            type: string
            format: uuid
          permission_name:
            type: string
          granted_by:
            type: string
            format: uuid
            description: User ID or 'system' for workflow grants
          reason:
            type: string
            description: Why permission was granted (e.g., 'organization_bootstrap')
```

#### `role.permission_revoked`

```yaml
role.permission_revoked:
  payload:
    type: object
    properties:
      event_id:
        type: string
        format: uuid
      event_type:
        const: role.permission_revoked
      aggregate_id:
        type: string
        format: uuid
      org_id:
        type: string
        format: uuid
      data:
        type: object
        properties:
          role_id:
            type: string
            format: uuid
          permission_id:
            type: string
            format: uuid
          revoked_by:
            type: string
            format: uuid
          reason:
            type: string
```

### New Temporal Activity

#### `grantProviderAdminPermissions`

**Location**: `workflows/src/activities/organization-bootstrap/grant-permissions.ts`

```typescript
// Proposed implementation
interface GrantPermissionsParams {
  orgId: string;
  roleId: string;  // The provider_admin role ID for this org
  permissions: string[];  // Permission names to grant
}

interface GrantPermissionsResult {
  granted: string[];
  alreadyGranted: string[];
  failed: { permission: string; error: string }[];
}

export async function grantProviderAdminPermissions(
  params: GrantPermissionsParams
): Promise<GrantPermissionsResult> {
  const result: GrantPermissionsResult = {
    granted: [],
    alreadyGranted: [],
    failed: []
  };

  for (const permissionName of params.permissions) {
    try {
      // Check if already granted (idempotency)
      const existing = await supabase
        .from('role_permissions_projection')
        .select('id')
        .eq('role_id', params.roleId)
        .eq('permission_name', permissionName)
        .single();

      if (existing.data) {
        result.alreadyGranted.push(permissionName);
        continue;
      }

      // Emit domain event
      await supabase.from('domain_events').insert({
        event_id: crypto.randomUUID(),
        event_type: 'role.permission_granted',
        aggregate_type: 'role',
        aggregate_id: params.roleId,
        org_id: params.orgId,
        data: {
          role_id: params.roleId,
          permission_name: permissionName,
          granted_by: 'system',
          reason: 'organization_bootstrap'
        },
        metadata: {
          workflow: 'organization_bootstrap',
          timestamp: new Date().toISOString()
        }
      });

      result.granted.push(permissionName);
    } catch (error) {
      result.failed.push({
        permission: permissionName,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  return result;
}
```

### Event Processor

**Location**: `infrastructure/supabase/sql/03-functions/event-processing/012-process-permission-events.sql`

```sql
-- Process role.permission_granted events
CREATE OR REPLACE FUNCTION process_role_permission_granted(event_data JSONB, event_org_id UUID)
RETURNS VOID AS $$
DECLARE
  v_role_id UUID := (event_data->>'role_id')::UUID;
  v_permission_name TEXT := event_data->>'permission_name';
  v_permission_id UUID;
BEGIN
  -- Look up permission ID
  SELECT id INTO v_permission_id
  FROM permissions_projection
  WHERE name = v_permission_name;

  IF v_permission_id IS NULL THEN
    RAISE WARNING 'Permission % not found', v_permission_name;
    RETURN;
  END IF;

  -- Insert into role_permissions_projection (idempotent)
  INSERT INTO role_permissions_projection (role_id, permission_id, org_id)
  VALUES (v_role_id, v_permission_id, event_org_id)
  ON CONFLICT (role_id, permission_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;
```

### Database Schema Changes

#### New Table: `permission_grants_audit`

```sql
-- Track all permission grants for audit purposes
CREATE TABLE IF NOT EXISTS permission_grants_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES roles_projection(id),
  permission_id UUID NOT NULL REFERENCES permissions_projection(id),
  org_id UUID NOT NULL REFERENCES organizations_projection(id),
  action TEXT NOT NULL CHECK (action IN ('granted', 'revoked')),
  actor_id UUID,  -- NULL for system actions
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'workflow')),
  reason TEXT,
  event_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_permission_grants_audit_role ON permission_grants_audit(role_id);
CREATE INDEX idx_permission_grants_audit_org ON permission_grants_audit(org_id);
CREATE INDEX idx_permission_grants_audit_created ON permission_grants_audit(created_at);
```

### Workflow Changes

#### Updated Bootstrap Workflow

```typescript
// workflows/src/workflows/organization-bootstrap/workflow.ts
export async function organizationBootstrapWorkflow(
  params: OrganizationBootstrapParams
): Promise<OrganizationBootstrapResult> {
  // ... existing steps 1-3 ...

  // ========================================
  // Step 4: Grant Provider Admin Permissions (NEW)
  // ========================================
  log.info('Step 4: Granting provider admin permissions', { orgId: state.orgId });

  // Get all organization-scoped permissions
  const orgPermissions = await getOrganizationScopedPermissions();

  const permissionResult = await grantProviderAdminPermissions({
    orgId: state.orgId!,
    roleId: state.providerAdminRoleId!,
    permissions: orgPermissions
  });

  log.info('Permissions granted', {
    granted: permissionResult.granted.length,
    alreadyGranted: permissionResult.alreadyGranted.length,
    failed: permissionResult.failed.length
  });

  // Record non-fatal failures
  for (const failure of permissionResult.failed) {
    state.errors.push(`Failed to grant ${failure.permission}: ${failure.error}`);
  }

  // ... existing steps 5-6 ...
}
```

### Migration Plan

#### Phase 1: Parallel Operation (Current)

- Short-term implicit grants remain in place
- Mock mode uses `getDevProfilePermissions()` (permanent)
- Production uses `user_has_permission()` implicit grant (temporary)
- No breaking changes

#### Phase 2: Implement Event-Driven Grants

1. Add `role.permission_granted` event schema to AsyncAPI
2. Implement `grantProviderAdminPermissions` activity
3. Add event processor function
4. Update bootstrap workflow to call new activity
5. Deploy to staging for testing

#### Phase 3: Cutover (Production Only)

1. Run migration to emit events for existing provider_admin permissions
2. Verify all projections match expected state
3. Remove implicit grant logic from `user_has_permission()` SQL function
4. **DO NOT remove** `getDevProfilePermissions()` - mock mode needs this permanently
5. Monitor for regressions

#### Phase 4: Cleanup

1. Archive old implicit grant SQL code
2. Update documentation to mark migration complete
3. Add integration tests for permission events

**Important**: The frontend `getDevProfilePermissions()` function in `dev-auth.config.ts` is a **permanent fixture** for mock mode development. It will never be removed because mock mode has no backend infrastructure to query.

### Compensation (Saga Pattern)

When bootstrap fails after permissions are granted:

```typescript
// Compensation activity
export async function revokeProviderAdminPermissions(
  params: { orgId: string; roleId: string }
): Promise<void> {
  // Emit role.permissions_revoked event for all org permissions
  await supabase.from('domain_events').insert({
    event_id: crypto.randomUUID(),
    event_type: 'role.permissions_revoked',
    aggregate_type: 'role',
    aggregate_id: params.roleId,
    org_id: params.orgId,
    data: {
      role_id: params.roleId,
      reason: 'organization_bootstrap_compensation',
      scope: 'all_organization_permissions'
    }
  });
}
```

### Affected Subsystems

| Subsystem | Changes Required |
|-----------|------------------|
| **Temporal Workflows** | New activity, updated workflow steps |
| **Supabase SQL** | New event processor, audit table, updated projections |
| **AsyncAPI Contracts** | New event schemas |
| **Frontend (Production)** | No changes - permissions come from JWT claims |
| **Frontend (Mock)** | No changes - `getDevProfilePermissions()` stays permanently |
| **RLS Policies** | Remove implicit grant check from `user_has_permission()` |
| **Testing** | New integration tests for permission events |

### Security Considerations

1. **Audit Trail**: All permission changes recorded in `permission_grants_audit`
2. **Idempotency**: Events use unique `event_id` for deduplication
3. **Scope Enforcement**: Permissions only granted within organization scope
4. **Compensation**: Failed bootstraps properly revoke granted permissions

### Testing Strategy

#### Unit Tests

```typescript
describe('grantProviderAdminPermissions', () => {
  it('should emit events for each permission', async () => {
    // Test event emission
  });

  it('should be idempotent on retry', async () => {
    // Test duplicate handling
  });

  it('should handle partial failures', async () => {
    // Test error handling
  });
});
```

#### Integration Tests

```typescript
describe('Organization Bootstrap with Permissions', () => {
  it('should grant all org permissions to provider_admin', async () => {
    // Full workflow test
  });

  it('should revoke permissions on compensation', async () => {
    // Test saga rollback
  });
});
```

### Monitoring

#### Key Metrics

- `permission_grants_total`: Counter of granted permissions
- `permission_grants_failed`: Counter of failed grants
- `permission_grants_latency`: Histogram of grant duration
- `bootstrap_permission_step_duration`: Time spent in permission step

#### Alerts

- Permission grant failures > 5% of total
- Bootstrap workflow failures in permission step
- Audit table growth anomalies

## References

- [RBAC Architecture](./rbac-architecture.md)
- [Event Sourcing Overview](../data/event-sourcing-overview.md)
- [Temporal Workflows Overview](../workflows/temporal-overview.md)
- [Organization Bootstrap Workflow](../../workflows/guides/organization-bootstrap.md)

## Revision History

| Date | Author | Description |
|------|--------|-------------|
| 2025-12-08 | Claude Code | Initial document - short-term and long-term architecture |
| 2025-12-08 | Claude Code | Refactored to use auth provider pattern - mock mode uses `getDevProfilePermissions()` as permanent fixture |
