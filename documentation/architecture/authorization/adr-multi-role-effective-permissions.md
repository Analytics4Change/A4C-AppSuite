---
status: current
last_updated: 2026-02-19
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: ADR for selecting RBAC with Effective Permissions over ReBAC (SpiceDB/Auth0 FGA) for multi-role authorization. Introduces Capability (RLS) vs Accountability (Temporal) separation, `effective_permissions` JWT array with 4-step deduplication algorithm, and `has_effective_permission()` RLS helper. Implemented across 15 migrations and 7 phases (2026-01-22 to 2026-02-02).

**When to read**:
- Understanding why RBAC + Effective Permissions was chosen over ReBAC
- Reviewing the Capability vs Accountability architectural separation
- Debugging effective permissions computation or JWT claims
- Evaluating whether to revisit the ReBAC decision

**Prerequisites**: [rbac-architecture](./rbac-architecture.md), [scoping-architecture](./scoping-architecture.md)

**Key topics**: `adr`, `multi-role`, `effective-permissions`, `rbac`, `rebac`, `capability-accountability`, `jwt-claims`, `architecture-decision`

**Estimated read time**: 20 minutes
<!-- TL;DR-END -->

# ADR: Multi-Role Authorization with Effective Permissions

**Date**: 2026-01-22 (decision), implemented through 2026-02-02
**Status**: Implemented
**Deciders**: Lars (architect), Claude (implementation)

## Context

### The Problem

A4C-AppSuite serves residential and institutional programs for at-risk youth. Line staff work shift-based at specific facilities (Organization Units), may be assigned to specific clients, and collect behavioral data (medication administration, incidents, sleep, activities). Staff routinely hold multiple roles at different organizational scopes:

- `clinician` at `acme.pediatrics` with `clients.view`
- `medication_manager` at `acme` (org root) with `medications.admin`

The existing single-role JWT architecture (`claims_version: 2`) stored one `user_role`, one `scope_path`, and a flat `permissions` array. This lost scope binding — `medications.admin` existed in the JWT but its scope (`acme`) was discarded in favor of the "primary" role's scope (`acme.pediatrics`). RLS checks failed for resources outside the primary scope.

### Domain Requirements

1. Staff need 4-10 roles with different scopes simultaneously
2. Permissions must be enforced at the database level via RLS (not application-level)
3. JWT size must stay under 8KB (Supabase limit)
4. Assignment tables (schedule, client mapping) must support Temporal workflow routing for accountability
5. Organization isolation (multi-tenancy) must be maintained
6. Backward compatibility during migration

## Decision

**Selected: RBAC with Effective Permissions (Option A)**

Enhance the existing RBAC system with:
1. An `effective_permissions` JWT array containing deduplicated `[{p, s}]` pairs
2. A `permission_implications` table for derived permissions (e.g., `delete` implies `view`)
3. A `has_effective_permission(permission, path)` RLS helper using ltree containment
4. Separate event-sourced projection tables for Temporal workflow accountability routing

### Key Design Principle: Capability vs Accountability

Two distinct concerns that must NOT be mixed:

| Concern | Question | Mechanism | Tables |
|---------|----------|-----------|--------|
| **Capability (RLS)** | CAN this user access this data? | Permission + Scope containment | `effective_permissions` in JWT |
| **Accountability (Temporal)** | WHO should be notified/held responsible? | Schedule + Assignment queries | `user_schedule_policies_projection`, `user_client_assignments_projection` |

RLS policies check only permissions and scope. Assignment tables are queried only by Temporal workflows for notification routing. This separation is critical — client location is NOT hierarchical (a client at `UtahValley` does NOT receive services at child OUs), unlike permission scope which IS hierarchical.

### Effective Permissions Algorithm

```
Step 1: Collect all explicit grants from user's roles
        → [(clients.view, acme), (clients.view, acme.pediatrics),
           (medications.view, acme.pediatrics), (medications.admin, acme)]

Step 2: For each permission, keep only the WIDEST scope (shortest ltree path)
        → clients.view: acme (drops acme.pediatrics — it's contained)
        → medications.view: acme.pediatrics
        → medications.admin: acme

Step 3: Expand implications, inheriting the implying permission's scope
        → medications.admin at acme IMPLIES medications.view at acme
        → This is WIDER than explicit medications.view at acme.pediatrics

Step 4: Re-apply widest-scope rule after expansion
        → medications.view: acme (widened by implication)

Final: [(clients.view, acme), (medications.view, acme), (medications.admin, acme)]
```

