# Context: Multi-Role Authorization Architecture

## Decision Record

**Date**: 2026-01-22 (Revised)
**Feature**: Multi-Role Authorization with Effective Permissions
**Goal**: Enable users to have multiple roles with different scopes. Assignment tables support Temporal workflow routing for accountability, not RLS access control.

### Key Decisions

1. **Multi-role is BLOCKING**: Required before bulk role assignment feature can proceed
2. **Expected role count**: 4-10 roles per power user (validated JWT size is manageable)
3. **Selected approach**: Option A - RBAC Enhancement with Effective Permissions
4. **Assignment tables purpose**: Temporal workflow routing (notifications/accountability), NOT RLS
5. **RLS is FIXED**: Permission + Scope containment only - no Policy-as-Data needed
6. **Shift model**: Recurring schedule policies, not day-by-day assignments

### Critical Architecture Clarification (2026-01-22)

**Two Distinct Concerns - Do NOT Mix:**

| Concern | Question | Mechanism |
|---------|----------|-----------|
| **Capability (RLS)** | "CAN this user access this data?" | Permission + Scope containment |
| **Accountability (Temporal)** | "WHO should be notified/held responsible?" | Schedule + Assignment |

**RLS policies do NOT check assignments.** Assignment tables are queried only by Temporal workflows for notification routing.

**Client Location is NOT Hierarchical:**
- Client at `UtahValley` does NOT receive services at child OUs (Timpanogas, BYU)
- This is different from permission scope (where UtahValley scope grants access to children)
- Assignment determines "who is responsible for THIS client" not "who can access"

### Why This Matters

The application serves residential and institutional programs for at-risk youth. Line staff:
- Work shift-based at specific facilities (Organization Units)
- May be assigned to specific clients (optional, organization configurable)
- Collect behavioral data (medication, incidents, sleep, activities)
- Need permission-based data access (e.g., `medication.administration`)

**Direct Care Activities** (where schedule/assignment affects accountability):
- Medication administration
- Sleep recording
- Incident reporting
- Behavior tracking
- Activity logging

**Key Distinction:**
- **Capability**: Staff with `medication.administration` at `UtahValley` scope CAN administer meds at any child OU
- **Accountability**: Only staff on schedule at the specific OU should be NOTIFIED and held RESPONSIBLE

The goal is proving treatment efficacy through correlative analysis of factors vs. critical behavioral incidents.

## Technical Context

### Current Architecture (Single-Role Limitation)

**JWT Structure** (current - problematic):
```json
{
  "org_id": "uuid",
  "user_role": "clinician",           // SINGLE string
  "permissions": ["clients.view", "medications.admin"],
  "scope_path": "acme.pediatrics",    // SINGLE path
  "claims_version": 2
}
```

**The Core Problem**:
- User has `clinician` at `acme.pediatrics` with `clients.view`
- User has `medication_manager` at `acme` (org root) with `medications.admin`
- JWT shows `scope_path = "acme.pediatrics"` (from "primary" role)
- Permission `medications.admin` exists but its scope (`acme`) is LOST
- RLS check fails for resources outside `acme.pediatrics`

### Selected Approach: RBAC with Effective Permissions

**New JWT Structure** (claims_version 3):
```json
{
  "org_id": "uuid",
  "effective_permissions": [
    { "p": "clients.view", "s": "acme" },
    { "p": "medications.admin", "s": "acme" },
    { "p": "medications.view", "s": "acme" }
  ],
  "claims_version": 3
}
```

**RLS Pattern** (simplified - permission + scope only):
```sql
CREATE POLICY "client_medications_access" ON client_medications
FOR ALL USING (
  has_effective_permission(
    'medication.administration',
    (SELECT path FROM organization_units_projection WHERE id = org_unit_id)
  )
);
```

