# RBAC/Permissions Implementation Guide

## Overview

This guide provides step-by-step instructions for implementing the permission-based RBAC system in the A4C AppSuite. All components are event-sourced and follow the CQRS architecture.

**Related Documents:**
- `.plans/rbac-permissions/architecture.md` - Complete architecture specification
- `/infrastructure/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md` - CQRS foundation
- `/frontend/docs/EVENT-DRIVEN-GUIDE.md` - Frontend patterns

---

## Phase 1: Database Setup

### Step 1: Apply Migration Scripts

Run SQL scripts in order to create projection tables, event processors, and authorization functions:

```bash
cd infrastructure/supabase

# 1. Create projection tables
psql -f sql/02-tables/rbac/001-permissions_projection.sql
psql -f sql/02-tables/rbac/002-roles_projection.sql
psql -f sql/02-tables/rbac/003-role_permissions_projection.sql
psql -f sql/02-tables/rbac/004-user_roles_projection.sql
psql -f sql/02-tables/rbac/005-cross_tenant_access_grants_projection.sql

# 2. Create event processor
psql -f sql/03-functions/event-processing/004-process-rbac-events.sql

# 3. Create authorization functions
psql -f sql/03-functions/authorization/001-user_has_permission.sql

# 4. Update event router (already includes RBAC stream types)
psql -f sql/03-functions/event-processing/001-main-event-router.sql

# 5. Seed initial permissions and roles
psql -f sql/99-seeds/003-rbac-initial-setup.sql
```

### Step 2: Verify Projections

After running seed data, verify projections were created correctly:

```sql
-- Check permissions were created
SELECT COUNT(*) FROM permissions_projection;
-- Expected: 30+ permissions (medication, provider, client, user, access_grant, audit)

-- Check roles were created
SELECT * FROM roles_projection;
-- Expected: super_admin, provider_admin

-- Verify super_admin has global scope
SELECT name, zitadel_org_id, org_hierarchy_scope
FROM roles_projection
WHERE name = 'super_admin';
-- Expected: NULL values for org scoping
```

### Step 3: Grant Permissions to Roles

Complete the role-permission grants (the seed script creates permissions and roles, now link them):

```sql
-- Grant all permissions to super_admin
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
SELECT
  '11111111-1111-1111-1111-111111111111'::UUID,  -- super_admin role ID
  'role'::TEXT,
  2 + row_number() OVER ()::INTEGER,
  'role.permission.granted'::TEXT,
  jsonb_build_object(
    'permission_id', id,
    'permission_name', name
  ),
  jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000000000',
    'reason', 'Initial RBAC setup: granting ' || name || ' permission to super_admin role'
  )
FROM permissions_projection
ORDER BY name;

-- Grant org-scoped permissions to provider_admin (excluding super admin-only permissions)
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
SELECT
  '22222222-2222-2222-2222-222222222222'::UUID,  -- provider_admin role ID
  'role'::TEXT,
  2 + row_number() OVER ()::INTEGER,
  'role.permission.granted'::TEXT,
  jsonb_build_object(
    'permission_id', id,
    'permission_name', name
  ),
  jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000000000',
    'reason', 'Initial RBAC setup: granting ' || name || ' permission to provider_admin role'
  )
FROM permissions_projection
WHERE name != 'provider.impersonate'  -- Exclude super admin-only permission
  AND scope_type IN ('org', 'facility', 'program', 'client')  -- Only org-scoped permissions
ORDER BY name;
```

### Step 4: Verify Role-Permission Grants

```sql
-- Check super_admin has all permissions
SELECT COUNT(*) FROM role_permissions_projection
WHERE role_id = '11111111-1111-1111-1111-111111111111';
-- Expected: 30+ (all permissions)

-- Check provider_admin has org-scoped permissions
SELECT p.name
FROM role_permissions_projection rp
JOIN permissions_projection p ON p.id = rp.permission_id
WHERE rp.role_id = '22222222-2222-2222-2222-222222222222'
ORDER BY p.name;
-- Expected: All except provider.impersonate and global-scoped permissions
```

