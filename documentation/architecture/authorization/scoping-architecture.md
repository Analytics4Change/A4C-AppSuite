# RBAC Scoping Architecture

## Overview

The A4C platform uses three complementary scoping mechanisms that work together to control authorization. Understanding how these interact is essential for implementing and debugging permission-related features.

## Three Scoping Mechanisms

### 1. `organization_id` (Data Layer)

**Location**: `roles_projection`, `user_roles_projection`

**Purpose**: Multi-tenant data isolation

**Values**:
- `NULL` = Global scope (platform-wide, e.g., `super_admin` role)
- `UUID` = Organization-scoped (belongs to specific organization)

**How it works**:
- Roles with `organization_id IS NULL` are platform-level roles
- Roles with `organization_id = <uuid>` belong to that specific organization
- Row-Level Security (RLS) policies use this column to enforce data isolation
- Users can only see/manage roles within their organization context

### 2. `scope_type` (Permission Metadata)

**Location**: `permissions_projection`

**Purpose**: Permission hierarchy classification

**Values**:
- `'global'` = Platform-level permissions (visible only to platform_owner)
- `'org'` = Organization-level permissions (visible to all org types)

**How it works**:
- Categorizes permissions into platform vs organization operations
- Used by `api.get_permissions()` to filter what permissions users can see
- Used by frontend `PermissionSelector` to group permissions in UI

**Global Permissions (10 total)**:
| Permission | Description |
|------------|-------------|
| `organization.activate` | Activate/reactivate organization |
| `organization.create` | Create organizations |
| `organization.create_root` | Create root tenant organizations |
| `organization.deactivate` | Deactivate organization |
| `organization.delete` | Delete organizations |
| `organization.search` | Search across all organizations |
| `organization.suspend` | Suspend organization access |
| `permission.grant` | Grant permissions to roles (catalog) |
| `permission.revoke` | Revoke permissions from roles (catalog) |
| `permission.view` | View permission catalog |

**Org Permissions (32 total)**:
- `a4c_role.*` (5) - A4C internal role management
- `client.*` (4) - Client management
- `medication.*` (4) - Medication management
- `organization.*` org-scoped (7) - Business profile, org units, updates
- `role.*` (6) - Role CRUD and assignment
- `user.*` (6) - User management

### 3. `org_type` (JWT Runtime Filter)

**Location**: JWT custom claims (via `auth.custom_access_token_hook`)

**Purpose**: Runtime filtering based on organization classification

**Values**:
- `'platform_owner'` = A4C organization, sees all permissions
- `'provider'` = Provider organization, hides global permissions
- `'provider_partner'` = Partner organization, hides global permissions

**How it works**:
- Extracted from JWT at API call time
- `api.get_permissions()` checks `org_type` and filters results:
  - If `org_type = 'platform_owner'`: Return all permissions
  - Otherwise: Return only `scope_type != 'global'` permissions

## How They Interact

```
User Request → JWT contains org_type
                    ↓
            API Function reads org_type
                    ↓
    ┌───────────────┴───────────────┐
    │ org_type = 'platform_owner'   │ org_type = 'provider'/'provider_partner'
    │ See ALL permissions           │ See only scope_type = 'org'
    │ See ALL roles                 │ See only organization_id = my_org_id
    └───────────────────────────────┘
```

### Example: Creating a Role

1. User opens Role Management UI (`/roles/manage`)
2. Frontend calls `api.get_permissions()` to populate permission selector
3. API checks JWT `org_type`:
   - Platform owner sees 42 permissions (10 global + 32 org)
   - Provider sees 32 permissions (org-scoped only)
4. User creates role with selected permissions
5. `api.create_role()` emits `role.created` event with `organization_id`
6. Role is stored with user's `organization_id` (from JWT `org_id` claim)

## Common Scenarios

### Scenario 1: Super Admin Managing Platform

- User: `lars.tice@gmail.com` (super_admin)
- `org_type`: `platform_owner`
- Sees: All 42 permissions, all global roles
- Can: Create organizations, manage platform settings

### Scenario 2: Provider Admin Managing Their Org

- User: `troy@liveforlifeutah.com` (provider_admin)
- `org_type`: `provider`
- Sees: 32 org-scoped permissions
- Can: Create roles, manage users within their organization
- Cannot: See global permissions, manage other organizations

### Scenario 3: Role Assignment

When assigning a role to a user:
1. User must have `role.assign` permission
2. Role must belong to same organization (or be global)
3. User can only grant permissions they possess (subset-only delegation)

## Implementation Details

### Database Functions

**`api.get_permissions()`**: Returns permissions filtered by `org_type`
```sql
-- Platform owner sees all
WHEN org_type = 'platform_owner' THEN
  SELECT * FROM permissions_projection

-- Others see only org-scoped
ELSE
  SELECT * FROM permissions_projection
  WHERE scope_type != 'global'
```

**`api.create_role()`**: Creates role with organization context
```sql
-- Role inherits org_id from JWT claims
v_org_id := public.get_current_org_id();

-- Role stored with organization_id
INSERT INTO roles_projection (organization_id, ...)
VALUES (v_org_id, ...);
```

### Frontend Components

**`PermissionSelector.tsx`**: Groups permissions by scope_type
```typescript
function groupPermissionsByScopeAndApplet(permissions: Permission[]) {
  const globalPerms = permissions.filter(p => p.scopeType === 'global');
  const orgPerms = permissions.filter(p => p.scopeType !== 'global');
  // ... group by applet
}
```

## Troubleshooting

### "Permission not visible in UI"

1. Check `scope_type` in `permissions_projection`
2. Check user's `org_type` in JWT claims
3. If `org_type != 'platform_owner'` and `scope_type = 'global'`, permission is hidden

### "Role not visible to user"

1. Check `organization_id` on the role
2. Check user's `org_id` in JWT claims
3. If role `organization_id != user org_id` and role is not global, it's hidden

### "Cannot assign permission"

1. Check if user has `role.grant` permission
2. Check subset-only delegation: user must possess the permission
3. Check permission `scope_type` matches user's visibility

## Related Documentation

- [RBAC Architecture](./rbac-architecture.md) - Overall RBAC system design
- [Multi-Tenancy Architecture](../data/multi-tenancy-architecture.md) - Organization isolation
- [JWT Custom Claims Setup](../../infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md) - How claims are generated