**Assignment Tables** (for Temporal workflow routing, NOT RLS):
```sql
-- User Schedule Policies (recurring schedules, event-sourced)
CREATE TABLE user_schedule_policies_projection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users_projection(id),
  organization_id uuid NOT NULL REFERENCES organizations_projection(id),
  schedule jsonb NOT NULL,  -- {"monday": {"begin": "0800", "end": "1600"}, ...}
  org_unit_id uuid REFERENCES organization_units_projection(id),
  effective_from date,
  effective_until date,
  is_active boolean DEFAULT true,
  last_event_id uuid,
  UNIQUE NULLS NOT DISTINCT (user_id, organization_id, org_unit_id)
);

-- User-Client assignments (optional, event-sourced)
CREATE TABLE user_client_assignments_projection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users_projection(id),
  client_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations_projection(id),
  assigned_at timestamptz DEFAULT now(),
  assigned_until timestamptz,
  is_active boolean DEFAULT true,
  last_event_id uuid,
  UNIQUE (user_id, client_id)
);
```

**Organization Feature Flags** (control direct care behavior):
```sql
ALTER TABLE organizations_projection
ADD COLUMN direct_care_settings jsonb DEFAULT '{
  "enable_staff_client_mapping": false,
  "enable_schedule_enforcement": false
}'::jsonb;
```

### Proposed Option B: Full ReBAC

**Infrastructure**: SpiceDB (open source) or Auth0 FGA (managed)

**Relationship Model**:
```
user:alice#clinician@org_unit:acme.pediatrics
user:alice#medication_manager@org:acme
user:alice#caregiver@client:bob
role:clinician#can_view@resource_type:clients
```

**Check Pattern**:
```typescript
const canAccess = await spicedb.check({
  subject: { type: 'user', id: 'alice' },
  permission: 'view',
  resource: { type: 'client', id: 'bob' }
});
```

**Pros**: Natural fit for relationships, Google-scale proven, built-in audit
**Cons**: New infrastructure, RLS bypass needed, learning curve

## File Structure

### Migrations Created and Deployed (2026-01-22 to 2026-01-23)

| Order | Migration Name | Purpose | Status |
|-------|---------------|---------|--------|
| 1 | `20260122204331_permission_implications.sql` | Permission implications table | ✅ Deployed |
| 2 | `20260122204647_permission_implications_seed.sql` | Seed CRUD implications | ✅ Deployed |
| 3 | `20260122205538_effective_permissions_function.sql` | `compute_effective_permissions()` | ✅ Deployed |
| 4 | `20260122215348_jwt_hook_v3.sql` | Update `custom_access_token_hook` | ✅ Deployed |
| 5 | `20260122222249_rls_helpers_v3.sql` | `has_effective_permission()`, deprecate old helpers | ✅ Deployed |
| 6 | `20260123001054_user_current_org_unit.sql` | User session OU context (`current_org_unit_id`) | ✅ Deployed |
| 7 | `20260123001155_jwt_hook_v3_org_unit_claims.sql` | Add OU claims to JWT | ✅ Deployed |
| 8 | `20260123001246_organization_direct_care_settings.sql` | Add `direct_care_settings` to orgs | ✅ Deployed |
| 9 | `20260123001405_user_schedule_policies.sql` | Event-sourced schedule projection | ✅ Deployed |
| 10 | `20260123001542_user_client_assignments.sql` | Event-sourced assignment projection | ✅ Deployed |
| 11 | `20260123181951_user_schedule_client_event_routing.sql` | Event routing for Phase 3 events | ✅ Deployed |

**Key Decision**: Old RLS helpers are **DEPRECATED** not dropped in Phase 2D because existing RLS policies depend on them. Phase 4 will update RLS policies then drop old helpers.

**Deployment Date**: 2026-01-23 (all 11 migrations successfully applied via GitHub Actions)

### AsyncAPI Schemas Updated (2026-01-23)

