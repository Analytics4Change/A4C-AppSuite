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

6. **Database-Driven Permission Templates** (2025-12-20): Permission templates stored in `role_permission_templates` table instead of hardcoded TypeScript. Enables platform owners to modify templates via SQL without code changes. Activity queries database with fallback to hardcoded constant.

7. **Per-Organization Role Scoping** (2025-12-20): Only `super_admin` is global (organization_id=NULL). All other roles (`provider_admin`, `partner_admin`, `clinician`, `viewer`) are per-organization with required `organization_id` and `org_hierarchy_scope` (LTREE path). This aligns with `roles_projection_scope_check` constraint.

8. **Form UX: No Enter Key Submission** (2025-12-20): Complex multi-field forms should NOT submit on Enter key in text inputs. Added `handleFormKeyDown` handler to prevent default browser behavior. Enter still works for dropdown selection and focused submit button.

9. **Clear Validation Errors on Edit** (2025-12-20): Validation errors clear when user starts editing ANY field, rather than persisting stale errors. Errors re-appear on next submit if still invalid. Better UX flow.

10. **Dynamic CORS from Platform Domain** (2025-12-20): Backend API derives CORS origins from `PLATFORM_BASE_DOMAIN` environment variable using regex pattern `^https://([a-z0-9-]+\.)?{domain}$`. This allows all tenant subdomains (*.firstovertheline.com) without hardcoding.

11. **Temporal Connection Retry** (2025-12-20): Backend API now retries Temporal connection 5 times with exponential backoff (1s, 2s, 4s, 8s, 16s max 30s). Prevents permanent failure when Temporal is briefly unavailable at startup.

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
| `infrastructure/supabase/sql/02-tables/rbac/006-role_permission_templates.sql` | Permission templates table for database-driven role permissions | ✅ Created |
| `infrastructure/supabase/sql/99-seeds/012-role-permission-templates.sql` | Seed templates: 27 total (16 provider_admin, 4 partner_admin, 4 clinician, 3 viewer) | ✅ Created |
| `documentation/infrastructure/reference/database/tables/role_permission_templates.md` | Table schema reference documentation | ✅ Created |
| `infrastructure/supabase/sql/02-tables/audit_log/002-add-missing-columns.sql` | Add missing event_name, event_description columns to audit_log | ✅ Created |

### Existing Files Modified (2025-12-20)

| File | Changes | Status |
|------|---------|--------|
| `workflows/src/workflows/organization-bootstrap/workflow.ts` | Added Step 1.5 to call grantProviderAdminPermissions, pass scopePath | ✅ Done |
| `workflows/src/activities/organization-bootstrap/index.ts` | Export new activity | ✅ Done |
| `workflows/src/shared/types/index.ts` | Added GrantProviderAdminPermissions types with scopePath parameter | ✅ Done |
| `workflows/src/activities/organization-bootstrap/grant-provider-admin-permissions.ts` | Query templates from DB, fix org_id→organization_id, add org_hierarchy_scope | ✅ Done |
| `frontend/src/types/auth.types.ts` | Removed partner_onboarder from UserRole type | ✅ Done |
| `frontend/src/config/permissions.config.ts` | Reduced 73→28 permissions, aligned naming to DB | ✅ Done |
| `frontend/src/config/roles.config.ts` | Removed partner_onboarder, updated getMenuItemsForRole | ✅ Done |
| `frontend/src/config/dev-auth.config.ts` | Updated DEV_PERMISSIONS to match database naming | ✅ Done |
| `frontend/src/components/layouts/MainLayout.tsx` | Removed partner_onboarder from nav items | ✅ Done |
| `infrastructure/supabase/sql/99-seeds/002-bootstrap-org-roles.sql` | Removed global provider_admin/partner_admin seeds (only super_admin is global) | ✅ Done |
| `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql` | Added templates table, seeds, removed invalid role seeds | ✅ Done |
| `documentation/architecture/authorization/permissions-reference.md` | Added Permission Templates section with role scoping architecture | ✅ Done |
| `documentation/architecture/authorization/provider-admin-permissions-architecture.md` | Added Phase 3 implementation status | ✅ Done |

### Phase 10 Files Modified (2025-12-20)