---

## Phase 2: Assign Roles to Users

### Assign Super Admin Role

```sql
-- Replace USER_UUID with actual super admin user ID
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('<USER_UUID>', 'user', 1, 'user.role.assigned',
   jsonb_build_object(
     'role_id', '11111111-1111-1111-1111-111111111111',
     'role_name', 'super_admin',
     'org_id', '*',
     'scope_path', '*',
     'assigned_by', '00000000-0000-0000-0000-000000000000'
   ),
   jsonb_build_object(
     'user_id', '00000000-0000-0000-0000-000000000000',
     'reason', 'Granting platform-wide administrative access to A4C support engineer'
   )
  );
```

### Assign Provider Admin Role

```sql
-- Replace USER_UUID and ORG_ID with actual values
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('<USER_UUID>', 'user', 1, 'user.role.assigned',
   jsonb_build_object(
     'role_id', '22222222-2222-2222-2222-222222222222',
     'role_name', 'provider_admin',
     'org_id', '<ORG_ID>',  -- e.g., 'acme_healthcare_001'
     'scope_path', 'org_<ORG_ID>',  -- ltree path
     'assigned_by', '<SUPER_ADMIN_USER_UUID>'
   ),
   jsonb_build_object(
     'user_id', '<SUPER_ADMIN_USER_UUID>',
     'reason', 'Granting provider administrator access to manage Acme Healthcare organization'
   )
  );
```

### Verify User Role Assignment

```sql
-- Check user has role
SELECT
  u.email,
  r.name AS role_name,
  ur.org_id,
  ur.scope_path
FROM user_roles_projection ur
JOIN users u ON u.id = ur.user_id
JOIN roles_projection r ON r.id = ur.role_id
WHERE ur.user_id = '<USER_UUID>';
```

---

## Phase 3: Test Authorization Functions

### Test Permission Checks

```sql
-- Test super admin has impersonation permission
SELECT user_has_permission(
  '<SUPER_ADMIN_UUID>'::UUID,
  'provider.impersonate',
  'any_org_id',
  NULL
);
-- Expected: TRUE

-- Test provider admin does NOT have impersonation permission
SELECT user_has_permission(
  '<PROVIDER_ADMIN_UUID>'::UUID,
  'provider.impersonate',
  'their_org_id',
  NULL
);
-- Expected: FALSE

-- Test provider admin has medication.create permission in their org
SELECT user_has_permission(
  '<PROVIDER_ADMIN_UUID>'::UUID,
  'medication.create',
  'their_org_id',
  'org_their_org_id'::LTREE
);
-- Expected: TRUE
```

### Test Helper Functions

```sql
-- Check if user is super admin
SELECT is_super_admin('<USER_UUID>'::UUID);

-- Check if user is provider admin for specific org
SELECT is_provider_admin('<USER_UUID>'::UUID, 'acme_healthcare_001');

-- Get all permissions for user in org
SELECT * FROM user_permissions('<USER_UUID>'::UUID, 'acme_healthcare_001');

-- Get user's organizations
SELECT * FROM user_organizations('<USER_UUID>'::UUID);
```

---

## Phase 4: Frontend Integration

### Step 1: Generate TypeScript Types

```bash
cd infrastructure/supabase
./scripts/generate-contracts.sh
```

This generates:
- `contracts/generated/typescript/event-types.ts` - Event type definitions
- `contracts/generated/typescript/rbac-event-types.ts` - RBAC-specific types

### Step 2: Copy Types to Frontend

```bash
cd ../../frontend
cp ../infrastructure/supabase/contracts/generated/typescript/*.ts src/types/events/
```

### Step 3: Create Permission Service