| File | Events Added |
|------|--------------|
| `contracts/asyncapi/domains/organization.yaml` | `organization.direct_care_settings_updated` |
| `contracts/asyncapi/domains/user.yaml` | `user.schedule.created/updated/deactivated`, `user.client.assigned/unassigned` |

### Frontend Files to Modify

| File | Purpose |
|------|---------|
| `frontend/src/types/auth.types.ts` | New JWT structure with `effective_permissions` |
| `frontend/src/hooks/usePermissions.ts` | Parse effective_permissions array |
| `frontend/src/services/auth/*` | Auth service updates |

### Key Existing Files (Reference)

| File | Content |
|------|---------|
| `infrastructure/supabase/supabase/migrations/20260121000918_baseline_v3.sql:5420-5560` | Current JWT hook |
| `infrastructure/supabase/supabase/migrations/20260121000918_baseline_v3.sql:5772-5872` | RLS helper functions |
| `documentation/infrastructure/reference/database/tables/user_roles_projection.md` | Current role assignment schema |
| `documentation/infrastructure/reference/database/tables/roles_projection.md` | Role definitions |

## Research Findings

### Industry Patterns Evaluated

| Pattern | Description | A4C Fit |
|---------|-------------|---------|
| **AWS IAM** | Session policies, permission boundaries | Partial - no hierarchical scope |
| **Keycloak** | Composite roles, realm_access.roles array | Good JWT pattern |
| **ABAC** | Attribute-based policies | Moderate - doesn't solve scope binding |
| **ReBAC (Zanzibar)** | Relationship-based, graph traversal | Excellent fit, high infrastructure cost |
| **PBAC (OPA)** | External policy engine | Poor - RLS can't call external |

### Access Control Pattern Analysis

| Pattern | "What can user do?" | "Which resources?" |
|---------|--------------------|--------------------|
| Pure RBAC | Yes (permissions) | Partial (scope hierarchy) |
| RBAC + Assignments | Yes | Yes (via assignment tables) |
| Full ReBAC | Yes | Yes (via relationships) |

### JWT Size Analysis (Option A)

- Base JWT overhead: ~500 bytes
- Per role_scope entry: ~150 bytes
- 10 roles x 150 bytes = 1.5KB
- Total: ~2KB (well within 8KB Supabase limit)

## Important Constraints

1. **RLS Cannot Call External Services**: PBAC (OPA) not viable for RLS policies
2. **JWT Claims Set at Login**: Dynamic assignments (shifts) need query-time resolution
3. **Backward Compatibility**: Existing users must continue working during migration
4. **Event Sourcing**: Assignment changes should emit domain events
5. **Multi-Tenancy**: All solutions must maintain org isolation

## Implementation Gotchas (Discovered 2026-01-23)

### 1. Old RLS Helpers: Deprecate, Don't Drop

Old helpers (`get_current_scope_path()`, `get_current_user_role()`, `get_current_permissions()`) are **DEPRECATED** but not dropped in Phase 2D. Reason: Existing RLS policies depend on them.

**Sequence:**
1. Phase 2D: Create new `has_effective_permission()` helper (DONE)
2. Phase 4: Update all RLS policies to use new helper
3. Phase 4 (final step): Drop old helpers

### 1b. ltree Type Qualification in Function Signatures (CRITICAL)

PostgreSQL function signatures (RETURNS, parameters, COMMENT ON, GRANT) evaluate **BEFORE** `SET search_path` takes effect.

**ERROR**: `type "ltree" does not exist (SQLSTATE 42704)`

**FIX**: Use fully-qualified type `extensions.ltree` in ALL function signatures:

```sql
-- ❌ WRONG: search_path doesn't help signatures
CREATE OR REPLACE FUNCTION has_effective_permission(
  p_permission text,
  p_target_path ltree  -- FAILS
) RETURNS boolean ...

-- ✅ CORRECT: Qualify the type
CREATE OR REPLACE FUNCTION has_effective_permission(
  p_permission text,
  p_target_path extensions.ltree  -- WORKS
) RETURNS boolean ...

-- Also qualify in COMMENT ON and GRANT:
COMMENT ON FUNCTION has_effective_permission(text, extensions.ltree) IS ...
GRANT EXECUTE ON FUNCTION has_effective_permission(text, extensions.ltree) TO authenticated;
```