Implemented as `compute_effective_permissions(p_user_id, p_org_id)` SQL function, called by `custom_access_token_hook` at token issuance.

### JWT Structure (claims_version 4)

```json
{
  "org_id": "uuid",
  "org_type": "provider",
  "effective_permissions": [
    { "p": "clients.view", "s": "acme" },
    { "p": "medications.admin", "s": "acme" },
    { "p": "medications.view", "s": "acme" }
  ],
  "current_org_unit_id": "uuid-or-null",
  "current_org_unit_path": "acme.pediatrics",
  "claims_version": 4
}
```

Short keys (`p`, `s`) minimize JWT size. ~200 bytes for 4 permissions vs ~500+ bytes for naive role-scope arrays.

### RLS Helper

```sql
CREATE OR REPLACE FUNCTION has_effective_permission(
  p_permission text,
  p_target_path extensions.ltree
) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      (current_setting('request.jwt.claims', true)::jsonb)->'effective_permissions'
    ) ep
    WHERE ep->>'p' = p_permission
      AND (ep->>'s')::ltree @> p_target_path
  );
$$;
```

## Implementation Summary

### Phases and Migrations

| Phase | Description | Migration(s) | Commit |
|-------|-------------|-------------|--------|
| 2 | Permission implications, effective permissions function, JWT hook v3, RLS helpers | `20260122204331` through `20260122222249` (5 migrations) | `18c5c512` |
| 3A-0 | User session OU context | `20260123001054`, `20260123001155` | `18c5c512` |
| 3A | Organization direct care settings | `20260123001246` | `18c5c512` |
| 3B | User schedule policies projection | `20260123001405` | `18c5c512` |
| 3C | User client assignments projection | `20260123001542` | `18c5c512` |
| 3-Event | Event routing for schedule/assignment events | `20260123181951` | `18c5c512` |
| 4 | RLS policy migration to `has_effective_permission()` | `20260124192733` | `18c5c512` |
| 5 | Frontend integration (auth types, hasPermission, Realtime subscription) | `20260126173806` | `427292f3` |
| 5B | Strip deprecated claims, bump to claims_version 4 | `20260126180004` | `f64901f4` |
| 5B-fix1 | Fix 3 Edge Functions + 2 RLS policies still using v3 fields (2026-02-18) | `20260218225841` | — |
| 5B-fix2 | Fix Backend API middleware (`workflows/src/api/middleware/auth.ts`) still using v3 `permissions` field + add `access_blocked` guard (2026-02-19) | — | — |
| 6 | Direct Care Settings UI (Switch, ViewModel, 29 tests) | `20260126205504` | `78c357d7` |
| 7A | Staff schedules backend RPCs + frontend UI | `20260202181252`, `20260202181537` | `8e8fa67d` |
| 7B | Client assignments UI with feature flag | — | `df681aea`, `894d9d5c` |
| 7C | Unit tests (54 tests: ScheduleEdit + AssignmentList) | — | `52801c98` |

**Total**: 15 migrations, 18 commits, deployed 2026-01-23 through 2026-02-02.

### Bug Fix Commits During Implementation

| Commit | Issue | Root Cause |
|--------|-------|------------|
| `dd1e06e2` | `type "ltree" does not exist` | Function signatures evaluate BEFORE `SET search_path`; must use `extensions.ltree` |
| `e493ca56` | Incorrect `is_active` check | `user_roles_projection` has no `is_active` column; uses temporal validity dates |
| `02d815d2` | `operator does not exist: extensions.ltree @>` | Casts inside function body need unqualified `::ltree` when search_path is set |
| `d83a3b53` | ltree operators not found | SQL functions need `SET search_path = public, extensions` |
| `a12e3b00` | `relation "users_projection" does not exist` | Table is named `users`, not `users_projection` |
| `5479f64f` | `functions in index predicate must be IMMUTABLE` | `now()` is STABLE; move time filtering to query |

## Alternatives Considered

### Option B: Full ReBAC (SpiceDB / Auth0 FGA)

**Relationship model**: `user:alice#clinician@org_unit:acme.pediatrics`

**Pros**: Natural fit for relationships, Google-scale proven (Zanzibar paper), built-in audit trail, reverse lookups ("who can access client X?")

**Rejected because**:
- Requires new infrastructure (SpiceDB cluster or Auth0 FGA subscription)
- RLS cannot call external services — would need to bypass RLS with Edge Function authorization layer
- Learning curve for Zanzibar-style schema language
- Current relationship complexity doesn't justify it
- ltree containment in PostgreSQL already provides hierarchical scope checking