```typescript
// src/services/auth/permission.service.ts
import { supabase } from '@/lib/supabase';

export class PermissionService {
  private userId: string;
  private orgId: string;

  constructor(userId: string, orgId: string) {
    this.userId = userId;
    this.orgId = orgId;
  }

  async hasPermission(
    permissionName: string,
    scopePath?: string
  ): Promise<boolean> {
    const { data, error } = await supabase.rpc('user_has_permission', {
      p_user_id: this.userId,
      p_permission_name: permissionName,
      p_org_id: this.orgId,
      p_scope_path: scopePath
    });

    if (error) {
      console.error('Permission check failed:', error);
      return false;
    }

    return data === true;
  }

  async getUserPermissions(): Promise<Permission[]> {
    const { data, error } = await supabase.rpc('user_permissions', {
      p_user_id: this.userId,
      p_org_id: this.orgId
    });

    if (error) throw error;
    return data;
  }

  async isSuperAdmin(): Promise<boolean> {
    const { data, error } = await supabase.rpc('is_super_admin', {
      p_user_id: this.userId
    });

    if (error) throw error;
    return data === true;
  }
}
```

### Step 4: Create React Hook

```typescript
// src/hooks/usePermissions.ts
import { useAuth } from '@/contexts/AuthContext';
import { PermissionService } from '@/services/auth/permission.service';
import { useMemo, useState, useEffect } from 'react';

export function usePermissions() {
  const { user, currentOrg } = useAuth();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const service = useMemo(() => {
    if (!user || !currentOrg) return null;
    return new PermissionService(user.id, currentOrg.id);
  }, [user, currentOrg]);

  useEffect(() => {
    if (!service) return;

    service.getUserPermissions().then(perms => {
      setPermissions(perms.map(p => p.permission_name));
      setLoading(false);
    });
  }, [service]);

  const hasPermission = (permissionName: string, scopePath?: string) => {
    if (!service) return false;
    return service.hasPermission(permissionName, scopePath);
  };

  return { hasPermission, permissions, loading };
}
```

### Step 5: Use in Components

```typescript
// src/components/MedicationForm.tsx
import { usePermissions } from '@/hooks/usePermissions';

export function MedicationForm() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('medication.create');

  if (!canCreate) {
    return <Alert>You do not have permission to create medications.</Alert>;
  }

  return <MedicationFormContent />;
}
```

---

## Phase 5: RLS Policy Updates

### Update Existing RLS Policies

Add permission checks to existing RLS policies:

```sql
-- Example: Update medications RLS policy
DROP POLICY IF EXISTS medications_select_policy ON medications;

CREATE POLICY medications_select_policy ON medications
FOR SELECT
USING (
  -- Same-tenant access with permission check
  (
    organization_id = current_setting('app.current_org')
    AND user_has_permission(
      current_setting('app.current_user')::UUID,
      'medication.view',
      organization_id,
      hierarchy_path
    )
  )
  OR
  -- Cross-tenant access via grant with permission check
  EXISTS (
    SELECT 1 FROM cross_tenant_access_grants_projection
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

---

## Phase 6: Testing & Validation

### Integration Test Checklist

- [ ] Super admin can access all organizations
- [ ] Provider admin can only access their organization
- [ ] Super admin can impersonate users
- [ ] Provider admin cannot impersonate users
- [ ] Permission checks work for all CRUD operations
- [ ] Cross-tenant grants work correctly
- [ ] Hierarchical scoping works (facility/program level)
- [ ] Revoked permissions are enforced immediately
- [ ] Expired access grants are denied

### Performance Testing

```sql
-- Test permission check performance
EXPLAIN ANALYZE
SELECT user_has_permission(
  '<USER_UUID>'::UUID,
  'medication.create',
  'acme_healthcare_001',
  'org_acme_healthcare_001.facility_456'::LTREE
);
-- Target: < 10ms
```

---

## Phase 7: Monitoring & Observability

### Key Metrics to Monitor

1. **Permission Check Latency**: Time for `user_has_permission()` calls
2. **Failed Authorization Attempts**: Audit log of denied access
3. **Role Assignment Events**: Track who grants what roles to whom
4. **Permission Grant Events**: Track changes to role permissions

### Audit Queries

```sql
-- All permission changes for a role
SELECT
  de.event_type,
  de.event_data->>'permission_name' as permission,
  de.event_metadata->>'reason' as reason,
  de.created_at,
  u.name as changed_by
