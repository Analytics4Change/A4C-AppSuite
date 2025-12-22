# Context: Organization Units Event Pattern Refactor

## Decision Record

**Date**: 2025-12-22
**Feature**: Refactor organization-units RPC functions to follow event-driven pattern
**Goal**: Align OU CRUD operations with established CQRS pattern where events are the source of truth and projections are derived from events.
**Implementation Status**: ✅ COMPLETE (All Steps 0-10)
**Completion Date**: 2025-12-22

### Key Decisions

1. **Event-First Pattern**: All mutations must emit events BEFORE projections are updated. The trigger `process_domain_event()` handles routing to the event processor which updates the projection.

2. **Separate Projection Table (Decision 2025-12-22)**: Create dedicated `organization_units_projection` table separate from `organizations_projection`:
   - **Rationale**: Different access patterns by actor type
   - Platform owners query `organizations_projection` (top-level orgs only)
   - Providers query `organization_units_projection` (their internal hierarchy)
   - Optimizes queries and simplifies RLS per table

3. **Full Paths, Not Relative (Option A - Decision 2025-12-22)**: Use full ltree paths in the new table:
   - Path example: `root.org_acme.north_campus.pediatrics`
   - Preserves native ltree containment: `scope_path @> path`
   - JWT `scope_path` claim unchanged
   - Single source of truth (path IS the scope)
   - Rejected Option B (relative paths + org_id FK) as it adds complexity without benefit

4. **New Event Types**: Use `organization_unit.*` events instead of `organization.*`:
   - `organization_unit.created`, `organization_unit.updated`, `organization_unit.deactivated`
   - New `stream_type = 'organization_unit'` for routing
   - Requires new event processor function

5. **No Depth Limit (Confirmed 2025-12-22)**: Documentation incorrectly stated "Maximum depth: 3 levels"
   - Code has NO depth enforcement - ltree supports unlimited nesting
   - Only distinction: `nlevel = 2` (root org) vs `nlevel > 2` (sub-org/OU)
   - Documentation fix required in `tenants-as-organizations.md`

6. **Preserve API Contract**: The RPC function signatures and return shapes must remain identical to avoid frontend changes.

7. **Idempotency**: Event processor should use `ON CONFLICT` clauses for idempotent handling if events are replayed.

8. **Validation Location**: Pre-mutation validation (child count, role check for deactivation) stays in RPC function, not moved to event processor.

9. **No FK from Roles to OUs (Decision 2025-12-22)**: Do NOT add `organization_unit_id` column to `roles_projection` or `user_roles_projection`:
   - **Rationale**: `scope_path` can reference either `organizations_projection` (nlevel=2) or `organization_units_projection` (nlevel>2) - cannot FK to two tables
   - PostgreSQL requires FK target to be UNIQUE or PRIMARY KEY
   - Adding `organization_unit_id` would be redundant with `scope_path`, creating sync burden
   - Integrity enforced via RPC validation (check path exists before role assignment)

10. **Deactivation Cascade via RPC Validation (Decision 2025-12-22)**: When an OU is deactivated, role assignments to all descendant OUs are also frozen.
    - **Enforcement**: RPC validation checks for inactive ancestors:
      ```sql
      SELECT EXISTS (
        SELECT 1 FROM organization_units_projection
        WHERE path @> p_target_scope_path AND is_active = false
      ) INTO v_has_inactive_ancestor;
      ```
    - Safety-net trigger recommended on `user_roles_projection` INSERT (defense-in-depth)

11. **Six Event Types (Expanded 2025-12-22)**: Use 6 distinct event types for complete lifecycle:
    | Event Type | Description |
    |------------|-------------|
    | `organization_unit.created` | New OU created |
    | `organization_unit.updated` | OU metadata changed (name, display_name, timezone) |
    | `organization_unit.deactivated` | OU frozen (is_active=false, roles frozen) |
    | `organization_unit.reactivated` | OU unfrozen (is_active=true) |
    | `organization_unit.deleted` | OU soft-deleted (deleted_at set, requires zero role refs) |
    | `organization_unit.moved` | OU reparented (future capability) |