### 1c. SET search_path for ltree Operators (CRITICAL)

SQL functions using ltree operators (`@>`, `<@`, etc.) must set search_path so PostgreSQL can find the operators.

**ERROR**: `operator does not exist: extensions.ltree @> extensions.ltree`

**FIX**: Add `SET search_path = public, extensions` to SQL functions:

```sql
CREATE OR REPLACE FUNCTION has_effective_permission(
  p_permission text,
  p_target_path extensions.ltree
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, extensions  -- REQUIRED for @> operator
AS $$
  SELECT EXISTS (
    SELECT 1 FROM ...
    WHERE (ep->>'s')::ltree @> p_target_path  -- Uses unqualified ::ltree
  );
$$;
```

**Key Insight**: With search_path set, casts inside function body use unqualified `::ltree` (NOT `::extensions.ltree`).

### 1d. Index Predicates Must Be IMMUTABLE

PostgreSQL requires index WHERE clauses to use only IMMUTABLE functions. `now()` is STABLE.

**ERROR**: `functions in index predicate must be marked IMMUTABLE (SQLSTATE 42P17)`

**FIX**: Don't use `now()` in index predicates. Move time filtering to query:

```sql
-- ❌ WRONG: now() is STABLE, not IMMUTABLE
CREATE INDEX idx_user_client_assignments_user
ON user_client_assignments_projection(user_id)
WHERE is_active = true AND (assigned_until IS NULL OR assigned_until > now());

-- ✅ CORRECT: Include assigned_until as column, filter at query time
CREATE INDEX idx_user_client_assignments_user
ON user_client_assignments_projection(user_id, assigned_until)
WHERE is_active = true;

-- Query filters expired assignments:
SELECT * FROM user_client_assignments_projection
WHERE user_id = $1
  AND is_active = true
  AND (assigned_until IS NULL OR assigned_until > now());
```

### 1e. Table Name: `users` Not `users_projection`

The users table is named `users` (not `users_projection` like other projections).

**ERROR**: `relation "users_projection" does not exist (SQLSTATE 42P01)`

**FIX**: Use `REFERENCES users(id)` not `users_projection(id)`:

```sql
-- ❌ WRONG
user_id uuid NOT NULL REFERENCES users_projection(id)

-- ✅ CORRECT
user_id uuid NOT NULL REFERENCES users(id)
```

### 1f. user_roles_projection Has No is_active Column

The `user_roles_projection` table does NOT have an `is_active` column. Role validity is determined by `role_valid_from` and `role_valid_until` dates.

**ERROR**: `column ur.is_active does not exist (SQLSTATE 42703)`

**FIX**: Use temporal validity dates instead:

```sql
-- ❌ WRONG
WHERE ur.is_active = true

-- ✅ CORRECT
WHERE (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
  AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE)
```

### 2. User Session OU Context (Gap Identified)

For **client-centric workflows** (medication alerts), OU context flows from the client's location.

For **user-centric workflows** (shift notifications), there was NO OU context source. Added Phase 3A-0 to address:
- `users.current_org_unit_id` column
- `api.switch_org_unit()` function
- JWT includes `current_org_unit_id` and `current_org_unit_path`

### 3. Schedule Format: HHMM Strings, Not Time Types

Schedule times stored as `"HHMM"` strings (e.g., `"0800"`, `"1600"`), NOT PostgreSQL `time` types.

**Reason**: JSONB doesn't natively support time types. String parsing in `is_user_on_schedule()` converts to time for comparison.

