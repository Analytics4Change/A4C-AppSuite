# Context: Provider Admin Permissions Bootstrap

## Decision Record

**Date**: 2025-12-19
**Feature**: Provider Admin Permissions Bootstrap
**Goal**: Fix missing "Organization Units" nav item for provider_admin users by implementing proper permission seeding and granting in the organization bootstrap workflow.

### Key Decisions

1. **Event-Sourced Permissions**: All permission definitions and grants will use domain events (`permission.defined`, `role.permission.granted`) rather than direct INSERT statements. This maintains audit trail and follows CQRS architecture.

2. **Canonical Permissions Reference**: Create a single source-of-truth document (`permissions-reference.md`) that defines all permissions and role assignments. This document will be the authoritative reference for both SQL seeds and Temporal workflow.

3. **Backfill Before Forward-Fix**: Fix existing organizations first via SQL seeds, then implement the Temporal activity for new organizations. This ensures immediate UAT fix while building proper long-term solution.

4. **Permission Naming Convention**: Acknowledge mismatch between frontend (`org_client.create`) and database (`client.create`) naming. Document mappings rather than mass-rename to avoid breaking existing RLS policies.

5. **Implicit Grant Deprecation**: The `user_has_permission()` SQL function has an implicit grant for provider_admin (short-term hack). This will be removed once all roles have explicit permissions in `role_permissions_projection`.

## Technical Context

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Permission System Components                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Frontend                    Backend                     Database        │
│  ────────                    ───────                     ────────        │
│  permissions.config.ts ───→ Temporal Activity ───→ domain_events        │
│  roles.config.ts                    │                     │              │
│  MainLayout.tsx                     ▼                     ▼              │
│       │               role.permission.granted      permissions_projection │
│       │                                            role_permissions_projection │
│       │                                                   │              │
│       │                                                   ▼              │
│       └────────────── JWT claims ◄───── custom_access_token_hook         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Tech Stack

- **Frontend**: React + TypeScript, Vite
  - `frontend/src/config/permissions.config.ts` - Permission definitions
  - `frontend/src/config/roles.config.ts` - Role-permission mappings
  - `frontend/src/components/layouts/MainLayout.tsx` - Nav filtering logic

- **Backend**: Temporal.io workflow orchestration
  - `workflows/src/workflows/organization-bootstrap/workflow.ts` - Main workflow
  - `workflows/src/activities/organization-bootstrap/` - Activities

- **Database**: PostgreSQL via Supabase
  - `permissions_projection` - Read model of defined permissions
  - `role_permissions_projection` - Junction table for role-permission mapping
  - `domain_events` - Event store for all changes
  - `custom_access_token_hook` - JWT claims hook

### Dependencies

- **JWT Hook**: Already includes `org_type` claim (added in recent commit 0b767a8c)
- **Nav Filtering**: `showForOrgTypes` and `hideForOrgTypes` patterns working
- **Event Processors**: Triggers exist to populate projections from events

## File Structure

### New Files Created (2025-12-20)

| File | Purpose | Status |
|------|---------|--------|
| `documentation/architecture/authorization/permissions-reference.md` | Canonical 34-permission reference | ✅ Created |
| `infrastructure/supabase/sql/99-seeds/010-add-ou-permissions.sql` | Add view_ou and create_ou permissions | ✅ Created |
| `infrastructure/supabase/sql/99-seeds/011-grant-provider-admin-permissions.sql` | Backfill 9 existing roles with 16 permissions | ✅ Created |
| `workflows/src/activities/organization-bootstrap/grant-provider-admin-permissions.ts` | Temporal activity for new orgs | ✅ Created |

### Existing Files Modified (2025-12-20)

