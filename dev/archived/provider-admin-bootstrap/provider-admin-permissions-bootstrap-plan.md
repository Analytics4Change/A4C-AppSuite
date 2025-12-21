# Implementation Plan: Provider Admin Permissions Bootstrap

## Implementation Status

| Phase | Status | Completed |
|-------|--------|-----------|
| Phase 1: Documentation | ✅ Complete | 2025-12-20 |
| Phase 2: Database Fixes (Permissions) | ✅ Complete | 2025-12-20 |
| Phase 3: Database Fixes (Grants) | ✅ Complete | 2025-12-20 |
| Phase 4: Temporal Workflow | ✅ Complete | 2025-12-20 |
| Phase 5: Frontend Cleanup | ✅ Complete | 2025-12-20 |
| Phase 6: UAT Validation | ⚠️ Workaround | Manual inserts (trigger broken) |
| Phase 7: Fix process_rbac_event | ✅ Complete | 2025-12-20 |
| Phase 8: Fix process_rbac_event | ✅ Complete | 2025-12-20 |
| Phase 9: Database-Driven Templates | ✅ Complete | 2025-12-20 |

**BUG FIXED** (2025-12-20): The `process_rbac_event()` trigger was failing due to schema drift - production `audit_log` was missing `event_name` and `event_description` columns. Fixed by adding columns via migration `002-add-missing-columns.sql`. All 11 previously failed events now processed successfully.

**ROLE SCOPING FIXED** (2025-12-20): Invalid seed events with NULL organization_id for non-super_admin roles. Fixed by:
1. Creating `role_permission_templates` table for database-driven templates
2. Seeding 27 templates across 4 role types
3. Updating Temporal activity to query templates + add `organization_id` and `org_hierarchy_scope` to role.created events
4. Removing invalid global role seeds from `002-bootstrap-org-roles.sql`
5. Deleting 3 invalid events from `domain_events`

## Executive Summary

The "Organization Units" navigation item is not visible for `provider_admin` users in production UAT. Root cause analysis revealed two critical issues:

1. **Missing Permission**: The `organization.view_ou` permission doesn't exist in the database (only 32 of expected ~50 permissions are seeded)
2. **No Permission Grants**: The Temporal bootstrap workflow creates `provider_admin` roles but grants ZERO permissions to them (`role_permissions_projection` is empty for all 9 provider_admin roles)

This implementation will fix the immediate issue, implement proper permission granting in the bootstrap workflow, and create permanent documentation to memorialize the canonical permission set.

## Phase 1: Documentation - Canonical Permissions Reference ✅ COMPLETE

Create a single source of truth document for all permissions and role assignments.

### 1.1 Create Permissions Reference Document ✅
- Created `documentation/architecture/authorization/permissions-reference.md`
- Defined ALL 34 permissions (7 global + 27 org-scoped)
- Mapped permissions to canonical roles (super_admin: all, provider_admin: 16)
- Documented permission naming conventions (`resource.action` format)

### 1.2 Audit Frontend vs Database Permissions ✅
- Found frontend had 73 permissions vs 32 in database
- Resolved by aligning frontend to database (reduced to 28 permissions)
- Renamed permissions to match database (`org_client.create` → `client.create`)

## Phase 2: Database Fixes - Add Missing Permissions ✅ COMPLETE

### 2.1 Create Permission Seeding SQL ✅
- Created `infrastructure/supabase/sql/99-seeds/010-add-ou-permissions.sql`
- Added `organization.view_ou` and `organization.create_ou` via `permission.defined` events
- Ensured idempotency with IF NOT EXISTS pattern

### 2.2 Execute Permission Seeding ⏸️ PENDING USER ACTION
- Run SQL in Supabase Studio
- Verify permissions appear in `permissions_projection`

## Phase 3: Database Fixes - Grant Permissions to Existing Roles ✅ COMPLETE

### 3.1 Create Permission Grant SQL ✅
- Created `infrastructure/supabase/sql/99-seeds/011-grant-provider-admin-permissions.sql`
- Grants 16 canonical permissions to all existing `provider_admin` roles
- Uses `role.permission.granted` events for audit trail
- Idempotent - checks before granting

### 3.2 Execute Permission Grants ⏸️ PENDING USER ACTION
- Run SQL in Supabase Studio
- Verify `role_permissions_projection` populated
- Test user JWT contains permissions array

## Phase 4: Temporal Workflow - Permission Granting Activity ✅ COMPLETE

### 4.1 Create New Activity ✅
- Created `workflows/src/activities/organization-bootstrap/grant-provider-admin-permissions.ts`
- Activity emits `role.permission.granted` events
- Defined `PROVIDER_ADMIN_PERMISSIONS` constant with 16 permissions