**Gotcha**: Day names from PostgreSQL have trailing spaces:
```sql
v_day_of_week := lower(trim(to_char(p_check_time, 'day')));  -- Must trim!
```

### 4. Organization Timezone for Schedule Checks

`is_user_on_schedule()` converts check time to organization's timezone before comparing against schedule. Uses `organizations_projection.timezone` (default: `America/New_York`).

### 5. Event Handler Registration Required

The migration creates event handlers (`handle_user_schedule_created()`, etc.) but does NOT auto-register them in the event router.

**Required**: Manually add CASE statements to `process_user_event()`:
```sql
WHEN 'user.schedule.created' THEN PERFORM handle_user_schedule_created(NEW);
WHEN 'user.schedule.updated' THEN PERFORM handle_user_schedule_updated(NEW);
-- etc.
```

### 6. UNIQUE NULLS NOT DISTINCT for Optional FK

`user_schedule_policies_projection` has unique constraint: `(user_id, organization_id, org_unit_id)`.

Since `org_unit_id` can be NULL (org-wide schedule), PostgreSQL 15+ `NULLS NOT DISTINCT` treats NULLs as equal for uniqueness.

### 7. Client FK Deferred

`user_client_assignments_projection.client_id` has NO FK constraint yet. Comment notes:
```sql
client_id uuid NOT NULL,  -- Will reference clients table when created
```

This is intentional - clients table doesn't exist yet.

## Why RBAC + Assignments Over Full ReBAC?

**For Option A (Recommended)**:
- Lower infrastructure risk - stays within Supabase ecosystem
- Incremental migration possible
- PostgreSQL RLS continues to work
- Assignment tables are "light ReBAC" without external dependencies
- Sufficient for current relationship complexity

**When to Reconsider ReBAC**:
- If relationships become deeply nested (client → family → guardian)
- If reverse lookups needed ("who can access client X?")
- If audit requirements become stringent
- If relationships cross organizational boundaries

## REMOVED: OPA/Rego and Policy-as-Data (2026-01-22)

> **Decision**: OPA/Rego and Policy-as-Data (`access_policies` table) have been **REMOVED** from the architecture.
>
> **Rationale**: After domain clarification, RLS should be FIXED (permission + scope containment only).
> Assignment tables are for Temporal workflow routing (accountability), not RLS access control.
> Admin-configurable policies are not needed - access rules are determined by the permission system.
>
> See "Critical Architecture Clarification" section above for the Capability vs Accountability distinction.

## REMOVED: Policy-as-Data Detailed Design (2026-01-22)

> **Decision**: The entire Policy-as-Data schema design (`access_policies`, `access_policy_changes`,
> `evaluate_access_policy()` function) has been **REMOVED** from the architecture.
>
> **Reason**: After domain clarification:
> - RLS is FIXED at permission + scope containment only
> - Assignment tables are for Temporal workflow routing, NOT RLS
> - No admin-configurable policies needed
>
> **What replaces it**:
> - Simple `has_effective_permission(permission, path)` RLS helper
> - Organization feature flags (`direct_care_settings`) for workflow behavior
> - Event-sourced `user_schedule_policies_projection` and `user_client_assignments_projection` for Temporal
>
> See "Selected Approach" section above for current architecture.

## DISCARDED: Permit.io Evaluation (2026-01-21)

> **Decision**: Permit.io was evaluated and **DISCARDED** as an option.
>
> **Rationale:**
> - RLS at database level is stronger security than Edge Function enforcement
> - Single source of truth (Supabase) is simpler than syncing two systems
> - A4C's specific needs are well-served by PostgreSQL RLS + Temporal workflows
> - No per-user/per-check fees
>
> The selected approach (RBAC with Effective Permissions + Temporal for accountability) achieves
> the same goals without external infrastructure.

## Key Architectural Insight: "ReBAC in PostgreSQL" (Revised 2026-01-22)

