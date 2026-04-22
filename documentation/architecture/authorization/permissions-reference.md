---
status: current
last_updated: 2026-04-22
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Canonical reference for all 31 platform permissions (10 global + 21 org-scoped) with resource.action naming convention and scope assignments.

**When to read**:
- Looking up specific permission names
- Understanding global vs org-scoped permissions
- Assigning permissions to roles
- Adding new permissions to the system

**Prerequisites**: [rbac-architecture.md](rbac-architecture.md) for permission model

**Key topics**: `permissions`, `rbac`, `scope`, `global`, `org-scoped`, `resource-action`

**Estimated read time**: 10 minutes
<!-- TL;DR-END -->

# Permissions Reference

## Overview

This document defines the canonical permissions used in the A4C-AppSuite platform. All permissions follow the `resource.action` naming convention and are organized by scope type.

**Last Updated**: 2025-12-29
**Total Permissions**: 31 (10 global + 21 org-scoped)

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

## Global Permissions (10)

These permissions are assigned only to `super_admin` and apply platform-wide. Platform-level operations for managing the organization catalog.

| Permission | Description | Notes |
|------------|-------------|-------|
| `organization.activate` | Activate a suspended organization | Returns org to active state |
| `organization.create` | Create organizations (general) | Platform admin operation |
| `organization.create_root` | Create top-level provider organizations | Root org creation |
| `organization.deactivate` | Soft-delete organizations | Requires MFA |
| `organization.delete` | Permanently delete organizations | Requires MFA, cascades |
| `organization.search` | Search across all organizations | Platform-wide search |
| `organization.suspend` | Temporarily suspend an organization | Reversible via activate |
| `permission.grant` | Grant permissions to roles | Platform permission management |
| `permission.revoke` | Revoke permissions from roles | Platform permission management |
| `permission.view` | View platform permission catalog | View all defined permissions |

## Organization-Scoped Permissions (21)

These permissions are assigned to organization-level roles and apply within the organization context.

### Organization Management (4)

| Permission | Description | provider_admin |
|------------|-------------|----------------|
| `organization.view` | View organization details | Yes |
| `organization.update` | Update organization settings and profile | Yes |
| `organization.view_ou` | View organizational units (departments, locations) | Yes |
| `organization.create_ou` | Create organizational units within hierarchy | Yes |

### Client Management (4)

| Permission | Description | provider_admin |
|------------|-------------|----------------|
| `client.create` | Create new clients in the organization | Yes |
| `client.view` | View client records | Yes |
| `client.update` | Update client information | Yes |
| `client.delete` | Delete client records | Yes |

### Medication Management (5)

| Permission | Description | provider_admin |
|------------|-------------|----------------|
| `medication.create` | Create medication records | Yes |
| `medication.view` | View medication records | Yes |
| `medication.update` | Update medication records | Yes |
| `medication.delete` | Delete medication records | Yes |
| `medication.administer` | Administer medications to clients | Yes |

### Role Management (4)

| Permission | Description | provider_admin |
|------------|-------------|----------------|
| `role.create` | Create custom roles within organization | Yes |
| `role.view` | View roles and their permissions | Yes |
| `role.update` | Update role definitions | Yes |
| `role.delete` | Delete roles | Yes |

### User Management (6)

| Permission | Description | provider_admin |
|------------|-------------|----------------|
| `user.create` | Create/invite users to organization | Yes |
| `user.view` | View user profiles and assignments | Yes |
| `user.update` | Update user profiles | Yes |
| `user.delete` | Remove users from organization | Yes |
| `user.role_assign` | Assign roles to users | Yes |
| `user.role_revoke` | Revoke roles from users | Yes |

## Canonical Role Permissions

### super_admin

Global platform administrator with all permissions. Can manage the platform organization catalog.

**Permissions**: All 31 permissions (10 global + 21 org-scoped)

### provider_admin (23 permissions)

Organization owner with full control within their organization. All 21 org-scoped permissions plus 2 permission management permissions.