**Revisit when**: Relationships become deeply nested (client → family → guardian), reverse lookups are needed, or relationships cross organizational boundaries.

### PBAC with OPA/Rego

**Rejected because**: PostgreSQL RLS cannot call external policy engines. Would require moving all authorization to application level, losing database-level enforcement.

### Permit.io (Managed Authorization)

**Rejected because**: Adds external dependency without proportional benefit. RLS at database level is stronger security than Edge Function enforcement. Single source of truth (Supabase) is simpler than syncing two authorization systems.

### Policy-as-Data (`access_policies` table)

**Initially designed, then removed** (2026-01-22): After domain clarification, RLS should be FIXED (permission + scope containment only). Admin-configurable policies are not needed — access rules are determined by the permission system. Organization-level behavior differences are handled by feature flags (`direct_care_settings`), not policy tables.

## Consequences

### Positive

- Stays within Supabase ecosystem — no new infrastructure
- RLS enforcement at database level (strongest security boundary)
- Incremental migration with backward-compatible claims versioning
- JWT size efficient (~200 bytes for typical permission set, well under 8KB)
- Permission implications reduce administrative burden (grant `delete`, `view` is automatic)
- Clean separation: RLS for capability, Temporal for accountability
- Event-sourced assignment tables provide full audit trail

### Negative

- JWT claims are static until token refresh — role changes require re-authentication or Realtime subscription (implemented in Phase 5)
- `compute_effective_permissions()` adds ~5ms to token issuance
- ltree type qualification in PostgreSQL function signatures is error-prone (6 bug fix commits)
- Permission implications are one level deep (no transitive closure) — sufficient for current needs but may need extension
- Assignment tables have no FK to clients table (client domain not yet event-driven)

### Risks Mitigated

| Risk | Mitigation |
|------|------------|
| JWT size exceeds 8KB | Effective permissions algorithm deduplicates to minimal set |
| Role changes not reflected | Realtime subscription on `user_roles_projection` triggers token refresh |
| Migration breaks existing users | `claims_version` bumped incrementally (2→3→4), deprecated fields kept then stripped |
| RLS performance | Partial indexes on `is_active = true`, ltree GiST indexes on scope paths |

## Implementation Gotchas

These issues were discovered during implementation and are documented here to prevent recurrence:

1. **ltree type in function signatures**: Use `extensions.ltree` (fully qualified) in RETURNS, parameters, COMMENT ON, GRANT — `SET search_path` does not affect signature parsing
2. **ltree operators in function bodies**: Add `SET search_path = public, extensions` to SQL functions using `@>`, `<@` operators; then use unqualified `::ltree` casts inside the body
3. **Index predicates must be IMMUTABLE**: `now()` is STABLE — include time columns in index, filter at query time
4. **Table naming**: Users table is `users`, not `users_projection`
5. **`user_roles_projection` has no `is_active`**: Use `role_valid_from`/`role_valid_until` temporal validity dates
6. **`UNIQUE NULLS NOT DISTINCT`**: Required for optional FK columns in unique constraints (PostgreSQL 15+)
7. **AsyncAPI bundler reachability**: Schemas must be referenced from channels in root `asyncapi.yaml` to be included in bundled output
8. **`hasPermission()` returns `Promise<boolean>`**: Frontend AuthContext unwraps internally — use boolean result directly, not `.granted`
9. **Function overloading**: Adding a parameter with DEFAULT creates an overload, not a replacement — acceptable for backward compatibility
10. **Day name trailing spaces**: `to_char(timestamp, 'day')` pads with spaces — must `trim()` before JSONB key lookup

## Related Documentation

- [RBAC Architecture](./rbac-architecture.md) — Role-based access control overview
- [Scoping Architecture](./scoping-architecture.md) — ltree scope hierarchy design
- [Permissions Reference](./permissions-reference.md) — Complete permission catalog
- [JWT Claims Setup](../../infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md) — Database hook configuration
- [user_schedule_policies_projection](../../infrastructure/reference/database/tables/user_schedule_policies_projection.md) — Staff schedule table
- [user_client_assignments_projection](../../infrastructure/reference/database/tables/user_client_assignments_projection.md) — Client assignment table
- [organizations_projection](../../infrastructure/reference/database/tables/organizations_projection.md) — Direct care settings feature flags