| File | Changes | Status |
|------|---------|--------|
| `workflows/src/workflows/organization-bootstrap/workflow.ts` | Added Step 1.5 to call grantProviderAdminPermissions after org creation | ✅ Done |
| `workflows/src/activities/organization-bootstrap/index.ts` | Export new activity | ✅ Done |
| `workflows/src/shared/types/index.ts` | Added GrantProviderAdminPermissions types | ✅ Done |
| `frontend/src/types/auth.types.ts` | Removed partner_onboarder from UserRole type | ✅ Done |
| `frontend/src/config/permissions.config.ts` | Reduced 73→28 permissions, aligned naming to DB | ✅ Done |
| `frontend/src/config/roles.config.ts` | Removed partner_onboarder, updated getMenuItemsForRole | ✅ Done |
| `frontend/src/config/dev-auth.config.ts` | Updated DEV_PERMISSIONS to match database naming | ✅ Done |
| `frontend/src/components/layouts/MainLayout.tsx` | Removed partner_onboarder from nav items | ✅ Done |
| `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql` | Added both seed SQL files before COMMIT | ✅ Done |
| `documentation/architecture/authorization/provider-admin-permissions-architecture.md` | Added implementation status header | ✅ Done |

## Related Components

### Nav Item Filtering (MainLayout.tsx:76-83)
```typescript
const allNavItems: NavItem[] = [
  { to: '/clients', icon: Users, label: 'Clients', roles: [...], hideForOrgTypes: ['platform_owner'] },
  { to: '/organizations', icon: Building, label: 'Organizations', roles: [...], showForOrgTypes: ['platform_owner'] },
  { to: '/organization-units', icon: FolderTree, label: 'Organization Units',
    roles: ['super_admin', 'provider_admin'],
    permission: 'organization.view_ou',  // <-- THIS PERMISSION IS MISSING
    showForOrgTypes: ['provider'] },
  // ...
];
```

### JWT Hook (003-supabase-auth-jwt-hook.sql)
Already correctly queries `role_permissions_projection` for permissions:
```sql
SELECT array_agg(DISTINCT p.name)
INTO v_permissions
FROM user_roles_projection ur
JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
JOIN permissions_projection p ON p.id = rp.permission_id
WHERE ur.user_id = v_user_id
  AND (ur.org_id = v_org_id OR ur.org_id IS NULL);
```

### Event Processor (004-process-rbac-events.sql:77-87)
Already handles `role.permission.granted` events:
```sql
WHEN 'role.permission.granted' THEN
  INSERT INTO role_permissions_projection (role_id, permission_id, granted_at)
  VALUES (p_event.stream_id,
          safe_jsonb_extract_uuid(p_event.event_data, 'permission_id'),
          p_event.created_at)
  ON CONFLICT (role_id, permission_id) DO NOTHING;
```

## Key Patterns and Conventions

### Permission Naming Pattern
- Format: `{resource}.{action}` (e.g., `organization.view_ou`, `client.create`)
- Resource: noun (organization, client, medication, user, role)
- Action: verb (create, view, update, delete, assign, export)

### Event Sourcing Pattern
All data changes go through `domain_events` table:
```typescript
await supabase.from('domain_events').insert({
  event_type: 'role.permission.granted',
  stream_type: 'role',
  stream_id: roleId,  // Role UUID
  event_data: { permission_id: permId, permission_name: 'organization.view_ou' },
  event_metadata: { user_id: 'system', reason: 'organization_bootstrap' }
});
```

### Idempotency Pattern
All SQL uses `ON CONFLICT DO NOTHING` for safe re-runs.

## Reference Materials

- **Existing Architecture Doc**: `documentation/architecture/authorization/provider-admin-permissions-architecture.md`
- **RBAC Architecture**: `documentation/architecture/authorization/rbac-architecture.md`
- **Permissions Projection Doc**: `documentation/infrastructure/reference/database/tables/permissions_projection.md`
- **AsyncAPI Contract**: `infrastructure/supabase/contracts/asyncapi/domains/rbac.yaml`

## Important Constraints