12. **ltree Character Constraints (Research 2025-12-22)**: Slug pattern depends on PostgreSQL version:
    - **PostgreSQL 15 and earlier**: Only `A-Za-z0-9_` allowed in ltree labels
    - **PostgreSQL 16+**: Hyphens allowed `A-Za-z0-9_-`
    - **Decision**: Keep constraint as `^[a-z0-9_]+$` for maximum compatibility (Supabase may be PG15)
    - Current code already replaces non-alphanumeric with underscores

13. **Additional Schema Constraints (Recommendation 2025-12-22)**: Add these constraints to `organization_units_projection`:
    - `CONSTRAINT valid_slug CHECK (slug ~ '^[a-z0-9_]+$')` - Ensure ltree-safe
    - `CONSTRAINT path_ends_with_slug CHECK (subpath(path, nlevel(path) - 1, 1)::TEXT = slug)` - Path integrity
    - `CONSTRAINT valid_parent_path CHECK (parent_path IS NOT NULL AND path <@ parent_path AND nlevel(path) = nlevel(parent_path) + 1)` - Direct parent

14. **Migration Strategy Required (Gap Identified 2025-12-22)**: Must migrate existing sub-orgs from `organizations_projection`:
    - Copy rows where `nlevel(path) > 2` to new table
    - Verify migration before deleting from old table
    - See Step 6 in tasks.md

15. **Event Metadata Requirement**: All events MUST include `event_metadata.reason` with minimum 10 characters per EVENT-DRIVEN-ARCHITECTURE.md standard.

16. **Separate Deactivation from Deletion (Implementation 2025-12-22)**: Split single deactivate operation into:
    - `deactivate_organization_unit()` - Freeze: sets is_active=false, roles frozen but OU visible
    - `reactivate_organization_unit()` - Unfreeze: sets is_active=true, roles can be assigned
    - `delete_organization_unit()` - Soft delete: sets deleted_at, OU hidden, requires zero role refs
    - **Why**: Deactivation is reversible, deletion is not. Different semantics require different operations.

17. **Frontend Service DID Require Updates (Implementation 2025-12-22)**: Contrary to initial expectation:
    - `updateUnit()` had `p_is_active` parameter that was removed (use deactivate/reactivate instead)
    - New methods needed: `reactivateUnit()`, `deleteUnit()`
    - New error codes: `ALREADY_ACTIVE`, `ALREADY_INACTIVE`
    - Interface, service, mock, and types all updated

## Technical Context

### Architecture

The A4C-AppSuite uses a CQRS (Command Query Responsibility Segregation) pattern with event sourcing:

```
┌─────────────┐     ┌───────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│ RPC Function│────▶│ domain_events │────▶│ process_domain_event│────▶│ organization_units_ │
│ (Command)   │     │ (Event Store) │     │ (Trigger/Router)    │     │ projection (Read)   │
└─────────────┘     └───────────────┘     └─────────────────────┘     └─────────────────────┘
```

**OLD (Broken) Pattern in OU RPC**:
```
RPC Function ──▶ organizations_projection (DIRECT) ──▶ domain_events (afterthought)
                        │
                        └──▶ TRIGGER FIRES ──▶ DUPLICATE KEY ERROR!
```

**NEW (Correct) Pattern (Implemented 2025-12-22)**:
```
RPC Function ──▶ domain_events ──▶ TRIGGER ──▶ process_organization_unit_event() ──▶ organization_units_projection
```

### Tech Stack

- **Database**: PostgreSQL via Supabase
- **Event Store**: `domain_events` table with stream_id, stream_type, event_type, event_data
- **Event Router**: `process_domain_event()` trigger function
- **Event Processors**: `process_organization_event()`, `process_rbac_event()`, `process_organization_unit_event()` (NEW)
- **Projections**: `*_projection` tables (read models)
- **RPC Schema**: `api` schema exposed via PostgREST
- **ltree**: PostgreSQL extension for hierarchical paths

### Dependencies