| File | Changes | Status |
|------|---------|--------|
| `frontend/src/pages/organizations/OrganizationCreatePage.tsx` | Added `handleFormKeyDown` to prevent Enter key submission in text inputs | ✅ Done |
| `frontend/src/viewModels/organization/OrganizationFormViewModel.ts` | Clear `validationErrors` array in `updateField()` and `updateNestedField()` | ✅ Done |
| `workflows/src/api/server.ts` | Added `getCorsOrigin()` with PLATFORM_BASE_DOMAIN regex, `connectToTemporal()` with retry logic | ✅ Done |
| `infrastructure/k8s/temporal-api/configmap.yaml` | Replaced `CORS_ORIGINS` with `PLATFORM_BASE_DOMAIN: firstovertheline.com` | ✅ Done |
| `documentation/workflows/reference/activities-reference.md` | Added RBAC Activities section for grantProviderAdminPermissions | ✅ Done |

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
3. **9 existing provider_admin roles** - ✅ RESOLVED: SQL backfill applied, permissions granted via workaround
4. **User johnltice@yahoo.com** - Test user for UAT validation
5. **Organization: poc-test2-20251218** - Test org with `type: 'provider'`
6. **Role Scoping Check Constraint** (2025-12-20) - ✅ RESOLVED: The `roles_projection_scope_check` constraint requires non-super_admin roles to have `organization_id` set. Fixed by adding `organization_id` and `org_hierarchy_scope` to role.created events.
7. **Invalid Seed Events** (2025-12-20) - ✅ RESOLVED: Deleted 3 invalid events from domain_events that had NULL organization_id for non-super_admin roles. Updated 002-bootstrap-org-roles.sql to only seed super_admin as global.

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

### Fix Applied for process_rbac_event (2025-12-20)
**Root Cause**: Schema drift - production `audit_log` table had only 15 columns, git defines 25+. Missing `event_name` and `event_description` columns caused all RBAC event processing to fail.

**Solution**: Added missing columns via ALTER TABLE migration (same pattern as `session_id` fix in commit `b1829c62`).

**Files Created/Modified:**
1. `infrastructure/supabase/sql/02-tables/audit_log/002-add-missing-columns.sql` (new migration)
2. `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql` (added migration after table definition)

**Deployed via**: MCP `apply_migration` tool

**Result**: 11 failed events re-processed successfully, audit_log now has entries with new columns populated.

### Impact on Temporal Activity - RESOLVED
- **Previously**: The `grantProviderAdminPermissions` activity would fail when emitting `role.permission.granted` events
- **Now**: Fixed by adding missing columns. Event processing works correctly.
- **Next Step**: Deploy Temporal worker to test new org bootstrap workflow

### Temporal-API 503 Error During UAT (2025-12-20)
**Problem**: Organization create form returned 503 error when submitting. temporal-api pods were Running but NOT Ready for 10+ days.

**Root Causes**:
1. **One-time connection check**: `server.ts` checked Temporal connection once at startup with no retry logic. If Temporal was briefly unavailable, `temporalConnected` stayed `false` forever.
2. **CORS misconfiguration**: ConfigMap used `CORS_ORIGINS` but code checked `ALLOWED_ORIGINS`. Variable name mismatch.
3. **No CI/CD trigger**: Recent commits modified `workflows/src/activities/**` but temporal-api deployment only triggers on `workflows/src/api/**` changes.

**Solutions Applied**:
1. Added `connectToTemporal()` with exponential backoff retry (5 attempts, 1s→2s→4s→8s→16s max 30s)
2. Added `getCorsOrigin()` that derives CORS from `PLATFORM_BASE_DOMAIN` using regex
3. Updated ConfigMap to use `PLATFORM_BASE_DOMAIN: firstovertheline.com`
4. Deleted pods to force restart and reconnection

**Files Changed**:
- `workflows/src/api/server.ts` - Added retry logic and dynamic CORS
- `infrastructure/k8s/temporal-api/configmap.yaml` - PLATFORM_BASE_DOMAIN

### Form Validation UX Issues (2025-12-20)
**Problem**: Pressing Enter in text fields triggered premature form submission, causing validation errors to display before user was ready.

**Root Cause**: Default browser behavior - Enter key in `<input>` inside `<form>` submits the form.

**Solution**: Added `handleFormKeyDown` handler that prevents default for Enter key in text-type inputs. Enter still works for:
- Radix Select dropdowns (item selection)
- Submit button when focused
- Non-text inputs (checkboxes, radios)

**Additional Fix**: Clear ALL validation errors when user starts editing ANY field. Better UX than showing stale errors.

### Role Scoping Fix (2025-12-20)
**Problem**: The original seed file `002-bootstrap-org-roles.sql` seeded `provider_admin` and `partner_admin` roles as global roles (organization_id=NULL). However, the `roles_projection_scope_check` constraint requires non-super_admin roles to have `organization_id` set.

**Solution Applied**:
1. Deleted 3 invalid seed events from `domain_events` that could never be processed
2. Updated `002-bootstrap-org-roles.sql` to only seed `super_admin` (the only legitimate global role)
3. Added `organization_id` and `org_hierarchy_scope` to the `role.created` event_data in the Temporal activity
4. Added `scopePath` parameter to `GrantProviderAdminPermissionsParams` interface
5. Updated workflow to pass `scopePath` (subdomain or sanitized org name)

**Key Insight**: Roles like `provider_admin` are created **per-organization** during bootstrap, not as global templates. Each organization gets its own `provider_admin` role instance with proper org scoping.

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
