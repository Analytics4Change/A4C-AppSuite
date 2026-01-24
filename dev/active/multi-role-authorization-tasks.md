# Tasks: Multi-Role Authorization Architecture

## Phase 1: Architecture Decision ✅ COMPLETE

- [x] Research multi-role RBAC patterns (AWS IAM, Keycloak, WorkOS)
- [x] Research alternative patterns (ABAC, PBAC, ReBAC/Zanzibar)
- [x] Inventory current A4C access control constraints
- [x] Document JWT hook single-role limitation
- [x] Analyze RLS helper functions (get_current_scope_path, etc.)
- [x] Create analysis document with options comparison
- [x] Validate JWT size for 4-10 roles (~2KB, within 8KB limit)
- [x] Document domain context (staff, clients, shifts, behavioral data)
- [x] Clarify Capability (RLS) vs Accountability (Temporal) distinction (2026-01-22)
- [x] Remove Policy-as-Data from architecture - RLS is fixed (2026-01-22)
- [x] Evaluate Option A (RBAC + Effective Permissions) vs Option B (ReBAC) against scenarios
- [x] Make final architecture decision → **Option A selected** (RBAC + Effective Permissions)
- [ ] Create ADR (Architecture Decision Record)

## Phase 2: JWT Restructure + Effective Permissions ✅ COMPLETE

- [x] Design new JWT structure with `effective_permissions` array
- [x] Create `permission_implications` table (`20260122204331_permission_implications.sql`)
- [x] Seed permission implications (CRUD standard + domain-specific) (`20260122204647_permission_implications_seed.sql`)
- [x] Create `compute_effective_permissions()` function (`20260122205538_effective_permissions_function.sql`)
- [x] Modify `custom_access_token_hook` to use effective permissions (`20260122215348_jwt_hook_v3.sql`)
- [x] Add `claims_version: 3` for migration detection
- [x] Create `has_effective_permission()` RLS helper function (`20260122222249_rls_helpers_v3.sql`)
- [x] DEPRECATE old helpers (not dropped yet - existing policies depend on them)
- [ ] Test JWT generation with multi-role users
- [ ] Verify JWT size with realistic role counts + implications

**Note**: Old RLS helpers are DEPRECATED (not dropped) in Phase 2. Phase 4 will update RLS policies, then drop old helpers.

## Phase 3A-0: User Session OU Context ✅ COMPLETE

> User's current working OU for user-centric workflow routing.

- [x] Add `current_org_unit_id` to users table (`20260123001054_user_current_org_unit.sql`)
- [x] Create `api.switch_org_unit()` function with permission validation
- [x] Create `api.get_current_org_unit()` helper function
- [x] Update JWT hook to include OU claims (`20260123001155_jwt_hook_v3_org_unit_claims.sql`)
  - [x] `current_org_unit_id` in JWT
  - [x] `current_org_unit_path` in JWT

## Phase 3A: Organization Direct Care Settings ✅ COMPLETE

> Feature flags to control direct care workflow behavior per organization.

- [x] Add `direct_care_settings` JSONB column to `organizations_projection` (`20260123001246_organization_direct_care_settings.sql`)
  - [x] `enable_staff_client_mapping` (boolean, default false)
  - [x] `enable_schedule_enforcement` (boolean, default false)
- [x] Create AsyncAPI event schema: `organization.direct_care_settings.updated`
- [x] Add API function `api.update_organization_direct_care_settings()`
- [x] Add API function `api.get_organization_direct_care_settings()`
- [ ] Update organization event processor to handle settings event
- [ ] Test feature flags behavior

## Phase 3B: User Schedule Policies ✅ COMPLETE

> Recurring schedule patterns for staff availability (event-sourced projection).

- [x] Create `user_schedule_policies_projection` table (`20260123001405_user_schedule_policies.sql`)
  - [x] `user_id`, `organization_id`, `org_unit_id`
  - [x] `schedule` JSONB: `{"monday": {"begin": "0800", "end": "1600"}, ...}`
  - [x] `effective_from`, `effective_until` (date range)
  - [x] `is_active`, `last_event_id` metadata
- [x] Create AsyncAPI event schemas (in `contracts/asyncapi/domains/user.yaml`):
  - [x] `user.schedule.created`
  - [x] `user.schedule.updated`
  - [x] `user.schedule.deactivated`
