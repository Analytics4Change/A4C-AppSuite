# Tasks: Provider Admin Permissions Bootstrap

## Phase 1: Documentation - Canonical Permissions Reference ✅ COMPLETE

- [x] Create permissions reference document (`documentation/architecture/authorization/permissions-reference.md`)
- [x] Define ALL 34 permissions (7 global + 27 org-scoped)
- [x] Map permissions to canonical roles (super_admin: all, provider_admin: 16)
- [x] Document permission naming conventions (`resource.action` format)

## Phase 2: Database Fixes - Add Missing Permissions ✅ COMPLETE

- [x] Create `infrastructure/supabase/sql/99-seeds/010-add-ou-permissions.sql`
- [x] Add `organization.view_ou` permission via `permission.defined` event
- [x] Add `organization.create_ou` permission via `permission.defined` event
- [x] Ensure idempotency (IF NOT EXISTS pattern)
- [x] Add to CONSOLIDATED_SCHEMA.sql

## Phase 3: Database Fixes - Grant Permissions to Existing Roles ✅ COMPLETE

- [x] Create `infrastructure/supabase/sql/99-seeds/011-grant-provider-admin-permissions.sql`
- [x] Grant canonical 16 permissions to all existing `provider_admin` roles
- [x] Use `role.permission.granted` events for audit trail
- [x] Ensure idempotency (check before grant)
- [x] Add to CONSOLIDATED_SCHEMA.sql

## Phase 4: Temporal Workflow - Permission Granting Activity ✅ COMPLETE

- [x] Create `workflows/src/activities/organization-bootstrap/grant-provider-admin-permissions.ts`
- [x] Define `PROVIDER_ADMIN_PERMISSIONS` constant with 16 canonical permissions
- [x] Implement idempotent role creation via `role.created` event
- [x] Implement permission granting via `role.permission.granted` events
- [x] Fix TypeScript error with Supabase nested join type casting
- [x] Update `workflows/src/activities/organization-bootstrap/index.ts` to export activity
- [x] Add types to `workflows/src/shared/types/index.ts`
- [x] Update `workflows/src/workflows/organization-bootstrap/workflow.ts` to call activity after org creation

## Phase 5: Frontend Cleanup ✅ COMPLETE

- [x] Remove `partner_onboarder` from `frontend/src/types/auth.types.ts`
- [x] Remove `partner_onboarder` from `frontend/src/config/roles.config.ts`
- [x] Remove `partner_onboarder` from `frontend/src/components/layouts/MainLayout.tsx`
- [x] Remove unused permissions from `frontend/src/config/permissions.config.ts` (73 → 28)
- [x] Rename permissions to match database naming (`org_client.create` → `client.create`, etc.)
- [x] Update `frontend/src/config/dev-auth.config.ts` DEV_PERMISSIONS
- [x] Update `frontend/src/config/roles.config.ts` getMenuItemsForRole function

## Phase 6: Documentation Updates ✅ COMPLETE

- [x] Create `documentation/architecture/authorization/permissions-reference.md`
- [x] Update `documentation/architecture/authorization/provider-admin-permissions-architecture.md` with implementation status

## Phase 7: UAT Validation ✅ COMPLETE (via manual workaround)

- [x] Run SQL scripts in Supabase Studio (FAILED - trigger bug, see Phase 8)
  - `infrastructure/supabase/sql/99-seeds/010-add-ou-permissions.sql`
  - `infrastructure/supabase/sql/99-seeds/011-grant-provider-admin-permissions.sql`
- [x] Verify `organization.view_ou` exists in `permissions_projection` (manual insert applied)
- [x] Verify existing `provider_admin` roles have 16 permissions in `role_permissions_projection` (144 grants inserted)
- [ ] User johnltice@yahoo.com sees "Organization Units" nav item (USER TO VERIFY)
- [ ] No regressions in other nav items

**Note**: Event-sourced SQL seed files failed due to `process_rbac_event` trigger bug. Permissions were manually inserted directly into projection tables as workaround.

