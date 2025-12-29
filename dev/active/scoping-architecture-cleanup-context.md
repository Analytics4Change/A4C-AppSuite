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

### Files to Modify

**Database Migrations:**
- `infrastructure/supabase/sql/99-seeds/001-permissions-seed.sql` (NEW) - Authoritative 42 permissions
- `infrastructure/supabase/supabase/migrations/YYYYMMDDHHMMSS_regenerate_permissions.sql` (NEW)
- `infrastructure/supabase/supabase/migrations/YYYYMMDDHHMMSS_backfill_orphaned_events.sql` (NEW)
- `infrastructure/supabase/supabase/migrations/YYYYMMDDHHMMSS_simplify_scope_type.sql` (NEW)
- `infrastructure/supabase/supabase/migrations/YYYYMMDDHHMMSS_cleanup_test_data.sql` (NEW)

**Frontend:**
- `frontend/src/types/role.types.ts` - Simplify ScopeType to 'global' | 'org'

**Documentation:**
- `documentation/architecture/authorization/scoping-architecture.md` (NEW)
- `documentation/infrastructure/reference/database/tables/permissions_projection.md` (UPDATE)
- `documentation/architecture/authorization/rbac-architecture.md` (UPDATE)

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

## Correct Permission Scope Types

### Global Scope (10 permissions)
- organization.activate, create, create_root, deactivate, delete, search, suspend
- permission.grant, revoke, view

### Org Scope (32 permissions)
- a4c_role.* (5)
- client.* (4)
- medication.* (4)
- organization.business_profile_create/update, create_ou, create_sub, update, view, view_ou (7)
- role.create, assign, delete, grant, update, view (6)
- user.* (6)

## Important Constraints

1. **Event Processor Must Handle permission.defined**: The `process_rbac_event()` function must INSERT into `permissions_projection` when receiving `permission.defined` events.

2. **ON CONFLICT DO NOTHING**: All projection inserts use this pattern for idempotency.

3. **CASCADE on TRUNCATE**: When truncating `permissions_projection`, it will cascade to `role_permissions_projection`.

4. **scope_type CHECK Constraint**: Must be updated AFTER all permissions have correct values.

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