- [x] Create event handlers: `handle_user_schedule_created/updated/deactivated()`
- [x] Create helper function: `is_user_on_schedule(user_id, org_id, org_unit_id, check_time)`
- [x] Create RLS policies (org-scoped read, permission-gated modify)
- [x] Add schedule event routing to `process_user_event()` router (`20260123181951_user_schedule_client_event_routing.sql`)
- [ ] Run `npm run generate:types` after AsyncAPI schemas

## Phase 3C: User Client Assignments ✅ COMPLETE

> Optional staff-to-client mapping for notification routing (event-sourced projection).

- [x] Create `user_client_assignments_projection` table (`20260123001542_user_client_assignments.sql`)
  - [x] `user_id`, `client_id`, `organization_id`
  - [x] `assigned_at`, `assigned_until`
  - [x] `is_active`, `last_event_id` metadata
- [x] Create AsyncAPI event schemas (in `contracts/asyncapi/domains/user.yaml`):
  - [x] `user.client.assigned`
  - [x] `user.client.unassigned`
- [x] Create event handlers: `handle_user_client_assigned/unassigned()`
- [x] Create helper functions: `is_user_assigned_to_client()`, `get_staff_assigned_to_client()`, `get_clients_assigned_to_user()`
- [x] Create RLS policies (org-scoped read, permission-gated modify)
- [x] Add client assignment event routing to `process_user_event()` router (`20260123181951_user_schedule_client_event_routing.sql`)
- [ ] Run `npm run generate:types` after AsyncAPI schemas

## Phase 4: RLS Policy Migration ⏸️ PENDING

> RLS policies should use ONLY permission + scope containment.
> Assignment tables are NOT checked by RLS - they are for Temporal workflow routing.

- [ ] Audit all RLS policies using `get_current_scope_path()`
- [ ] Migrate to `has_effective_permission(permission, target_path)` pattern
- [ ] Migrate organization policies
- [ ] Migrate organization_unit policies
- [ ] Migrate user-related policies
- [ ] Migrate role-related policies
- [ ] Remove any assignment-based checks from RLS (if any exist)
- [ ] Test with multi-role, multi-scope users

## Phase 5: Frontend Integration ⏸️ PENDING

- [ ] Update `auth.types.ts` for new JWT structure (`effective_permissions` array)
- [ ] Update `usePermissions` hook to parse new structure
- [ ] Create `hasEffectivePermission(permission, targetPath)` utility
- [ ] Update permission checking utilities
- [ ] Remove single-role assumptions in components
- [ ] Test frontend with new authorization model

## Phase 6: UI Planning - Organization Direct Care Settings 📋 PLANNING

> Admin UI for configuring organization-level feature flags.

- [ ] Create `dev/active/org-direct-care-settings-ui-context.md`
- [ ] Create `dev/active/org-direct-care-settings-ui-plan.md`
- [ ] Create `dev/active/org-direct-care-settings-ui-tasks.md`
- [ ] Design settings form in organization settings page
- [ ] Toggle switches for `enable_staff_client_mapping` and `enable_schedule_enforcement`
- [ ] Permission gating (`organization.settings_manage`)

## Phase 7: UI Planning - Schedules & Client Assignments 📋 PLANNING

> Admin UIs for managing staff schedules and client assignments.

- [ ] Create `dev/active/staff-scheduling-ui-context.md`
- [ ] Create `dev/active/staff-scheduling-ui-plan.md`
- [ ] Create `dev/active/staff-scheduling-ui-tasks.md`
- [ ] Create `dev/active/client-assignments-ui-context.md`
- [ ] Create `dev/active/client-assignments-ui-plan.md`
- [ ] Create `dev/active/client-assignments-ui-tasks.md`
- [ ] Design weekly schedule grid/form
- [ ] Design client assignment management UI
- [ ] Permission gating (`user.schedule_manage`, `user.client_assign`)

## DISCARDED: ReBAC Implementation (Option B) ❌

> **Decision**: Full ReBAC (SpiceDB/Auth0 FGA) discarded in favor of "RBAC + Effective Permissions" approach.
> The selected architecture achieves scope-permission binding without external infrastructure.
> Assignment tables are for Temporal workflow routing, NOT RLS access control.

## Success Validation Checkpoints

### Architecture Decision Validation
- [x] Option A selected with documented rationale
- [x] Capability vs Accountability distinction clarified (2026-01-22)
- [x] Infrastructure requirements understood (no new infrastructure needed)

### JWT Restructure Validation (Phase 2)
- [ ] Multi-role user gets correct JWT with `effective_permissions` array
- [ ] JWT size under 8KB for 10-role user
- [ ] `has_effective_permission()` returns correct results
- [ ] Permission implications expand correctly