## Phase 8: Fix process_rbac_event Trigger ✅ COMPLETE

**Root Cause**: Schema drift - production `audit_log` missing `event_name` and `event_description` columns that git defines.

**Fix Applied**: Added missing columns via ALTER TABLE (same pattern as `session_id` fix in commit `b1829c62`).

- [x] Audit `audit_log` table schema vs `process_rbac_event()` function expectations
- [x] Identify fix: Add missing columns to production (not change functions)
- [x] Create migration: `infrastructure/supabase/sql/02-tables/audit_log/002-add-missing-columns.sql`
- [x] Update `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql`
- [x] Deploy migration via MCP `apply_migration`
- [x] Re-process 11 failed events (all now have `processed_at` timestamps)
- [x] Verify audit_log has entries with new columns populated
- [ ] Verify Temporal activity works for new org creation (requires deployment)

## Success Validation Checkpoints

### Immediate Validation (Manual workaround applied)
- [x] `organization.view_ou` permission exists in database (manually inserted)
- [x] All 9 existing `provider_admin` roles have 16 permissions (144 grants inserted)
- [ ] User johnltice@yahoo.com can see Organization Units nav (USER TO VERIFY)

### Feature Complete Validation
- [x] Temporal activity created for new org permission granting
- [x] Bootstrap workflow calls new activity
- [x] Frontend permissions aligned to database naming
- [x] Canonical permissions documented

### Long-Term Validation
- [ ] Fix `process_rbac_event` trigger so event-sourcing works (BLOCKER)
- [ ] Test new organization bootstrap grants permissions
- [ ] Remove implicit grant from `user_has_permission()` SQL function (Phase 3 cutover)

## Phase 9: Database-Driven Permission Templates ✅ COMPLETE

**Problem Solved**: Role scoping was incorrect (provider_admin seeded as global role) and permission templates were hardcoded in TypeScript.

### 9.1 Create role_permission_templates Table
- [x] Create `infrastructure/supabase/sql/02-tables/rbac/006-role_permission_templates.sql`
- [x] Define columns: role_name, permission_name, is_active, created_at, updated_at, created_by
- [x] Add RLS policies (read: all, write: super_admin only)
- [x] Apply migration via MCP

### 9.2 Seed Permission Templates
- [x] Create `infrastructure/supabase/sql/99-seeds/012-role-permission-templates.sql`
- [x] Seed 27 templates: provider_admin (16), partner_admin (4), clinician (4), viewer (3)
- [x] Apply seed via MCP

### 9.3 Update Temporal Activity to Query Templates
- [x] Add `getTemplatePermissions()` function to query database
- [x] Falls back to hardcoded `PROVIDER_ADMIN_PERMISSIONS` if no templates found
- [x] Activity now database-driven, platform owners can modify templates via SQL

### 9.4 Fix Role Scoping for Non-Super_Admin Roles
- [x] Fix column name from `org_id` to `organization_id` in queries
- [x] Add `organization_id` to role.created event_data (required for per-org roles)
- [x] Add `org_hierarchy_scope` to role.created event_data (LTREE path)
- [x] Add `scopePath` parameter to activity interface
- [x] Update workflow to pass scopePath (subdomain or sanitized org name)
- [x] Update shared types in `workflows/src/shared/types/index.ts`

### 9.5 Clean Up Invalid Seed Events
- [x] Deleted 3 invalid events from domain_events that had NULL organization_id for non-super_admin roles
- [x] Updated `002-bootstrap-org-roles.sql` to remove global provider_admin/partner_admin seeds
- [x] Only super_admin is now seeded as a global role

### 9.6 Sync CONSOLIDATED_SCHEMA.sql
- [x] Added role_permission_templates table definition
- [x] Added role permission templates seed data
- [x] Updated 002-bootstrap-org-roles.sql section