- `get_current_scope_path()` - Extracts user's scope from JWT claims
- `get_current_user_id()` - Extracts user ID from JWT
- `safe_jsonb_extract_*()` - Helper functions for event data extraction
- `organizations_projection` - Parent org reference (FK target)
- `organization_units_projection` - New target projection table for OUs
- `domain_events` - Event store table

### New Table Schema (Implemented)

```sql
CREATE TABLE organization_units_projection (
  id UUID PRIMARY KEY,
  organization_id UUID REFERENCES organizations_projection(id) NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT,
  slug TEXT NOT NULL,

  -- Full ltree paths (preserves scope_path containment)
  path LTREE NOT NULL UNIQUE,              -- 'root.org_acme.north_campus.pediatrics'
  parent_path LTREE,                        -- 'root.org_acme.north_campus'
  depth INTEGER GENERATED ALWAYS AS (nlevel(path)) STORED,

  timezone TEXT DEFAULT 'America/New_York',
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,

  CONSTRAINT valid_ou_depth CHECK (nlevel(path) > 2),  -- Must be sub-org
  CONSTRAINT valid_slug CHECK (slug ~ '^[a-z0-9_]+$'),
  CONSTRAINT path_ends_with_slug CHECK (subpath(path, nlevel(path) - 1, 1)::TEXT = slug),
  CONSTRAINT valid_parent_path CHECK (parent_path IS NOT NULL AND path <@ parent_path AND nlevel(path) = nlevel(parent_path) + 1)
);
```

## File Structure

### New Files Created (Implementation 2025-12-22)

- `infrastructure/supabase/sql/02-tables/organization-units/001-organization_units_projection.sql`
  - New projection table with full ltree paths
  - Indexes: GIST on path, BTREE on organization_id, parent_path
  - CHECK constraints: valid_ou_depth, valid_slug, path_ends_with_slug, valid_parent_path
  - GRANT SELECT to authenticated

- `infrastructure/supabase/sql/03-functions/event-processing/014-process-organization-unit-events.sql`
  - Event processor for `organization_unit.*` events
  - Handles: `.created`, `.updated`, `.deactivated`, `.reactivated`, `.deleted`, `.moved`
  - Uses `ON CONFLICT` for idempotency
  - Helper functions: `has_inactive_ou_ancestor()`, `get_organization_unit_by_path()`, `get_organization_unit_descendants()`, `get_organization_unit_ancestors()`

- `infrastructure/supabase/contracts/asyncapi/domains/organization-unit.yaml`
  - AsyncAPI contract for all 6 event types
  - Schema definitions for event payloads
  - Includes event_metadata requirements

- `infrastructure/supabase/sql/04-triggers/010-validate-role-scope-active.sql`
  - Safety-net trigger on `user_roles_projection` INSERT OR UPDATE OF scope_path
  - Validates no inactive ancestors in scope_path
  - Also validates scope_path doesn't point to deleted OU

- `infrastructure/supabase/sql/06-rls/006-organization-units-policies.sql`
  - RLS policies for provider access to OUs
  - Super admin full access policy
  - Scope-based SELECT, INSERT, UPDATE, DELETE policies
  - Organization admin SELECT policy via `is_org_admin()`

- `infrastructure/supabase/sql/99-seeds/migrate-sub-orgs-to-ou-projection.sql`
  - Migration script for existing sub-orgs from organizations_projection
  - Uses ON CONFLICT for idempotency (safe to re-run)
  - Verification queries
  - Cleanup section (commented out, manual step)
  - Rollback instructions

### Files Refactored (Implementation 2025-12-22)

- `infrastructure/supabase/sql/03-functions/api/005-organization-unit-crud.sql`
  - **Complete rewrite** - 840 lines changed
  - Changed all mutations to emit events (no direct projection writes)
  - Changed target table from `organizations_projection` to `organization_units_projection`
  - Changed event types: `organization.*` → `organization_unit.*`
  - Changed stream_type: `'organization'` → `'organization_unit'`
  - Removed `p_is_active` parameter from `update_organization_unit`
  - Added new functions: `reactivate_organization_unit()`, `delete_organization_unit()`
  - Read functions now query UNION of both tables (root org + sub-orgs)
  - All events include `event_metadata.reason` (10+ chars)