### The Assertion
RBAC with Effective Permissions is effectively a **limited ReBAC implementation** for capability:
1. Permissions are inheritable via LTREE scope (hierarchical relationships)
2. Permission implications provide derived permissions

**However, assignment relationships (user-client, user-schedule) are NOT for RLS.**
They are queried by Temporal workflows for accountability/notification routing.

### Mapping to ReBAC Concepts

| ReBAC Concept | A4C Implementation |
|---------------|-------------------|
| Hierarchical relationships | `ltree` scope containment (`scope_path @> target_path`) |
| Permission inheritance | Role → permissions, inherited down scope hierarchy |
| Permission implications | `permission_implications` table |
| User-resource relationships | `user_client_assignments_projection`, `user_schedule_policies_projection` (for Temporal, NOT RLS) |

### Two Separate Systems

```
┌───────────────────────────────────────────────────────────────┐
│                    CAPABILITY (RLS)                           │
│  "CAN this user access this data?"                            │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  has_effective_permission(permission, target_path)       │ │
│  │  → Check JWT effective_permissions array                 │ │
│  │  → Verify user's scope @> target path                    │ │
│  └─────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│                ACCOUNTABILITY (Temporal)                       │
│  "WHO should be notified/held responsible?"                   │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Query user_schedule_policies_projection                 │ │
│  │  Query user_client_assignments_projection (if enabled)   │ │
│  │  Check organization direct_care_settings feature flags   │ │
│  │  Route notifications to appropriate staff                │ │
│  └─────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

### Why This Separation

| Concern | Capability (RLS) | Accountability (Temporal) |
|---------|-----------------|--------------------------|
| Question | CAN access? | WHO is responsible? |
| Enforcement | Database level | Application level |
| Input | Permission + Scope | Schedule + Assignment |
| Output | Allow/Deny | Notification routing |
| Hierarchy | Scope IS hierarchical | Client location is NOT |

**Conclusion**: A4C's authorization is "RBAC + Effective Permissions" for capability, with separate event-sourced projections for Temporal workflow accountability routing.

## Effective Permissions Computation (2026-01-21)

### The Problem: Permission Redundancy

When naive administrators configure roles, overlapping permissions naturally occur:

#### Scenario 1: Scope Overlap (Vertical Redundancy)

```
User has:
  - Role A at scope `acme` with [clients.view]
  - Role B at scope `acme.pediatrics` with [clients.view]

Problem: clients.view at `acme` already covers `acme.pediatrics`
         The narrower grant is REDUNDANT.
```

#### Scenario 2: Permission Overlap (Horizontal Redundancy)

```
User has at same scope `acme.pediatrics`:
  - Role A (clinician) with [clients.view, medications.view]
  - Role B (medication_tech) with [medications.view, medications.administer]

Problem: medications.view appears in both roles
         DUPLICATE permission at same scope.
```

#### Scenario 3: Combined Overlap + Implications

```
User has:
  - Role A at `acme` with [clients.view, medications.admin]
  - Role B at `acme.pediatrics` with [clients.view, medications.view]

Problems:
  1. clients.view at narrower scope is redundant (covered by wider)
  2. medications.view is redundant if medications.admin implies it
  3. The implied medications.view should inherit the wider scope from medications.admin
```

### Goals

1. **Goal 1: JWT Size Management** - Remove unnecessary redundancies
2. **Goal 2: Permission Implications** - Add implied permissions with correct scope inheritance

### Solution: Effective Permissions Algorithm

Compute the **minimal set of (permission, widest_scope) pairs** that fully represent access.

```
Input: All (role, permission, scope) tuples for a user
Output: Minimal (permission, scope) pairs for JWT

Step 1: Collect all explicit grants
        → [(clients.view, acme), (clients.view, acme.pediatrics),
           (medications.view, acme.pediatrics), (medications.admin, acme)]

