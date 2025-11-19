# Infrastructure Bug Analysis: ltree Hierarchy Path Constraint

**Date**: 2025-01-14
**Discovered During**: Provider Onboarding Enhancement - Phase 1 migration testing
**Status**: ✅ FIXED
**Impact**: Blocking - prevented seed data from loading

---

## Executive Summary

Seed data for the platform owner organization (A4C) used an incorrect ltree path format (`'a4c'` with nlevel=1) that violated the CHECK constraint requiring all root organizations to have nlevel=2. This was fixed by changing the path to `'root.a4c'` to match the documented architecture and existing code expectations.

---

## The Bug

###Bug Details

**File**: `infrastructure/supabase/sql/99-seeds/002-bootstrap-org-roles.sql` (line 43)

**Incorrect Code**:
```sql
INSERT INTO organizations_projection (..., path, ...) VALUES
  (..., 'a4c'::LTREE, ...);  -- ❌ nlevel = 1
```

**Error**:
```
ERROR: new row for relation "organizations_projection" violates check constraint "organizations_projection_check"
DETAIL: Failing row contains (..., a4c, ...)
```

**Root Cause**: Path `'a4c'` has `nlevel(path) = 1`, but the CHECK constraint requires `nlevel(path) = 2` for root organizations.

---

## The Constraint

**Definition** (from `001-organizations_projection.sql`, lines 35-41):
```sql
CHECK (
  -- Root organizations (depth 2) can have Zitadel org
  (nlevel(path) = 2 AND parent_path IS NULL)
  OR
  -- Sub-organizations (depth > 2) must have parent
  (nlevel(path) > 2 AND parent_path IS NOT NULL)
)
```

**Purpose**:
- Enforces consistent hierarchy floor: all orgs exist at depth 2+
- Prevents orphaned depth-1 paths
- Enables reliable root org identification via `nlevel(path) = 2`

---

## Why nlevel=2 is Required

### 1. Documented Architecture

**Source**: `documentation/architecture/data/multi-tenancy-architecture.md` (lines 351-365)

```
Path Format: root.segment1.segment2.segment3...

Platform-Wide Structure:
root (Virtual Root)
├── root.org_a4c_internal (A4C Internal Organization)
├── root.org_acme_healthcare (Provider)
├── root.org_sunshine_youth (Provider - VAR Customer)
└── root.org_var_partner_xyz (Provider Partner - VAR)
```

**All root organizations use `root.*` prefix**, establishing depth 2 as the hierarchical floor.

### 2. Code Dependencies

**Validation Function** (`validate_organization_hierarchy()`, line 359):
```sql
IF nlevel(p_path) = 2 THEN
  RETURN p_parent_path IS NULL;  -- Root orgs have depth 2
END IF;
```

**Event Processor** (`process_organization_event()`, line 20):
```sql
v_depth := nlevel((p_event.event_data->>'path')::LTREE);

-- For sub-organizations, inherit parent type
IF v_depth > 2 THEN
  SELECT type INTO v_parent_type
  FROM organizations_projection WHERE path = ...;
END IF;
```

**Zitadel Reference Implementation** (`zitadel-bootstrap-reference.sql`, line 351):
```sql
-- Generate ltree path for root organization
v_ltree_path := ('root.org_' || v_slug)::LTREE;
```

All existing code **assumes root organizations have nlevel=2**.

### 3. The 'root' Prefix is Literal

The `root` prefix is **not a convention** - it's a literal ltree component that:
1. Prevents depth-1 paths (no single-segment paths allowed)
2. Establishes hierarchy floor (all legitimate orgs start at `root.*`)
3. Enables consistent querying (`nlevel(path) = 2` directly identifies root orgs)
4. Maintains ltree semantics for hierarchical path operators (`<@`, `<^`)

---

## Impact Analysis

### What Broke

**With path='a4c'** (nlevel=1):
- ❌ Violates CHECK constraint → seed INSERT fails
- ❌ `SELECT WHERE nlevel(path) = 2` won't find A4C org
- ❌ `validate_organization_hierarchy()` returns false
- ❌ Permission scoping queries fail (scope_path must follow same pattern)
- ❌ Hierarchy queries using ltree operators may not work correctly

### Code That Depends on nlevel=2