FROM domain_events de
JOIN users u ON u.id = (de.event_metadata->>'user_id')::UUID
WHERE de.stream_id = '<ROLE_UUID>'
  AND de.stream_type = 'role'
  AND de.event_type IN ('role.permission.granted', 'role.permission.revoked')
ORDER BY de.created_at DESC;

-- All role assignments for a user
SELECT
  de.event_type,
  de.event_data->>'role_name' as role,
  de.event_data->>'org_id' as org,
  de.event_metadata->>'reason' as reason,
  de.created_at
FROM domain_events de
WHERE de.stream_id = '<USER_UUID>'
  AND de.stream_type = 'user'
  AND de.event_type IN ('user.role.assigned', 'user.role.revoked')
ORDER BY de.created_at DESC;
```

---

## Troubleshooting

### Issue: Permission check returns FALSE unexpectedly

**Diagnosis:**
```sql
-- Check if user has role
SELECT * FROM user_roles_projection WHERE user_id = '<USER_UUID>';

-- Check if role has permission
SELECT * FROM role_permissions_projection
WHERE role_id IN (SELECT role_id FROM user_roles_projection WHERE user_id = '<USER_UUID>');

-- Check permission exists
SELECT * FROM permissions_projection WHERE name = '<PERMISSION_NAME>';
```

### Issue: Events not processing

**Diagnosis:**
```sql
-- Check unprocessed events
SELECT * FROM domain_events
WHERE processed_at IS NULL
  AND stream_type IN ('permission', 'role', 'access_grant')
LIMIT 10;

-- Check for processing errors
SELECT * FROM domain_events
WHERE processing_error IS NOT NULL
  AND stream_type IN ('permission', 'role', 'access_grant')
ORDER BY created_at DESC
LIMIT 10;
```

### Issue: Slow permission checks

**Diagnosis:**
```sql
-- Check index usage
EXPLAIN ANALYZE
SELECT user_has_permission(...);

-- Rebuild indexes if needed
REINDEX TABLE user_roles_projection;
REINDEX TABLE role_permissions_projection;
```

---

## Rollout Plan

### Stage 1: Development Testing (Week 1)
- Deploy to local dev environment
- Test all permission scenarios
- Verify event processing
- Performance benchmarks

### Stage 2: Staging Validation (Week 2)
- Deploy to staging
- Load test with realistic data
- Security audit
- Documentation review

### Stage 3: Production Rollout (Week 3)
- Deploy to production (feature flagged)
- Enable for internal A4C users first
- Monitor for 48 hours
- Gradually enable for all users

---

## Appendix

### A. Quick Reference: SQL Functions

- `user_has_permission(user_id, permission, org_id, scope_path)` - Check permission
- `user_permissions(user_id, org_id)` - Get all permissions
- `is_super_admin(user_id)` - Check super admin status
- `is_provider_admin(user_id, org_id)` - Check provider admin status
- `user_organizations(user_id)` - Get user's orgs

### B. Event Type Reference

- `permission.defined` - New permission created
- `role.created` - New role created
- `role.permission.granted` - Permission added to role
- `role.permission.revoked` - Permission removed from role
- `user.role.assigned` - Role granted to user
- `user.role.revoked` - Role removed from user
- `access_grant.created` - Cross-tenant grant created
- `access_grant.revoked` - Cross-tenant grant revoked

### C. Common Permission Patterns

| Use Case | Permission | Scope |
|----------|------------|-------|
| Create medication | `medication.create` | org |
| View client records | `client.view` | org/facility |
| Impersonate user | `provider.impersonate` | global |
| Grant cross-tenant access | `access_grant.create` | org |
| Export audit logs | `audit.export` | org |

---

**Document Version**: 1.0
**Last Updated**: 2025-10-09
**Status**: Ready for Implementation
**Owner**: A4C Development Team