- `infrastructure/supabase/sql/03-functions/event-processing/001-main-event-router.sql`
  - Added CASE for `stream_type = 'organization_unit'`
  - Routes to `process_organization_unit_event(NEW)`

### Frontend Files Modified (Implementation 2025-12-22)

- `frontend/src/types/organization-unit.types.ts`
  - Removed `isActive` from `UpdateOrganizationUnitRequest`
  - Added `ReactivateOrganizationUnitRequest`
  - Added `DeleteOrganizationUnitRequest`
  - Added error codes: `ALREADY_ACTIVE`, `ALREADY_INACTIVE`

- `frontend/src/services/organization/IOrganizationUnitService.ts`
  - Added `reactivateUnit(unitId: string)` method
  - Added `deleteUnit(unitId: string)` method
  - Updated `deactivateUnit` documentation (freeze vs delete semantics)

- `frontend/src/services/organization/SupabaseOrganizationUnitService.ts`
  - Removed `p_is_active` from `updateUnit` RPC call
  - Added `reactivateUnit()` method
  - Added `deleteUnit()` method
  - Added error code mappings for new codes

- `frontend/src/services/organization/MockOrganizationUnitService.ts`
  - Same changes as Supabase service
  - Removed isActive handling from updateUnit
  - Added reactivateUnit() and deleteUnit()

- `frontend/src/viewModels/organization/OrganizationUnitFormViewModel.ts`
  - Removed `isActive` from update request object

### Documentation Fixed (Implementation 2025-12-22)

- `documentation/architecture/data/tenants-as-organizations.md`
  - Removed "Maximum depth: 3 levels" assertion
  - Added statement: "No enforced depth limit - ltree supports unlimited nesting"
  - Added example 5-level hierarchy

## Important Constraints

1. **API Contract Preservation**: Frontend expects exact response shape - do not change.

2. **Synchronous Requirement**: Frontend waits for response - cannot be async fire-and-forget.

3. **RLS Policies**: RLS policies enforce scope containment - must continue to work.

4. **Validation Order**: Deactivation validation (child count, role check) must happen BEFORE event emission to avoid compensating events.

5. **Stream Version**: Each event needs correct stream_version for ordering.

6. **Idempotency**: SQL file must remain idempotent (`DROP FUNCTION IF EXISTS` + `CREATE OR REPLACE`).

7. **Read Functions Query UNION**: Read functions must query UNION of both `organizations_projection` (root) and `organization_units_projection` (sub-orgs) to return complete hierarchy.

8. **Deactivation vs Deletion Semantics**:
   - Deactivation (freeze): OU visible, roles frozen, reversible
   - Deletion (soft delete): OU hidden, requires zero role refs, not reversible in current implementation

## Reference Materials

- `documentation/architecture/data/event-sourcing-overview.md` - CQRS architecture
- `documentation/infrastructure/guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md` - Event patterns
- `dev/archived/organization-units-implementation/` - Original OU implementation docs
- `infrastructure/supabase/contracts/asyncapi/domains/organization.yaml` - Event contracts
- `infrastructure/supabase/contracts/asyncapi/domains/organization-unit.yaml` - NEW event contracts

## Completion Summary (2025-12-22)

### Migrations Deployed ✅

All SQL migrations successfully deployed to remote Supabase:
- `organization_units_projection` table created
- Event processor (`process_organization_unit_event`) deployed
- Event router updated with `organization_unit` routing
- RLS policies deployed
- Safety-net trigger deployed
- All 8 RPC functions deployed

### Testing Completed ✅

1. **Event Processing**: All 6 event types tested (created, updated, deactivated, reactivated, deleted, moved)
2. **Safety-Net Trigger**: Verified blocks role assignment to inactive OUs
3. **Idempotency**: Verified event replay produces consistent projections
4. **No Duplicate Key Errors**: All operations tested successfully

### Remaining Work (Non-Blocking)

- Frontend integration testing (requires real provider organization)
- CONSOLIDATED_SCHEMA.sql sync (deferred - individual SQL files are authoritative)
