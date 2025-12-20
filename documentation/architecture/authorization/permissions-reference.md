# Permissions Reference

## Overview

This document defines the canonical permissions used in the A4C-AppSuite platform. All permissions follow the `resource.action` naming convention and are organized by scope type.

**Last Updated**: 2025-12-20
**Total Permissions**: 34 (7 global + 27 organization-scoped)

## Permission Naming Convention

```
<resource>.<action>
```

- **resource**: The entity being accessed (e.g., `organization`, `client`, `medication`)
- **action**: The operation being performed (e.g., `view`, `create`, `update`, `delete`)

## Scope Types

| Scope | Description | Example |
|-------|-------------|---------|
| `global` | Platform-wide permissions (super_admin only) | `organization.create`, `users.impersonate` |
| `org` | Organization-scoped permissions | `client.view`, `medication.create` |

## Global Permissions (7)

These permissions are assigned only to `super_admin` and apply platform-wide.

| Permission | Description | Notes |
|------------|-------------|-------|
| `organization.create` | Create top-level provider organizations | Also known as `create_root` |
| `organization.create_sub` | Create sub-organizations (VAR partners) | Hierarchical org creation |
| `organization.deactivate` | Soft-delete organizations | Requires MFA |
| `organization.delete` | Permanently delete organizations | Requires MFA, cascades |
| `global_roles.create` | Create global system roles | A4C internal roles |
| `cross_org.grant` | Grant permissions across organizations | For partner arrangements |
| `users.impersonate` | Impersonate users in any organization | Audited, time-limited |

## Organization-Scoped Permissions (27)

These permissions are assigned to organization-level roles and apply within the org_id context.

### Organization Management (6)

| Permission | Description | provider_admin |
|------------|-------------|----------------|
| `organization.view_ou` | View organizational units (departments, locations) | Yes |
| `organization.create_ou` | Create organizational units within hierarchy | Yes |
| `organization.view` | View organization details | Yes |
| `organization.update` | Update organization settings and profile | Yes |
| `organization.business_profile_create` | Create business profile (deprecated) | Consolidated into update |
| `organization.business_profile_update` | Update business profile (deprecated) | Consolidated into update |

### Client Management (5)

| Permission | Description | provider_admin |
|------------|-------------|----------------|
| `client.create` | Create new clients in the organization | Yes |
| `client.view` | View client records | Yes |
| `client.update` | Update client information | Yes |
| `client.delete` | Delete client records | Yes |
| `client.transfer` | Transfer clients between organizations | No |

### Medication Management (5)

| Permission | Description | provider_admin |
|------------|-------------|----------------|
| `medication.create` | Create medication records | Yes |
| `medication.view` | View medication records | Yes |
| `medication.update` | Update medication records | No |
| `medication.delete` | Delete medication records | No |
| `medication.create_template` | Create medication templates | No |

### Role Management (3)

| Permission | Description | provider_admin |
|------------|-------------|----------------|
| `role.create` | Create custom roles within organization | Yes |
| `role.assign` | Assign roles to users | Yes |
| `role.view` | View roles and their permissions | Yes |

### User Management (3)

| Permission | Description | provider_admin |
|------------|-------------|----------------|
| `user.create` | Create/invite users to organization | Yes |
| `user.view` | View user profiles and assignments | Yes |
| `user.update` | Update user profiles | Yes |

### A4C Role Management (5)

These permissions are for A4C internal operations.

| Permission | Description | super_admin |
|------------|-------------|-------------|
| `a4c_role.create` | Create A4C internal roles | Yes |
| `a4c_role.assign` | Assign A4C roles | Yes |
| `a4c_role.view` | View A4C role structure | Yes |
| `a4c_role.update` | Update A4C roles | Yes |
| `a4c_role.delete` | Delete A4C roles | Yes |

## Canonical Role Permissions

### super_admin

Global platform administrator with all permissions. Can impersonate users for support.

**Permissions**: All 34 permissions

### provider_admin (16 permissions)

Organization owner with full control within their organization.

```typescript
const PROVIDER_ADMIN_PERMISSIONS = [
  // Organization (4)
  'organization.view_ou',
  'organization.create_ou',
  'organization.view',
  'organization.update',

  // Client (4)
  'client.create',
  'client.view',
  'client.update',
  'client.delete',

  // Medication (2)
  'medication.create',
  'medication.view',

  // Role (3)
  'role.create',
  'role.assign',
  'role.view',

  // User (3)
  'user.create',
  'user.view',
  'user.update',
];
```