### 4.2 Update Bootstrap Workflow ✅
- Added Step 1.5 to grant permissions after organization creation
- Calls `grantProviderAdminPermissions({ orgId })` activity
- Logging added for permission grant results

### 4.3 Export and Wire Up ✅
- Updated `workflows/src/activities/organization-bootstrap/index.ts`
- Added types to `workflows/src/shared/types/index.ts`
- Activity registered via existing worker activity proxy

## Phase 5: Frontend Cleanup ✅ COMPLETE (Added)

### 5.1 Remove partner_onboarder Role ✅
- Removed from `frontend/src/types/auth.types.ts`
- Removed from `frontend/src/config/roles.config.ts`
- Removed from `frontend/src/components/layouts/MainLayout.tsx`

### 5.2 Align Permissions to Database ✅
- Reduced permissions from 73 to 28 in `permissions.config.ts`
- Renamed `org_client.*` → `client.*`, `medication.read` → `medication.view`
- Updated `dev-auth.config.ts` DEV_PERMISSIONS

## Phase 6: Testing and Validation ⚠️ WORKAROUND APPLIED

### 6.1 Validate Immediate Fix
- [x] Permissions exist in `permissions_projection` (manual insert)
- [x] `role_permissions_projection` has 144 grants (9 roles × 16 permissions)
- [ ] User johnltice@yahoo.com can see "Organization Units" nav (USER TO VERIFY)
- [ ] JWT contains `organization.view_ou` permission
- [ ] No regressions in other nav items

**Note**: Event-sourced SQL scripts failed due to trigger bug. Manual inserts applied as workaround.

### 6.2 Test New Organization Bootstrap
- [ ] BLOCKED: Requires Phase 7 trigger fix first
- [ ] Create test organization via workflow
- [ ] Verify provider_admin gets all 16 permissions
- [ ] Verify nav items display correctly

## Phase 7: Fix process_rbac_event Trigger ⏸️ PENDING (CRITICAL)

### 7.1 Root Cause Analysis ✅
The `process_rbac_event()` function in `004-process-rbac-events.sql` has a schema mismatch:
- **Function expects**: `audit_log.event_name`, `audit_log.event_description`
- **Table has**: `audit_log.event_type`, `audit_log.event_category`, `audit_log.operation`, etc.

### 7.2 Implementation Plan
1. Audit the audit_log table to understand correct column mappings
2. Fix `process_rbac_event()` function in source file:
   - **File**: `infrastructure/supabase/sql/03-functions/event-processing/004-process-rbac-events.sql`
   - Remove `event_name` column (line 195)
   - Remove `event_description` column (line 196)
   - Add `operation` column instead (map to `p_event.event_type`)
   - Move reason to `metadata` JSONB field
3. **CRITICAL**: Sync fix to consolidated schema:
   - **File**: `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql`
   - Find `process_rbac_event` function (~line 6072)
   - Apply identical fix
4. Deploy fixed function to Supabase via MCP or psql
5. Re-process failed events in `domain_events` table

### 7.3 Files to Modify
| File | Purpose |
|------|---------|
| `infrastructure/supabase/sql/03-functions/event-processing/004-process-rbac-events.sql` | Source migration file |
| `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql` | Must stay in sync with source |

### 7.4 Verification
- [ ] Function deploys without error
- [ ] Re-process existing failed events in `domain_events` (where `processed_at IS NULL`)
- [ ] Verify Temporal activity successfully grants permissions for new orgs
- [ ] Confirm audit trail is complete

## Success Metrics

### Immediate (Pending SQL execution)
- [ ] `organization.view_ou` exists in `permissions_projection`
- [ ] Existing `provider_admin` roles have 16 permissions in `role_permissions_projection`
- [ ] User johnltice@yahoo.com sees "Organization Units" nav item

### Medium-Term ✅ COMPLETE
- [x] New organizations get permissions via bootstrap workflow (activity implemented)
- [x] Canonical permissions documented in `permissions-reference.md`
- [x] Frontend/database permission names aligned

### Long-Term
- [ ] Remove implicit grant from `user_has_permission()` SQL function
- [ ] All permission changes go through event-sourced workflow
- [ ] Audit trail for all permission grants

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| SQL syntax errors | Test in staging first (if available) |
| Permission name mismatches | Document mapping in reference doc |
| Breaking existing users | Additive changes only, no revocations |
| Bootstrap workflow failures | Implement compensation/rollback |

## Next Steps After Completion

1. Remove implicit grant logic from `user_has_permission()` SQL function
2. Implement permission management UI for custom roles
3. Add permission audit log viewer
4. Consider permission versioning for schema evolution
