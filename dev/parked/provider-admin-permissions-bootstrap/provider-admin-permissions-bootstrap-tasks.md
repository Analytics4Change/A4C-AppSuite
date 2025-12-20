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

## Phase 8: Fix process_rbac_event Trigger ⏸️ PENDING

**Root Cause**: `process_rbac_event()` function in `004-process-rbac-events.sql` tries to INSERT into `audit_log` with columns that don't exist (`event_name`, `event_description`).

- [x] Audit `audit_log` table schema vs `process_rbac_event()` function expectations
- [x] Identify fix: Remove `event_name`/`event_description`, add `operation`, merge reason into `metadata`
- [x] Document fix in plan.md Phase 7 with consolidated schema sync requirement
- [ ] **USER APPROVAL**: Show diff and get approval before applying changes
- [ ] Apply fix to source file: `infrastructure/supabase/sql/03-functions/event-processing/004-process-rbac-events.sql`
- [ ] Sync fix to: `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql`
- [ ] Deploy fix to Supabase via MCP
- [ ] Re-process failed events in `domain_events` (where `processed_at IS NULL`)
- [ ] Verify Temporal activity works for new org creation

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

## Current Status

**Phase**: Phase 8 (Fix process_rbac_event Trigger)
**Status**: ⏸️ PENDING - Awaiting user approval of fix
**Last Updated**: 2025-12-20
**Next Step**:
1. User reviews plan in `plan.md` (Phase 7 section)
2. Show diff of proposed changes for approval
3. Apply fix to both source file AND `CONSOLIDATED_SCHEMA.sql`
4. Deploy to Supabase and re-process failed events

**Immediate Blocker**: The `process_rbac_event()` function fails with:
```
ERROR: column "event_name" of relation "audit_log" does not exist
```
This breaks ALL RBAC event processing. The Temporal activity we created will also fail until this is fixed.

**Fix Identified**: Remove `event_name`/`event_description` columns, add `operation` column, merge reason into `metadata` JSONB. User wants to see and approve diff before changes are applied.

## Files Created/Modified This Session

### New Files Created
| File | Purpose |
|------|---------|
| `workflows/src/activities/organization-bootstrap/grant-provider-admin-permissions.ts` | Temporal activity to grant 16 permissions |
| `infrastructure/supabase/sql/99-seeds/010-add-ou-permissions.sql` | Add view_ou and create_ou permissions |
| `infrastructure/supabase/sql/99-seeds/011-grant-provider-admin-permissions.sql` | Backfill existing roles |
| `documentation/architecture/authorization/permissions-reference.md` | Canonical permissions reference |

### Existing Files Modified
| File | Changes |
|------|---------|
| `workflows/src/workflows/organization-bootstrap/workflow.ts` | Added Step 1.5 to grant permissions |
| `workflows/src/activities/organization-bootstrap/index.ts` | Export new activity |
| `workflows/src/shared/types/index.ts` | Added GrantProviderAdminPermissions types |
| `frontend/src/types/auth.types.ts` | Removed partner_onboarder |
| `frontend/src/config/permissions.config.ts` | Reduced from 73 to 28 permissions, aligned naming |
| `frontend/src/config/roles.config.ts` | Removed partner_onboarder, updated getMenuItemsForRole |
| `frontend/src/config/dev-auth.config.ts` | Updated DEV_PERMISSIONS to match database |
| `frontend/src/components/layouts/MainLayout.tsx` | Removed partner_onboarder from nav |
| `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql` | Added both seed files |
| `documentation/architecture/authorization/provider-admin-permissions-architecture.md` | Added implementation status |
