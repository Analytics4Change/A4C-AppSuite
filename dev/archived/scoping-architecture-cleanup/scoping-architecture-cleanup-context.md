# Context: RBAC Scoping Architecture Cleanup

## Decision Record

**Date**: 2025-12-29
**Feature**: Event Sourcing Integrity & Scoping Simplification
**Goal**: Fix data corruption in permissions, backfill missing domain events, and simplify scope_type values

### Key Decisions

1. **Regenerate All Permissions**: Delete all projection data and domain events, then regenerate from authoritative seed file. This ensures all permissions go through proper event sourcing.

2. **Keep permission.* as Global**: The `permission.grant`, `permission.revoke`, `permission.view` permissions remain `scope_type='global'` per original architectural intent. These are platform-level catalog management, distinct from `role.grant` which is org-level.

3. **Simplify scope_type Values**: Remove `facility`, `program`, `client` values - only `global` and `org` will be allowed. These unused values added complexity without benefit.

4. **Keep scope_type Column**: Despite considering removal, we keep the column for semantic clarity. Global = platform-level, Org = organization-level.

5. **Clean Up Test Data**: Remove user_roles_projection entries with fake org_id `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`.

6. **Optional Day 0 Baseline**: After verification, generate new clean baseline to consolidate migrations and remove corruption evidence.

7. **Permission Cleanup (Phase 5)**: Reduced permissions from 42 to 31 by removing unused a4c_role.*, medication.prescribe, organization.business_profile_*, organization.create_sub, role.assign, role.grant. Added medication.update and medication.delete. - Added 2025-12-29

8. **Provider Admin Backfill (Phase 6)**: Fixed template to have all 23 permissions (was missing 4). Backfilled existing provider_admin roles. For NEW databases, the Temporal workflow handles this correctly via event emission. - Added 2025-12-29

9. **emit_domain_event Fix**: Added new function overload that auto-calculates stream_version. This partially helped role creation but wasn't the root cause. - Added 2025-12-29

10. **RLS Recursion Fix (CRITICAL)**: The actual "stack depth limit exceeded" root cause was circular RLS recursion: `domain_events` RLS calls `is_super_admin()` → queries `user_roles_projection` → RLS calls `is_super_admin()` → infinite loop. Fixed by making `is_super_admin()` and `is_org_admin()` SECURITY DEFINER to bypass RLS. - Added 2025-12-29

## Technical Context

### Architecture

The RBAC system uses three scoping mechanisms that work together:

```
┌────────────────────────────────────────────────────────────────┐
│                     THREE SCOPING MECHANISMS                    │
├────────────────────────────────────────────────────────────────┤
│ 1. organization_id (Data Layer)                                │
│    - roles_projection, user_roles_projection                   │
│    - NULL = global role (super_admin only)                     │
│    - UUID = org-scoped role                                    │
├────────────────────────────────────────────────────────────────┤
│ 2. scope_type (Permission Metadata)                            │
│    - permissions_projection                                     │
│    - 'global' = platform-level (platform_owner only sees)      │
│    - 'org' = organization-level                                │
├────────────────────────────────────────────────────────────────┤
│ 3. org_type (JWT Runtime)                                      │
│    - From JWT custom claims                                     │
│    - 'platform_owner' = sees all permissions                   │
│    - 'provider'/'provider_partner' = hides global permissions  │
└────────────────────────────────────────────────────────────────┘
```

### Tech Stack

- **Database**: PostgreSQL via Supabase
- **Event Store**: `domain_events` table with trigger-based projection updates
- **Event Processor**: `process_rbac_event()` function handles permission.defined events
- **Frontend**: React/TypeScript with MobX state management
- **API Layer**: PostgreSQL functions in `api` schema

### Dependencies

- `domain_events` table and event processor triggers
- `permissions_projection` table with CHECK constraint
- `api.get_permissions()` function (filters by org_type)
- Frontend `PermissionSelector` component (groups by scope_type)
- `role.types.ts` ScopeType type definition

## File Structure

### Files Modified (Phase 5-6)

**Database Migrations (Applied 2025-12-29):**
- `infrastructure/supabase/supabase/migrations/20251229184955_permission_cleanup.sql` - Delete 13 unused, add 2 new
- `infrastructure/supabase/supabase/migrations/20251229195740_backfill_provider_admin_permissions.sql` - Backfill 23 perms to existing provider_admin
- `infrastructure/supabase/supabase/migrations/20251229201217_fix_emit_domain_event_overload.sql` - Add auto-version overload
- `infrastructure/supabase/supabase/migrations/20251229220540_stub_unused_overloads.sql` - Diagnostic stubs for function overloads (helped rule out overload ambiguity)
- `infrastructure/supabase/supabase/migrations/20251229221456_fix_rls_recursion.sql` - **THE FIX**: SECURITY DEFINER on is_super_admin/is_org_admin

**Seed File (Updated 2025-12-29):**
- `infrastructure/supabase/sql/99-seeds/001-permissions-seed.sql` - Now 31 permissions (was 42)

**Frontend (Updated 2025-12-29):**
- `frontend/src/config/permissions.config.ts` - Removed deleted permissions, added medication.update/delete
- `frontend/src/services/roles/MockRoleService.ts` - Aligned with new permission set