1. **Database has 32 permissions, frontend defines 73** - ✅ RESOLVED: Frontend reduced to 28 permissions aligned to DB
2. **Permission names differ** - ✅ RESOLVED: Frontend renamed to match database (`client.create` not `org_client.create`)
3. **9 existing provider_admin roles** - SQL backfill created, awaiting execution
4. **User johnltice@yahoo.com** - Test user for UAT validation
5. **Organization: poc-test2-20251218** - Test org with `type: 'provider'`

## Technical Issues Encountered (2025-12-20)

### TypeScript Error in grant-provider-admin-permissions.ts
- **Error**: `TS2352: Conversion of type '{ name: any; }[]' to type '{ name: string; }' may be a mistake`
- **Cause**: Supabase nested join (`permissions_projection!inner(name)`) returns different type structure
- **Fix**: Used `as unknown as { name: string }` cast for the permissions_projection field
- **Location**: `workflows/src/activities/organization-bootstrap/grant-provider-admin-permissions.ts:145`

### CRITICAL BUG: process_rbac_event Trigger Schema Mismatch (2025-12-20)
- **Error**: `column "event_name" of relation "audit_log" does not exist`
- **Cause**: The `process_rbac_event()` function in `004-process-rbac-events.sql` tries to INSERT into `audit_log` with columns that don't exist:
  - `event_name` - DOES NOT EXIST in audit_log
  - `event_description` - DOES NOT EXIST in audit_log
- **Impact**: ALL RBAC events fail to process - `permission.defined`, `role.created`, `role.permission.granted` events are stored in `domain_events` but projections are NOT updated
- **Evidence**: Events in `domain_events` have `processed_at = NULL` and `processing_error` containing the column mismatch error
- **Workaround Applied**: Manually inserted into projection tables bypassing the trigger:
  - Inserted `organization.view_ou` and `organization.create_ou` directly into `permissions_projection`
  - Inserted 144 grants (16 permissions × 9 roles) directly into `role_permissions_projection`
- **Root Cause**: The `audit_log` table has columns: `id, organization_id, event_type, event_category, user_id, user_email, resource_type, resource_id, operation, old_values, new_values, ip_address, metadata, created_at, session_id`
- **Fix Required**: Update `process_rbac_event()` function to use correct `audit_log` column names or add missing columns to `audit_log` table
- **Location**: `infrastructure/supabase/sql/03-functions/event-processing/004-process-rbac-events.sql`

### Proposed Fix for process_rbac_event (2025-12-20)
The fix involves updating the audit_log INSERT statement in `process_rbac_event()`:

**Column Mapping:**
| Old (broken) | New (correct) | Notes |
|--------------|---------------|-------|
| `event_name` | Remove | Already captured in `event_type` |
| `event_description` | Remove | Move to `metadata` JSONB |
| (missing) | `operation` | Set to `p_event.event_type` |

**Files to Update (BOTH required):**
1. `infrastructure/supabase/sql/03-functions/event-processing/004-process-rbac-events.sql` (source)
2. `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql` (must stay in sync)

**User Preference**: User wants to see and approve plan/diff before any changes are applied.

### Impact on Temporal Activity
- **Problem**: The new `grantProviderAdminPermissions` activity we created will ALSO fail when it emits `role.permission.granted` events
- **Why**: It inserts events into `domain_events`, which triggers `process_domain_event` → `process_rbac_event` → FAILS on audit_log insert
- **Temporary State**: The manual backfill works, but new org creation via Temporal will not grant permissions until the trigger is fixed

### Canonical provider_admin Permissions (16 total)
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

## Why This Approach?

### Alternative 1: Remove Permission Requirement from Nav
- **Rejected**: Less secure, doesn't fix root cause

### Alternative 2: Direct SQL INSERTs
- **Rejected**: Bypasses event sourcing, no audit trail

### Alternative 3: Frontend-only implicit grants (like mock mode)
- **Rejected**: Already exists as short-term hack, needs proper backend support

### Chosen: Event-Sourced Permission Grants
- Follows existing architecture patterns
- Provides audit trail via domain_events
- Enables future permission management UI
- Aligns with Temporal workflow patterns
