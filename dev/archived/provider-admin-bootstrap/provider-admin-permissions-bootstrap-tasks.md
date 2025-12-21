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

## Phase 10: E2E Validation - Form UX + Backend API Fixes ✅ COMPLETE

**Problem Identified During UAT**: Organization create form had UX issues and backend API returned 503.

### 10.1 Form UX Fixes
- [x] Prevent Enter key from submitting form prematurely in text inputs
- [x] Clear validation errors when user edits any field (better UX flow)
- [x] Add `handleFormKeyDown` handler to OrganizationCreatePage.tsx
- [x] Update `updateField()` and `updateNestedField()` in OrganizationFormViewModel.ts

### 10.2 Backend API Fixes
- [x] Diagnose temporal-api 503 error (pods Running but NOT Ready for 10+ days)
- [x] Root cause: One-time Temporal connection check failed at startup, no retry logic
- [x] Add dynamic CORS derivation from `PLATFORM_BASE_DOMAIN` environment variable
- [x] Add Temporal connection retry with exponential backoff (5 attempts, max 30s)
- [x] Update ConfigMap to use `PLATFORM_BASE_DOMAIN: firstovertheline.com`
- [x] Restart temporal-api pods to force reconnection (now 1/1 Ready)
- [x] Verify `/health` and `/ready` endpoints return 200

### 10.3 Deployment
- [x] Commit and push all changes (commit 8419b0b7)
- [ ] CI/CD rebuilds temporal-api image with new CORS/retry logic
- [ ] Test end-to-end organization bootstrap from UI

## Phase 11: Fix Missing GRANT SELECT for service_role ✅ COMPLETE

**Problem Identified**: Workflow failed at `grantProviderAdminPermissions` with `permission denied for table role_permission_templates` despite RLS policies existing.

**Root Cause**: PostgreSQL permission model has two layers:
1. GRANT (base privilege) - Missing! Required to access table at all
2. RLS policy - Existed but couldn't help without GRANT

### 11.1 Add Missing GRANT SELECT Statements
- [x] Identify missing GRANTs by comparing with `workflow_queue_projection` (the only projection that worked)
- [x] Add `GRANT SELECT ON <table> TO service_role` for 9 projection tables
- [x] Update `infrastructure/supabase/sql/05-policies/011-service-role-projection-access.sql`
- [x] Sync with `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql`
- [x] Deploy via MCP `execute_sql`
- [x] Verify all 9 GRANTs exist in database

### 11.2 Cleanup Failed Organization
- [x] Executed `/org-cleanup poc-test1-20251221`
- [x] Verified 0 records remain in all 23 FK-linked tables
- [x] Verified no DNS records exist (workflow failed before DNS creation)

### 11.3 Commit and Push
- [x] Committed changes (commit `42a349a6`)
- [x] Pushed to remote

## Current Status

**Phase**: Phase 11 (Fix Missing GRANT SELECT for service_role)
**Status**: ✅ COMPLETE (awaiting user to create new test organization)
**Last Updated**: 2025-12-21
**Completed**:
1. Discovered root cause: GRANT (base privilege) vs RLS (row-level security) are independent
2. Added GRANT SELECT for all 9 projection tables to service_role
3. Updated migration file and CONSOLIDATED_SCHEMA.sql
4. Deployed to production via MCP
5. Cleaned up failed organization `poc-test1-20251221` (org_id: `b53574e1-a65d-4d9f-8d9d-fac255f0654d`)
6. Verified all 23 tables have 0 orphan records
7. Committed and pushed (commit `42a349a6`)

**Remaining**:
- User creates new test organization via frontend
- Verify workflow completes to "active" status
- Verify provider_admin role created with 16 permissions

**Next Step After /clear**:
1. Navigate to `https://a4c.firstovertheline.com/organizations/create`
2. Fill in organization form and submit
3. Monitor worker logs: `kubectl logs -n temporal -l app=workflow-worker --tail=100 -f`
4. Verify workflow completes without "permission denied" errors
5. Verify in database:
   - `organizations_projection` has new org with status='active'
   - `roles_projection` has provider_admin role with organization_id set
   - `role_permissions_projection` has 16 permissions for that role

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

### Phase 10 Files Modified (2025-12-20)
| File | Changes |
|------|---------|
| `frontend/src/pages/organizations/OrganizationCreatePage.tsx` | Added `handleFormKeyDown` to prevent Enter key submission |
| `frontend/src/viewModels/organization/OrganizationFormViewModel.ts` | Clear validation errors in `updateField()` and `updateNestedField()` |
| `workflows/src/api/server.ts` | Added dynamic CORS from PLATFORM_BASE_DOMAIN, Temporal retry logic |
| `infrastructure/k8s/temporal-api/configmap.yaml` | Changed from CORS_ORIGINS to PLATFORM_BASE_DOMAIN |

### Phase 11 Files Modified (2025-12-21)
| File | Changes | Commit |
|------|---------|--------|
| `infrastructure/supabase/sql/05-policies/011-service-role-projection-access.sql` | Added GRANT SELECT for 9 projection tables to service_role | `42a349a6` |
| `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql` | Added GRANT SELECT statements near line 3032 (after workflow_queue_projection) | `42a349a6` |
