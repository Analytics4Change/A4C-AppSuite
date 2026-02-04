---
status: current
last_updated: 2026-02-04
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Configuration table (NOT a CQRS projection) defining canonical permissions for each role type. Queried during organization bootstrap to grant permissions to new roles. Platform owners can modify. Default templates: provider_admin (29 perms), partner_admin (4), clinician (4), viewer (3).

**When to read**:
- Customizing default role permissions for new organizations
- Understanding bootstrap workflow permission granting
- Adding/removing permissions from role templates
- Debugging why a role has specific default permissions

**Prerequisites**: [permissions_projection](./permissions_projection.md), [roles_projection](./roles_projection.md)

**Key topics**: `role-templates`, `bootstrap`, `permission-defaults`, `configuration-table`, `provider-admin`

**Estimated read time**: 8 minutes
<!-- TL;DR-END -->

# role_permission_templates

## Overview

Configuration table that defines canonical permissions for each role type. Used during organization bootstrap to grant permissions to new roles. Unlike CQRS projection tables, this is a direct configuration table that platform owners can modify.

**Database**: `public.role_permission_templates`
**Type**: Configuration Table (not a CQRS projection)
**RLS**: Enabled (read: all, write: super_admin only)

## Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | Primary key |
| `role_name` | TEXT | NOT NULL | - | Role type name (e.g., 'provider_admin', 'clinician') |
| `permission_name` | TEXT | NOT NULL | - | Permission identifier (e.g., 'client.create') |
| `is_active` | BOOLEAN | NOT NULL | `TRUE` | Soft delete flag for templates |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | When template was created |
| `updated_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | When template was last modified |
| `created_by` | UUID | NULL | - | Platform owner who added this template |

## Constraints

| Constraint | Type | Definition |
|------------|------|------------|
| `role_permission_templates_pkey` | PRIMARY KEY | `id` |
| `role_permission_templates_unique` | UNIQUE | `(role_name, permission_name)` |

## Indexes

| Index | Columns | Type | Condition |
|-------|---------|------|-----------|
| `idx_role_permission_templates_role` | `role_name` | B-tree | `WHERE is_active = TRUE` |
| `idx_role_permission_templates_active` | `is_active` | B-tree | `WHERE is_active = TRUE` |

## Row-Level Security

| Policy | Operation | Definition |
|--------|-----------|------------|
| `role_permission_templates_read` | SELECT | `TRUE` (anyone can read) |
| `role_permission_templates_write` | ALL | super_admin only via `user_roles_projection` join |

## Usage

### Querying Templates

```sql
-- Get all active permissions for a role type
SELECT permission_name
FROM role_permission_templates
WHERE role_name = 'provider_admin'
  AND is_active = TRUE
ORDER BY permission_name;

-- Get template counts by role
SELECT role_name, COUNT(*) as permission_count
FROM role_permission_templates
WHERE is_active = TRUE
GROUP BY role_name
ORDER BY role_name;
```

### Managing Templates

```sql
-- Add a new permission to a role type (idempotent)
INSERT INTO role_permission_templates (role_name, permission_name)
VALUES ('provider_admin', 'new.permission')
ON CONFLICT (role_name, permission_name) DO NOTHING;

-- Soft-delete a permission (recommended)
UPDATE role_permission_templates
SET is_active = FALSE, updated_at = NOW()
WHERE role_name = 'provider_admin'
  AND permission_name = 'old.permission';

-- Re-activate a soft-deleted permission
UPDATE role_permission_templates
SET is_active = TRUE, updated_at = NOW()
WHERE role_name = 'provider_admin'
  AND permission_name = 'some.permission';
```

## Integration with Temporal Workflow

The `grantProviderAdminPermissions` activity queries this table during organization bootstrap:

```typescript
// workflows/src/activities/organization-bootstrap/grant-provider-admin-permissions.ts

async function getTemplatePermissions(roleName: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('role_permission_templates')
    .select('permission_name')
    .eq('role_name', roleName)
    .eq('is_active', true);

  // Falls back to hardcoded constant if no templates found
  if (!data || data.length === 0) {
    return [...PROVIDER_ADMIN_PERMISSIONS];
  }

  return data.map(row => row.permission_name);
}
```

## Default Templates

The table is seeded with templates for the following role types:

| Role | Permission Count | Description |
|------|------------------|-------------|
| `provider_admin` | 29 | Organization owner with full control |
| `partner_admin` | 4 | Read-only access for partner organizations |
| `clinician` | 4 | Core clinical permissions |
| `viewer` | 3 | Read-only access |

### provider_admin (29 permissions)

- **Organization (8)**: `view`, `update`, `view_ou`, `create_ou`, `update_ou`, `delete_ou`, `deactivate_ou`, `reactivate_ou`
- **Client (4)**: `create`, `view`, `update`, `delete`
- **Medication (5)**: `create`, `view`, `update`, `delete`, `administer`
- **Role (4)**: `create`, `view`, `update`, `delete`
- **User (8)**: `create`, `view`, `update`, `delete`, `role_assign`, `role_revoke`, `schedule_manage`, `client_assign`

### partner_admin (4 permissions)

- `organization.view`, `client.view`, `medication.view`, `user.view`

### clinician (4 permissions)

- `client.view`, `client.update`, `medication.view`, `medication.create`

### viewer (3 permissions)

- `client.view`, `medication.view`, `user.view`

## Source Files

- **Table Definition**: `infrastructure/supabase/sql/02-tables/rbac/006-role_permission_templates.sql`
- **Seed Data**: `infrastructure/supabase/sql/99-seeds/012-role-permission-templates.sql`
- **Consolidated Schema**: `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql`

## Related Tables

| Table | Relationship |
|-------|--------------|
| `permissions_projection` | Referenced by `permission_name` (logical, not FK) |
| `roles_projection` | Templates applied to roles during bootstrap |
| `role_permissions_projection` | Populated with grants from templates |

## Related Documentation

- [Permissions Reference](../../../../architecture/authorization/permissions-reference.md)
- [Provider Admin Permissions Architecture](../../../../architecture/authorization/provider-admin-permissions-architecture.md)
- [RBAC Architecture](../../../../architecture/authorization/rbac-architecture.md)

## Migration History

| Version | Date | Change |
|---------|------|--------|
| 006-role_permission_templates.sql | 2025-12-20 | Initial table creation |
| 012-role-permission-templates.sql | 2025-12-20 | Seed templates for 4 role types |
| 20260202181252_seed_schedule_assignment_permissions.sql | 2026-02-02 | Added user.schedule_manage, user.client_assign to provider_admin |
| 20260204213125_backfill_provider_admin_schedule_permissions.sql | 2026-02-04 | Backfilled permissions for existing provider_admin roles |