### partner_admin

Partner organization administrator (VAR, Family, Court).

**Note**: Currently inherits subset of provider_admin permissions via workflow.

## Permission Granting Process

### New Organizations (Bootstrap Workflow)

When a new organization is created via the OrganizationBootstrapWorkflow:

1. Organization is created with `org_type` (provider, provider_partner, platform_owner)
2. `provider_admin` role is created for the organization
3. All 16 canonical permissions are granted to the role via `role.permission.granted` events
4. Initial admin user is assigned the `provider_admin` role

**Activity**: `grantProviderAdminPermissions` in `workflows/src/activities/organization-bootstrap/`

### Existing Organizations (Backfill)

To grant permissions to existing provider_admin roles that were created before the workflow update:

```sql
-- Run sql/99-seeds/010-add-ou-permissions.sql (adds view_ou and create_ou)
-- Run sql/99-seeds/011-grant-provider-admin-permissions.sql (grants all 16 permissions)
```

## Permission Templates

Permission assignments for new organizations are managed via the `role_permission_templates` table. This provides a database-driven, platform-owner-configurable approach to permission management.

### Role Scoping Architecture

| Role Type | Scope | organization_id | org_hierarchy_scope |
|-----------|-------|-----------------|---------------------|
| `super_admin` | Global | NULL | NULL |
| `provider_admin` | Per-Organization | Required | Required |
| `partner_admin` | Per-Organization | Required | Required |
| `clinician` | Per-Organization | Required | Required |
| `viewer` | Per-Organization | Required | Required |

**Key Constraint**: Only `super_admin` is global. All other roles are created per-organization during the bootstrap workflow with proper `organization_id` and `org_hierarchy_scope` set.

### Viewing Templates

```sql
SELECT role_name, permission_name, is_active
FROM role_permission_templates
ORDER BY role_name, permission_name;
```

### Adding Permissions to a Role Type

```sql
INSERT INTO role_permission_templates (role_name, permission_name)
VALUES ('provider_admin', 'new.permission')
ON CONFLICT DO NOTHING;
```

### Removing Permissions from a Role Type

```sql
-- Soft delete (recommended) - affects future bootstraps only
UPDATE role_permission_templates
SET is_active = FALSE
WHERE role_name = 'provider_admin' AND permission_name = 'old.permission';

-- Hard delete (affects future bootstraps only)
DELETE FROM role_permission_templates
WHERE role_name = 'provider_admin' AND permission_name = 'old.permission';
```

### Current Template Counts

| Role | Permission Count |
|------|------------------|
| `provider_admin` | 16 |
| `partner_admin` | 4 |
| `clinician` | 4 |
| `viewer` | 3 |

## Frontend Permission Configuration

Frontend permissions are defined in `frontend/src/config/permissions.config.ts`:

```typescript
export const PERMISSIONS: Record<string, Permission> = {
  // Global Level (7)
  'organization.create': { scope: 'global', ... },
  // ...

  // Organization Level (21)
  'organization.view_ou': { scope: 'organization', ... },
  // ...
};
```

## Database Schema

### permissions_projection

Stores permission definitions derived from `permission.defined` events.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Permission ID |
| `name` | TEXT | Permission name (unique) |
| `description` | TEXT | Human-readable description |
| `scope_type` | TEXT | 'global' or 'org' |
| `applet` | TEXT | Resource category |
| `action` | TEXT | Action type |
| `requires_mfa` | BOOLEAN | Whether MFA is required |

### role_permissions_projection

Maps roles to their granted permissions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Assignment ID |
| `role_id` | UUID | Role ID |
| `permission_id` | UUID | Permission ID |
| `created_at` | TIMESTAMPTZ | When granted |

## Related Documentation

- [RBAC Architecture](./rbac-architecture.md) - Role-based access control design
- [Provider Admin Permissions Architecture](./provider-admin-permissions-architecture.md) - Design decisions
- [Multi-Tenancy Architecture](../data/multi-tenancy-architecture.md) - Organization isolation

## Change History

| Date | Change | Author |
|------|--------|--------|
| 2025-12-20 | Added Permission Templates section with role scoping architecture | Claude |
| 2025-12-20 | Added `role_permission_templates` table for database-driven templates | Claude |
| 2024-12-19 | Added `organization.view_ou` and `organization.create_ou` | Claude |
| 2024-12-19 | Created canonical 16-permission set for provider_admin | Claude |
| 2024-12-19 | Aligned frontend permissions to database naming | Claude |