Step 2: For each permission, keep only the WIDEST scope
        → clients.view: acme (drops acme.pediatrics - it's contained)
        → medications.view: acme.pediatrics
        → medications.admin: acme

Step 3: Expand implications, inheriting the implying permission's scope
        → medications.admin at acme IMPLIES medications.view at acme
        → This is WIDER than explicit medications.view at acme.pediatrics

Step 4: Re-apply widest-scope rule after expansion
        → medications.view: acme (widened by implication)

Final: [(clients.view, acme), (medications.view, acme), (medications.admin, acme)]
```

### SQL Implementation

```sql
CREATE OR REPLACE FUNCTION compute_effective_permissions(p_user_id uuid, p_org_id uuid)
RETURNS TABLE(permission_name text, effective_scope ltree) AS $$
WITH
-- Step 1: Collect all explicit grants with their scopes
explicit_grants AS (
  SELECT DISTINCT
    p.name AS permission_name,
    p.id AS permission_id,
    ur.scope_path
  FROM user_roles_projection ur
  JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
  JOIN permissions_projection p ON p.id = rp.permission_id
  WHERE ur.user_id = p_user_id
    AND ur.organization_id = p_org_id
),

-- Step 2: For each permission, find widest scope (shortest ltree = highest in hierarchy)
widest_explicit AS (
  SELECT DISTINCT ON (permission_name)
    permission_name,
    permission_id,
    scope_path
  FROM explicit_grants
  ORDER BY permission_name, nlevel(scope_path) ASC  -- shortest path = widest scope
),

-- Step 3: Expand implications, using the implying permission's scope
with_implications AS (
  SELECT permission_name, permission_id, scope_path FROM widest_explicit
  UNION
  SELECT
    p2.name,
    p2.id,
    we.scope_path  -- Inherit scope from the implying permission
  FROM widest_explicit we
  JOIN permission_implications pi ON pi.permission_id = we.permission_id
  JOIN permissions_projection p2 ON p2.id = pi.implies_permission_id
),

-- Step 4: Re-apply widest scope after implication expansion
final_effective AS (
  SELECT DISTINCT ON (permission_name)
    permission_name,
    scope_path AS effective_scope
  FROM with_implications
  ORDER BY permission_name, nlevel(scope_path) ASC
)

SELECT * FROM final_effective;
$$ LANGUAGE sql STABLE;
```

### JWT Structure with Effective Permissions

```json
{
  "org_id": "uuid",
  "effective_permissions": [
    { "p": "clients.view", "s": "acme" },
    { "p": "medications.view", "s": "acme" },
    { "p": "medications.admin", "s": "acme" }
  ],
  "claims_version": 3
}
```

**Design Notes:**
- Short keys (`p`, `s`) to minimize JWT size
- No redundant permissions - only widest scope kept
- Implied permissions included with correct (inherited) scope
- Flat array structure for easy iteration in RLS

### RLS Helper Function

```sql
CREATE OR REPLACE FUNCTION has_effective_permission(
  p_permission text,
  p_target_path ltree
) RETURNS boolean AS $$
  -- Check if any effective permission covers the target
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      (current_setting('request.jwt.claims', true)::jsonb)->'effective_permissions'
    ) ep
    WHERE ep->>'p' = p_permission
      AND (ep->>'s')::ltree @> p_target_path  -- User's scope contains target
  );
$$ LANGUAGE sql STABLE;
```

### Integration with Permission Implications

The `permission_implications` table drives Step 3:

```sql
CREATE TABLE permission_implications (
  permission_id uuid NOT NULL REFERENCES permissions_projection(id),
  implies_permission_id uuid NOT NULL REFERENCES permissions_projection(id),
  PRIMARY KEY (permission_id, implies_permission_id),
  CHECK (permission_id != implies_permission_id)
);