### Direct Care Infrastructure Validation (Phase 3)
- [ ] Organization `direct_care_settings` JSONB column works
- [ ] `user_schedule_policies_projection` event processing works
- [ ] `user_client_assignments_projection` event processing works
- [ ] Helper functions (`is_user_on_schedule`, `is_user_assigned_to_client`) work

### RLS Migration Validation (Phase 4)
- [ ] All RLS policies use `has_effective_permission(permission, path)`
- [ ] No assignment checks in RLS (assignments are for Temporal only)
- [ ] Multi-role, multi-scope users have correct access

### Feature Complete Validation
- [ ] Staff can have multiple roles with different scopes
- [ ] Each permission works at its assigned scope
- [ ] Bulk role assignment UI functional (dependent feature)
- [ ] All existing functionality continues working

## Current Status

**Phase**: 3 - Direct Care Infrastructure ✅ DEPLOYED
**Status**: ✅ All 11 migrations deployed to production via GitHub Actions (2026-01-23)
**Last Updated**: 2026-01-23
**Next Step**:
1. ~~Deploy migrations: `supabase db push --linked`~~ ✅ DONE
2. Run `npm run generate:types` in `infrastructure/supabase/contracts/`
3. ~~Add event routing to `process_user_event()` for new event types~~ ✅ DONE (migration #11)
4. Proceed to Phase 4 (RLS Policy Migration) - Update existing RLS policies to use `has_effective_permission()`

### Implementation Summary (2026-01-23)

**Migrations Deployed (11 total):**
| Phase | Migration | Purpose | Status |
|-------|-----------|---------|--------|
| 2A | `20260122204331_permission_implications.sql` | Permission implications table | ✅ Deployed |
| 2A | `20260122204647_permission_implications_seed.sql` | CRUD implications seed | ✅ Deployed |
| 2B | `20260122205538_effective_permissions_function.sql` | `compute_effective_permissions()` | ✅ Deployed |
| 2C | `20260122215348_jwt_hook_v3.sql` | JWT hook with effective_permissions | ✅ Deployed |
| 2D | `20260122222249_rls_helpers_v3.sql` | `has_effective_permission()` helper | ✅ Deployed |
| 3A-0 | `20260123001054_user_current_org_unit.sql` | User session OU context | ✅ Deployed |
| 3A-0 | `20260123001155_jwt_hook_v3_org_unit_claims.sql` | OU claims in JWT | ✅ Deployed |
| 3A | `20260123001246_organization_direct_care_settings.sql` | Direct care feature flags | ✅ Deployed |
| 3B | `20260123001405_user_schedule_policies.sql` | User schedule projection | ✅ Deployed |
| 3C | `20260123001542_user_client_assignments.sql` | User client assignment projection | ✅ Deployed |
| 3-Event | `20260123181951_user_schedule_client_event_routing.sql` | Event routing for Phase 3 | ✅ Deployed |

**Deployment Date**: 2026-01-23 (via GitHub Actions, after 6 iterative fixes for PostgreSQL gotchas)

**AsyncAPI Schemas Updated:**
- `contracts/asyncapi/domains/organization.yaml` - Added `organization.direct_care_settings.updated`
- `contracts/asyncapi/domains/user.yaml` - Added schedule and client assignment events

**Architecture Decision Summary (Revised 2026-01-22):**
- **Selected**: RBAC + Effective Permissions for Capability (RLS)
- **Added**: Event-sourced projections for Accountability (Temporal workflow routing)
- **REMOVED**: Policy-as-Data (`access_policies`) - RLS is fixed at permission + scope
- **REMOVED**: `user_shift_assignments` (day-by-day) → Replaced with `user_schedule_policies` (recurring)
- **Discarded**: Option B - Full ReBAC (SpiceDB/Auth0 FGA) - unnecessary complexity
- **Discarded**: Permit.io - adds external dependency without proportional benefit

### Critical Distinction
| Concern | Mechanism | Tables Used |
|---------|-----------|-------------|
| **Capability (RLS)** | Permission + Scope containment | `effective_permissions` JWT, RLS policies |
| **Accountability (Temporal)** | Schedule + Assignment | `user_schedule_policies_projection`, `user_client_assignments_projection` |

## Open Questions (Resolved 2026-01-22)

1. ~~**Client relationship complexity**~~: Will clients have families/guardians with their own access needs?
   - **Not in scope for this work**
2. ~~**Cross-org access**~~: Will staff ever need access across organizational boundaries?
   - **No** - org isolation maintained
3. ~~**Audit requirements**~~: How critical is "who could access what when" audit capability?
   - **Domain events provide audit trail**
4. ~~**Shift scheduling integration**~~: Will shifts be managed in A4C or imported from external system?
   - **A4C manages recurring schedule policies** (not day-by-day imports)
5. ~~**Policy configurability**~~: How much should administrators be able to configure access policies without code changes?
   - **Not needed** - RLS is fixed, only feature flags for direct care behavior

## Key Decisions Made (Revised 2026-01-22)

| Decision | Selected | Rationale |
|----------|----------|-----------|
| Architecture approach | **RBAC + Effective Permissions** | Lowest infrastructure risk, stays within Supabase ecosystem |
| RLS pattern | **Permission + Scope only** | Assignments are for Temporal routing, NOT access control |
| Schedule model | **Recurring policies** (not day-by-day) | Simpler management, typical shift patterns |
| Client assignment | **Optional, event-sourced** | Default: all staff at OU; Optional: explicit mapping |
| Organization behavior | **Feature flags** (`direct_care_settings`) | Per-org control without code changes |
| Permission implication | **Implications table** | Explicit relationships, auditable |
| JWT structure | **Effective permissions** `[{p, s}]` | Deduplicated, includes implications, ~200 bytes efficient |

## Key Decisions REMOVED (2026-01-22)

| Decision | Was | Now |
|----------|-----|-----|
| Policy management | Policy-as-Data (`access_policies`) | **REMOVED** - RLS is fixed |
| Shift assignments | `user_shift_assignments` (day-by-day) | **REPLACED** with `user_schedule_policies` (recurring) |
| Assignment in RLS | Considered | **REMOVED** - assignments are for Temporal only |

## Research Thread: Policy Management ❌ CLOSED (2026-01-22)

> **Outcome**: Policy-as-Data approach REMOVED after domain clarification.
> RLS is fixed at permission + scope. No admin-configurable policies needed.

- [x] Evaluate OPA/Rego for policy enforcement (limited - RLS can't call external)
- [x] Evaluate OPA/Rego for policy definition → SQL compilation (very high complexity)
- [x] ~~Identify Policy-as-Data as practical alternative~~ → **REMOVED**
- [x] Evaluate Permit.io for long-term consideration (discarded)
- [x] ~~Validate architectural characterization as "ReBAC in PostgreSQL"~~ → **Revised to Capability vs Accountability**

## Research Thread: Permission Implications & Effective Permissions ✅ COMPLETE

- [x] Identify permission implication patterns (CRUD chain: delete → update → view)
- [x] Evaluate implication implementation approaches:
  - [x] Permission implications table (SELECTED)
  - [x] Convention-based expansion (rejected - less flexible)
  - [x] Permission levels (rejected - doesn't handle cross-cutting)
- [x] Design permission redundancy scenarios:
  - [x] Scope overlap (vertical) - same perm at different scope levels
  - [x] Permission overlap (horizontal) - multiple roles with same perm
  - [x] Combined overlap + implications
- [x] Design effective permissions algorithm:
  - [x] Step 1: Collect explicit grants
  - [x] Step 2: Dedupe to widest scope (nlevel ASC)
  - [x] Step 3: Expand implications with scope inheritance
  - [x] Step 4: Re-dedupe after expansion
- [x] Design JWT structure: `effective_permissions: [{p, s}, ...]`
- [x] Design `has_effective_permission()` RLS helper
- [x] Document size efficiency (200 bytes vs 500+ bytes naive)

## Research Thread: Capability vs Accountability ✅ COMPLETE (2026-01-22)

- [x] Clarify RLS is for CAPABILITY ("CAN user access data?")
- [x] Clarify assignment tables are for ACCOUNTABILITY ("WHO is responsible?")
- [x] Client location is NOT hierarchical (different from permission scope)
- [x] Design `user_schedule_policies_projection` (recurring, event-sourced)
- [x] Design `user_client_assignments_projection` (optional, event-sourced)
- [x] Design organization `direct_care_settings` feature flags
- [x] Document that Temporal queries assignments, RLS does NOT

## OBSOLETE Dev-Docs (Archive)

> The following dev-docs are now obsolete and should be archived:

- `dev/active/policy-management-ui-context.md` → Move to `dev/archived/`
- `dev/active/policy-management-ui-plan.md` → Move to `dev/archived/`
- `dev/active/policy-management-ui-tasks.md` → Move to `dev/archived/`