**Temporal Activity (Updated 2025-12-29):**
- `workflows/src/activities/organization-bootstrap/grant-provider-admin-permissions.ts` - PROVIDER_ADMIN_PERMISSIONS now 23

**Previously Modified (Phase 1-3):**
- `infrastructure/supabase/supabase/migrations/20251229082721_regenerate_permissions.sql`
- `infrastructure/supabase/supabase/migrations/20251229083038_backfill_orphaned_events.sql`
- `infrastructure/supabase/supabase/migrations/20251229153821_simplify_scope_type_constraint.sql`
- `frontend/src/types/role.types.ts` - ScopeType = 'global' | 'org'
- `documentation/architecture/authorization/scoping-architecture.md` (NEW)

### Key Existing Files

- `infrastructure/supabase/supabase/migrations/20240101000000_baseline.sql` - Original Day 0 baseline (captured corrupted state)
- `infrastructure/supabase/supabase/migrations/20251228130000_filter_permissions_by_org_type.sql` - Permission filtering logic
- `frontend/src/components/roles/PermissionSelector.tsx` - Groups permissions by scope_type

## Data Corruption Details

### Orphaned Projections Found

| Table | Total | Orphaned | Root Cause |
|-------|-------|----------|------------|
| permissions_projection | 42 | 19 | Day 0 baseline pg_dump captured projection state |
| user_roles_projection | 6 | 6 | Direct inserts, missing events |
| invitations_projection | 2 | 2 | Recent invitations without events |
| users | 5 | 5 | No user.registered events |

### role.create Bug

| Source | ID | scope_type |
|--------|-----|------------|
| Domain Event | `ce09ad3c-ec01-4916-baf1-5ceda308d64c` | **org** |
| Projection | `9b0a74b0-1767-4d31-b0fe-b8792a4bc876` | **global** |

IDs don't match - projection was directly inserted from pg_dump, not derived from event.

## Correct Permission Scope Types (After Phase 5)

### Global Scope (10 permissions)
- organization.activate, create, create_root, deactivate, delete, search, suspend
- permission.grant, revoke, view

### Org Scope (21 permissions) - Updated 2025-12-29
- client.create, view, update, delete (4)
- medication.create, view, update, delete, administer (5)
- organization.view, update, view_ou, create_ou (4)
- role.create, view, update, delete (4)
- user.create, view, update, delete, role_assign, role_revoke (6)

**Deleted (Phase 5):**
- a4c_role.* (5) - not used in codebase
- medication.prescribe - not needed
- organization.business_profile_create, business_profile_update, create_sub (3) - redundant
- role.assign, role.grant (2) - use user.role_assign/revoke instead

**Added (Phase 5):**
- medication.update, medication.delete (2)

## Important Constraints

1. **Event Processor Must Handle permission.defined**: The `process_rbac_event()` function must INSERT into `permissions_projection` when receiving `permission.defined` events.

2. **ON CONFLICT DO NOTHING**: All projection inserts use this pattern for idempotency.

3. **CASCADE on TRUNCATE**: When truncating `permissions_projection`, it will cascade to `role_permissions_projection`.

4. **scope_type CHECK Constraint**: Must be updated AFTER all permissions have correct values.

5. **emit_domain_event Overloads**: Three overloads exist with different signatures. When calling from RPC functions like `api.create_role`, use the 5-parameter version (auto-calculates stream_version). - Added 2025-12-29

6. **role_permission_templates vs Temporal activity**: The template table is the source of truth for NEW organizations. The `PROVIDER_ADMIN_PERMISSIONS` constant in Temporal is for documentation only - the activity reads from the database. Both must stay in sync. - Added 2025-12-29

7. **AsyncAPI Contract Compliance**: The backfill migration directly inserts into projections without emitting events. This is acceptable for one-time fixes. For NEW databases, the Temporal workflow emits proper `role.permission.granted` events which is contract-compliant. - Added 2025-12-29

8. **SECURITY DEFINER for Permission Check Functions**: Functions that check permissions (`is_super_admin`, `is_org_admin`) MUST be SECURITY DEFINER to avoid circular RLS recursion. They query projection tables that have RLS policies that call these same functions. - Added 2025-12-29

9. **PostgreSQL Function Overload Resolution**: When PostgreSQL has multiple function overloads, the one with DEFAULT values will be preferred if fewer arguments are passed. Stubbing unused overloads with diagnostic exceptions is an effective debugging technique. - Added 2025-12-29

## Why This Approach?

**Why regenerate all 42 instead of just fixing 19?**
- Ensures single source of truth (seed file)
- Guarantees all projection IDs match event stream_ids
- Clean slate approach is more reliable than surgical fixes

**Why keep scope_type instead of removing it?**
- Provides semantic clarity for UI grouping
- Non-breaking change (vs. adding organization_id to permissions)
- Future-proof if we need more granular scopes later

**Why optional Day 0 baseline?**
- Consolidates ~15 migrations into clean baseline
- Removes evidence of data corruption from history
- But only AFTER verification to avoid capturing still-incorrect state