-- Standard CRUD implications
-- organization.update_ou → organization.view_ou
-- organization.delete_ou → organization.view_ou
-- clients.update → clients.view
-- medications.administer → medications.view
```

### JWT Hook Integration

The `custom_access_token_hook` calls `compute_effective_permissions()`:

```sql
-- In custom_access_token_hook:
SELECT jsonb_agg(
  jsonb_build_object('p', permission_name, 's', effective_scope::text)
)
INTO v_effective_permissions
FROM compute_effective_permissions(v_user_id, v_org_id);

-- Build final claims
v_claims := jsonb_build_object(
  'org_id', v_org_id,
  'effective_permissions', COALESCE(v_effective_permissions, '[]'::jsonb),
  'claims_version', 3
);
```

### Size Efficiency Analysis

**Before (naive approach):**
```json
{
  "role_scopes": [
    { "role": "clinician", "scope": "acme.pediatrics", "permissions": ["clients.view", "medications.view"] },
    { "role": "provider_admin", "scope": "acme", "permissions": ["clients.view", "clients.update", "medications.admin", "medications.view", ...] }
  ]
}
```
~500+ bytes, growing with role count, redundant permissions included.

**After (effective permissions):**
```json
{
  "effective_permissions": [
    { "p": "clients.view", "s": "acme" },
    { "p": "clients.update", "s": "acme" },
    { "p": "medications.admin", "s": "acme" },
    { "p": "medications.view", "s": "acme" }
  ]
}
```
~200 bytes for 4 effective permissions, no redundancies, no role duplication.

### Query: Debug Effective Permissions

```sql
-- Show how effective permissions were computed for a user
WITH RECURSIVE permission_trace AS (
  SELECT
    p.name AS permission,
    ur.scope_path,
    'explicit from role: ' || r.name AS source
  FROM user_roles_projection ur
  JOIN roles_projection r ON r.id = ur.role_id
  JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
  JOIN permissions_projection p ON p.id = rp.permission_id
  WHERE ur.user_id = :user_id

  UNION ALL

  SELECT
    p2.name,
    pt.scope_path,  -- Inherited scope
    'implied by: ' || pt.permission
  FROM permission_trace pt
  JOIN permissions_projection p1 ON p1.name = pt.permission
  JOIN permission_implications pi ON pi.permission_id = p1.id
  JOIN permissions_projection p2 ON p2.id = pi.implies_permission_id
)
SELECT
  permission,
  scope_path,
  source,
  nlevel(scope_path) AS depth
FROM permission_trace
ORDER BY permission, depth ASC;
```

## REMOVED from Original Plan (2026-01-22)

The following components were part of the original design but have been **removed** after domain clarification:

| Component | Reason for Removal |
|-----------|-------------------|
| `access_policies` table | RLS is fixed (permission + scope) - no admin configuration needed |
| `access_policy_changes` table | No longer needed - no policy table |
| `evaluate_access_policy()` function | RLS uses simple `has_effective_permission()` |
| `user_shift_assignments` (day-by-day) | Replaced with `user_schedule_policies` (recurring) |
| Policy Management UI | No longer needed - removed `access_policies` |

**Obsolete Dev-Docs:**
- `dev/active/policy-management-ui-context.md` → Archive
- `dev/active/policy-management-ui-plan.md` → Archive
- `dev/active/policy-management-ui-tasks.md` → Archive

## Reference Materials

- Analysis document: `/home/lars/.claude/plans/concurrent-prancing-moonbeam.md`
- Supabase RBAC docs: https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac
- Google Zanzibar paper: https://authzed.com/learn/google-zanzibar
- SpiceDB: https://authzed.com/spicedb
- Auth0 FGA: https://auth0.com/fine-grained-authorization
- Permit.io: https://permit.io (Policy-as-Code with multiple targets - DISCARDED)
- OPAL (Open Policy Administration Layer): https://opal.ac/ (DISCARDED)
- AWS Cedar: https://www.cedarpolicy.com/
- OPA/Rego: https://www.openpolicyagent.org/ (DISCARDED for RLS)