```typescript
const PROVIDER_ADMIN_PERMISSIONS = [
  // Organization (4)
  'organization.view',
  'organization.update',
  'organization.view_ou',
  'organization.create_ou',

  // Client (4)
  'client.create',
  'client.view',
  'client.update',
  'client.delete',

  // Medication (5)
  'medication.create',
  'medication.view',
  'medication.update',
  'medication.delete',
  'medication.administer',

  // Role (4)
  'role.create',
  'role.view',
  'role.update',
  'role.delete',

  // User (6)
  'user.create',
  'user.view',
  'user.update',
  'user.delete',
  'user.role_assign',
  'user.role_revoke',
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

## Adding a New Permission (End-to-End)

The `/roles` management UI is **data-driven**: once a new permission exists in `permissions_projection`, it automatically appears as a selectable checkbox in the role form — no frontend enum, union type, or component edit is required. Use this checklist when introducing a new permission.

### Required

1. **Seed the permission** — add a row (emitting `permission.defined`) to `infrastructure/supabase/sql/99-seeds/001-permissions-seed.sql`. The projection is updated automatically by the event router.
2. **Grant it to a role template** — if the permission should be pre-granted to seeded roles such as `provider_admin`, add a row to the `role_permission_templates` seed (see [Permission Templates](#permission-templates) below).
3. **Apply migration / reseed** — follow [DEPLOYMENT_INSTRUCTIONS.md](../../infrastructure/guides/supabase/DEPLOYMENT_INSTRUCTIONS.md).

After steps 1–3 the new permission is live in the `/roles` UI.

### Conditional

4. **Mock mode** — if you develop against `npm run dev:mock` or have tests that use the mock role service, mirror the permission in `MOCK_PERMISSIONS` at `frontend/src/services/roles/MockRoleService.ts:83-116`.
5. **New applet prefix** — if the permission introduces a brand-new applet (e.g., `billing.*` when no `billing.*` permissions exist yet), add a one-line entry to `APPLET_DISPLAY_NAMES` at `frontend/src/components/roles/PermissionSelector.tsx:88-97` for a friendly group header. Unknown applets still render, with an auto-generated label like `"Billing Management"`.
6. **JWT/Edge Function reference** — if the permission is consumed by Edge Functions that import from `frontend/src/config/permissions.config.ts`, add it there too (see note under [Frontend Permission Configuration](#frontend-permission-configuration)).
7. **Frontend permission gate** — if other UI needs to conditionally render on this permission, use `useAuth().hasPermission('applet.action')`. No enum or union type needs updating.

**See also**: [Role Management Frontend Reference](../../frontend/reference/role-management.md) for the UI data flow, [permissions_projection](../../infrastructure/reference/database/tables/permissions_projection.md#1-define-new-permission-via-event) for the event emission example.

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
| `provider_admin` | 23 |
| `partner_admin` | 4 |
| `clinician` | 4 |
| `viewer` | 3 |

## Frontend Permission Configuration

The `/roles` management UI loads the permission list **dynamically** at runtime via `api.get_permissions()`; it does NOT read any hardcoded list from frontend source. See [Role Management Frontend Reference](../../frontend/reference/role-management.md) for the full data flow.

Two frontend files reference permissions statically and have narrow, specific purposes:

- **`frontend/src/config/permissions.config.ts`** — reference constants consumed by Edge Functions and JWT validation logic. This file must stay aligned with `permissions_projection`, but editing it alone will NOT surface a new permission in the `/roles` UI. Only edit when a new permission is also consumed by Edge Functions.
- **`frontend/src/services/roles/MockRoleService.ts`** — hardcoded `MOCK_PERMISSIONS` array used by `npm run dev:mock` and unit tests. Mirror new permissions here for mock-mode development.

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
| 2025-12-29 | Updated to 31 permissions (10 global, 21 org). Removed deleted permissions (a4c_role.*, role.assign, etc.). Updated provider_admin to 23 permissions. | Claude |
| 2025-12-20 | Added Permission Templates section with role scoping architecture | Claude |
| 2025-12-20 | Added `role_permission_templates` table for database-driven templates | Claude |
| 2024-12-19 | Added `organization.view_ou` and `organization.create_ou` | Claude |
| 2024-12-19 | Created canonical 16-permission set for provider_admin | Claude |
| 2024-12-19 | Aligned frontend permissions to database naming | Claude |