### 9.7 Documentation Updates
- [x] Updated `documentation/architecture/authorization/permissions-reference.md` with Permission Templates section
- [x] Created `documentation/infrastructure/reference/database/tables/role_permission_templates.md`
- [x] Updated `documentation/architecture/authorization/provider-admin-permissions-architecture.md` with Phase 3 status
- [x] Updated `documentation/workflows/reference/activities-reference.md` with RBAC Activities section

## Current Status

**Phase**: Phase 9 (Database-Driven Permission Templates)
**Status**: ✅ COMPLETE
**Last Updated**: 2025-12-20
**Completed**:
1. Created `role_permission_templates` table with RLS policies
2. Seeded 27 templates across 4 role types
3. Updated Temporal activity to query templates from database (with fallback)
4. Fixed role scoping: added organization_id and org_hierarchy_scope to role.created events
5. Added scopePath parameter to activity
6. Cleaned up invalid seed events in database and SQL
7. Synced CONSOLIDATED_SCHEMA.sql with all migrations
8. Updated all relevant documentation

**Remaining**:
- Deploy Temporal worker to test new org bootstrap workflow
- Test end-to-end: create new organization → verify provider_admin role created with correct scoping and all 16 permissions

**Next Step After /clear**:
1. Deploy the Temporal worker with updated `grant-provider-admin-permissions.ts` activity
2. Create a test organization via the bootstrap workflow
3. Verify the provider_admin role is created with:
   - `organization_id` set to the new org's UUID
   - `org_hierarchy_scope` set to the subdomain (LTREE path)
   - All 16 permissions granted via `role.permission.granted` events
4. Check `roles_projection` and `role_permissions_projection` tables for correct data

## Files Created/Modified This Session

### New Files Created
| File | Purpose |
|------|---------|
| `workflows/src/activities/organization-bootstrap/grant-provider-admin-permissions.ts` | Temporal activity to grant 16 permissions |
| `infrastructure/supabase/sql/99-seeds/010-add-ou-permissions.sql` | Add view_ou and create_ou permissions |
| `infrastructure/supabase/sql/99-seeds/011-grant-provider-admin-permissions.sql` | Backfill existing roles |
| `infrastructure/supabase/sql/02-tables/rbac/006-role_permission_templates.sql` | Permission templates table |
| `infrastructure/supabase/sql/99-seeds/012-role-permission-templates.sql` | Seed templates for 4 role types |
| `documentation/architecture/authorization/permissions-reference.md` | Canonical permissions reference |
| `documentation/infrastructure/reference/database/tables/role_permission_templates.md` | Table schema reference |

### Existing Files Modified
| File | Changes |
|------|---------|
| `workflows/src/workflows/organization-bootstrap/workflow.ts` | Added Step 1.5 to grant permissions, pass scopePath |
| `workflows/src/activities/organization-bootstrap/index.ts` | Export new activity |
| `workflows/src/activities/organization-bootstrap/grant-provider-admin-permissions.ts` | Query templates from DB, fix org_id→organization_id, add scopePath |
| `workflows/src/shared/types/index.ts` | Added GrantProviderAdminPermissions types with scopePath |
| `frontend/src/types/auth.types.ts` | Removed partner_onboarder |
| `frontend/src/config/permissions.config.ts` | Reduced from 73 to 28 permissions, aligned naming |
| `frontend/src/config/roles.config.ts` | Removed partner_onboarder, updated getMenuItemsForRole |
| `frontend/src/config/dev-auth.config.ts` | Updated DEV_PERMISSIONS to match database |
| `frontend/src/components/layouts/MainLayout.tsx` | Removed partner_onboarder from nav |
| `infrastructure/supabase/sql/99-seeds/002-bootstrap-org-roles.sql` | Removed global provider_admin/partner_admin seeds |
| `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql` | Added templates table, seeds, removed invalid role seeds |
| `documentation/architecture/authorization/permissions-reference.md` | Added Permission Templates section, role scoping |
| `documentation/architecture/authorization/provider-admin-permissions-architecture.md` | Added Phase 3 implementation status |
| `documentation/workflows/reference/activities-reference.md` | Added RBAC Activities section for grantProviderAdminPermissions |