1. **Table Constraint**: `organizations_projection` CHECK constraint
2. **Validation Function**: `validate_organization_hierarchy()`
3. **Event Processor**: `process_organization_event()`
4. **Zitadel Reference**: Bootstrap organization creation logic
5. **Hierarchy Queries**: Comments in table schema show `WHERE nlevel(path) = 2` usage

---

## The Fix

**File**: `infrastructure/supabase/sql/99-seeds/002-bootstrap-org-roles.sql`

**Change** (line 43):
```sql
# BEFORE:
path = 'a4c'::LTREE,           -- nlevel = 1 ❌

# AFTER:
path = 'root.a4c'::LTREE,      -- nlevel = 2 ✅
```

**Verification**:
```sql
SELECT id, name, path, nlevel(path) as depth
FROM organizations_projection
WHERE type='platform_owner';

-- Result:
-- id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
-- name: Analytics4Change
-- path: root.a4c
-- depth: 2 ✅
```

---

## Alternatives Considered

### Option A: Relax Constraint to Allow nlevel=1 for platform_owner

**Proposed**:
```sql
CHECK (
  (nlevel(path) = 1 AND type = 'platform_owner' AND parent_path IS NULL)
  OR
  (nlevel(path) = 2 AND type IN ('provider', 'provider_partner') AND parent_path IS NULL)
  OR
  (nlevel(path) > 2 AND parent_path IS NOT NULL)
)
```

**Verdict**: ❌ **REJECTED**
- Violates hierarchical consistency
- Breaks queries that use `nlevel(path) = 2` to find root orgs
- Different rules for different org types (violates DRY)
- Makes validation functions more complex
- Contradicts documented architecture

### Option B: Fix the Seed Data

**Verdict**: ✅ **CHOSEN**
- Follows documented architecture
- Consistent with all other root orgs
- Works with existing validation functions
- Matches Zitadel reference implementation
- Minimal code change (1 line)

---

## Lessons Learned

1. **Seed Data Must Match Constraints**: Seed data should be tested against table constraints before production deployment
2. **Architecture Docs are Authoritative**: When in doubt, follow the documented architecture
3. **CHECK Constraints are Enforced**: PostgreSQL CHECK constraints prevent invalid data at INSERT time
4. **ltree Paths Need Careful Design**: Hierarchical path structures should be consistent across the system
5. **Code Review Should Check Seed Data**: Migrations should be reviewed for both schema AND data correctness

---

## Prevention Measures

### 1. Add Seed Data Validation Tests

**Recommended**:
```sql
-- Test seed data satisfies constraints BEFORE actual seed
CREATE TEMP TABLE test_org AS
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID as id,
       'Analytics4Change' as name,
       'root.a4c'::LTREE as path;

-- Verify constraint would pass
SELECT CASE
  WHEN nlevel(path) = 2 AND type = 'platform_owner' THEN 'PASS'
  ELSE 'FAIL: Path constraint violation'
END as test_result
FROM test_org;
```

### 2. Document Path Format in Seed File

**Add comment to seed file**:
```sql
-- Platform owner path MUST use 'root.*' format (nlevel=2)
-- Rationale: CHECK constraint requires nlevel(path) = 2 for root orgs
-- See: documentation/architecture/data/multi-tenancy-architecture.md
path = 'root.a4c'::LTREE,
```

### 3. Migration Testing Checklist

Before deploying migrations:
- [ ] Run migrations twice (idempotency test)
- [ ] Verify seed data loads successfully
- [ ] Query platform owner org to ensure it exists with correct path
- [ ] Test hierarchy queries (`nlevel(path) = 2`)
- [ ] Verify RLS policies work with new structure

---

## References

### Architecture Documentation
- `documentation/architecture/data/multi-tenancy-architecture.md` (lines 351-365)

### Code Files
- `infrastructure/supabase/sql/02-tables/organizations/001-organizations_projection.sql` (CHECK constraint)
- `infrastructure/supabase/sql/03-functions/event-processing/002-process-organization-events.sql` (validation function)
- `infrastructure/supabase/sql/00-reference/zitadel-bootstrap-reference.sql` (reference implementation)
- `infrastructure/supabase/sql/99-seeds/002-bootstrap-org-roles.sql` (seed data - FIXED)

### Related Issues
- None (this is the first occurrence of this bug)

---

## Status

**Fixed**: 2025-01-14
**Tested**: ✅ Migrations run successfully with corrected seed data
**Deployed**: Pending (local testing complete)
**Follow-up**: Monitor production deployment for any path-related issues
