# Implementation Plan: Organization Units Event Pattern Refactor

## Executive Summary

The organization-units RPC functions (`infrastructure/supabase/sql/03-functions/api/005-organization-unit-crud.sql`) violate the established CQRS/event-driven pattern by:
1. Directly INSERT/UPDATE into `organizations_projection`
2. Then emitting events as an afterthought
3. Causing duplicate key errors when the event processor trigger fires

This refactor will:
1. Create a dedicated `organization_units_projection` table (separate from `organizations_projection`)
2. Introduce new `organization_unit.*` event types with dedicated event processor
3. Align OU operations with the event-first pattern: **emit event → trigger fires → event processor updates projection**

Additionally, documentation incorrectly states a "Maximum depth: 3 levels" constraint that does not exist in code.

## Architectural Decision: Separate Table with Full Paths

### Rationale
- **Platform owners** query `organizations_projection` (top-level orgs, depth=2)
- **Providers** query `organization_units_projection` (their internal hierarchy, depth>2)
- Different access patterns → different tables → optimized queries and simpler RLS

### Design: Full ltree Paths (Option A)

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

  CONSTRAINT valid_ou_depth CHECK (nlevel(path) > 2)  -- Must be sub-org
);
```

### Why Full Paths (Not Relative)
1. **ltree containment works natively**: `scope_path @> path` — no reconstruction needed
2. **Single source of truth**: Path IS the scope, not derived from FK + relative path
3. **JWT unchanged**: Existing `scope_path` claim works identically
4. **Simpler RLS**: Same `get_current_scope_path() @> path` pattern

## Implementation Steps

### Step 0: Fix Documentation (Quick Win)
1. Edit `documentation/architecture/data/tenants-as-organizations.md`
2. Remove "Maximum depth: 3 levels" assertion at line 73
3. Replace with accurate statement: "No enforced depth limit - ltree supports unlimited nesting"
4. Add diverse hierarchy examples

### Step 1: Create `organization_units_projection` Table
1. Create `infrastructure/supabase/sql/02-tables/organization-units/001-organization_units_projection.sql`
2. Define table with full ltree paths (schema above)
3. Add indexes: GIST on path, BTREE on organization_id, parent_path
4. Add CHECK constraint: `nlevel(path) > 2`

### Step 2: Create Event Processor for OUs
1. Create `infrastructure/supabase/sql/03-functions/event-processing/014-process-organization-unit-events.sql`
2. Handle `organization_unit.created` → INSERT into `organization_units_projection`
3. Handle `organization_unit.updated` → UPDATE `organization_units_projection`
4. Handle `organization_unit.deactivated` → Soft delete (set is_active, deleted_at)
5. Add `ON CONFLICT` for idempotency

### Step 3: Update Event Router
1. Edit `001-main-event-router.sql`
2. Add case for `stream_type = 'organization_unit'`
3. Route to `process_organization_unit_event(NEW)`

### Step 4: Create RLS Policies
1. Create `infrastructure/supabase/sql/06-rls/005-organization-units-policies.sql`
2. SELECT: `get_current_scope_path() @> path`
3. INSERT: `get_current_scope_path() @> path AND nlevel(path) > 2`
4. UPDATE: Same scope containment
5. DELETE: Same scope containment (soft delete via UPDATE)

### Step 5: Refactor RPC Functions
1. Edit `005-organization-unit-crud.sql`
2. Change all queries from `organizations_projection` to `organization_units_projection`
3. Change event types: `organization.created` → `organization_unit.created`, etc.
4. Change stream_type: `'organization'` → `'organization_unit'`
5. Remove direct INSERT/UPDATE, emit events instead
6. Query projection after event for synchronous response

### Step 6: Update Frontend Service (if needed)
1. Review `frontend/src/services/organization/SupabaseOrganizationUnitService.ts`
2. Verify RPC calls still work (API contract unchanged)
3. No changes expected if JSONB response shape preserved

### Step 7: Test
1. Local Supabase: run migrations
2. Create/update/deactivate OUs via RPC
3. Verify events in `domain_events` with `stream_type = 'organization_unit'`
4. Verify `organization_units_projection` populated correctly
5. Verify RLS: provider can only see their OUs
6. Frontend integration test

## Files Summary

### New Files to Create
- `infrastructure/supabase/sql/02-tables/organization-units/001-organization_units_projection.sql`
- `infrastructure/supabase/sql/03-functions/event-processing/014-process-organization-unit-events.sql`
- `infrastructure/supabase/sql/06-rls/005-organization-units-policies.sql`

### Files to Refactor
- `infrastructure/supabase/sql/03-functions/api/005-organization-unit-crud.sql`
- `infrastructure/supabase/sql/03-functions/event-processing/001-main-event-router.sql`

### Documentation to Fix
- `documentation/architecture/data/tenants-as-organizations.md:73`

## Success Criteria

- [ ] `organization_units_projection` table created with full ltree paths
- [ ] Event processor handles `organization_unit.*` events
- [ ] Event router routes `stream_type = 'organization_unit'` correctly
- [ ] RLS policies enforce scope containment for providers
- [ ] RPC functions emit events (no direct projection writes)
- [ ] No duplicate key errors on create/update/deactivate
- [ ] Frontend operations work unchanged (API contract preserved)
- [ ] Event replay produces consistent projections
- [ ] Documentation corrected (no false depth limit)

## Constraints

- **Preserve API contract**: Same JSONB response shape for frontend compatibility
- **Synchronous response**: Frontend expects immediate response
- **Keep validation in RPC**: Deactivation checks stay in RPC (before event emission)
- **Idempotent SQL**: Files must use DROP + CREATE pattern

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking frontend integration | Preserve exact API response shape |
| Event processor missing OU handling | Create dedicated processor with full test coverage |
| Synchronous response timing | Use direct processor call if trigger timing insufficient |
| Migration complexity | Single SQL file per concern, all idempotent |

## Next Steps After Completion

1. Deploy refactored SQL to development environment
2. Run integration tests with frontend
3. Update documentation to mark OU feature as production-ready
4. Consider similar audit of other RPC functions for pattern compliance
