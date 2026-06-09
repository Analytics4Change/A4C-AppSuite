# Seed `grant.create` + `grant.revoke` + `grant.view` into `provider_admin` role template

**Status**: seed (not yet planned)
**Priority**: High (production defect; the entire Phase 2 grant write-side is unreachable by the intended `provider_admin` role — only platform-privilege fallback works)
**Origin**: Phase 2 UAT planning probe 2026-06-09 (post-PR-#71-merge dev verification by claude during UAT card update)

## Problem

Phase 1 (PR #70) seeded 3 new permissions into `permissions_projection` via `permission.defined` events: `grant.create`, `grant.revoke`, `grant.view` (all `scope_type='global'`). Phase 2 (PR #71) added a 4th permission `partnership.manage` AND extended the `provider_admin` `role_permission_templates` to grant it (Step 7b: template addition + backfill to existing role instances).

**But neither phase ever extended the `provider_admin` role template (or any other role template) with the 3 `grant.*` permissions.**

Dev probe results (2026-06-09 18:35Z, just post-PR-#71-merge):

```
permissions_projection: grant.create, grant.revoke, grant.view, partnership.manage  (4 rows ✓)
role_permission_templates for provider_admin (matching): partnership.manage         (1 row)
role_permissions_projection for provider_admin instances + partnership.manage: 2/2  (backfill OK)
role_permissions_projection for provider_admin instances + grant.*:          0/2   (UNGRANTED)
permission_implications involving grant.* or partnership.manage:             none   (no transitive path)
ANY role_permission_template row with permission_name LIKE 'grant.%':        ZERO
```

The 3 new RPCs Phase 2 ships all have the same gate shape: `has_platform_privilege() OR has_effective_permission('grant.<x>', v_provider_path)`. Today only the `has_platform_privilege()` short-circuit succeeds for any caller — provider admins (the **intended authority** per ADR Decision C.1 + the reachability-matrix entries that explicitly say "Provider-admin authority") cannot call `api.create_access_grant` or `api.revoke_access_grant`.

The reachability matrix at `documentation/architecture/authorization/cross-tenant-access-grant-rpc-reachability-matrix.md` declares (as of PR #71 merge):

| RPC | Bucket | Notes |
|---|---|---|
| `create_access_grant` | B | Provider-admin authority (HIPAA gate at provider org path via `has_effective_permission('grant.create', v_provider_path)`) |
| `revoke_access_grant` | B | Provider-admin authority (HIPAA gate at provider org path via `has_effective_permission('grant.revoke', v_provider_path)`) |

The descriptions are aspirational; the runtime gate-effect today is "platform-privilege fallback only."

## Why this matters

1. **Production-functional gap**: provider admins are the role the architecture says SHOULD manage their cross-tenant grants. Today they CAN'T. Platform admins can but that's not the long-term design.
2. **UAT blast radius**: any UAT that wants to verify the "real" provider-admin user-journey path (vs the platform-privilege fallback) is forced to manually grant the permissions to a test user first. Adds friction; makes the test non-repeatable across environments without cleanup.
3. **Architect-cohesion-review miss**: the PR #71 final-PR architect review verified that `partnership.manage` was seeded (Step 7b) but did not flag the missing parallel seed for the 3 `grant.*` permissions. The cohesion review checklist should grow a probe like: "every RPC whose gate is `has_effective_permission('<perm>', ...)` has `<perm>` granted in at least one role template via a `permission.granted_to_role` (or equivalent) audit-trail event."
4. **Phase 0.4 Decision C.1 cross-check**: the ADR locks "provider-admin authority" for grant emit — but the implementation is half-done. The ADR doesn't directly speak to role-template seeding, so this is an ADR ⇄ implementation cohesion gap.

## Options

### Option A — Seed via `role_permission_templates` + backfill to existing role instances (mirrors PR #71 Step 7b for `partnership.manage`)

Add a migration that:
1. Inserts 3 rows into `role_permission_templates` for `('provider_admin', 'grant.create', true)`, `('provider_admin', 'grant.revoke', true)`, `('provider_admin', 'grant.view', true)`.
2. Backfills `role_permissions_projection` for every existing `provider_admin` role instance via `role.permission.granted` events (the same pattern PR #71 Step 7b uses for `partnership.manage`).

**Pro**: matches the existing convention; backfill keeps existing assignments consistent without manual ops.
**Con**: 3 new permissions get globally granted to every `provider_admin`. This is correct semantically (the ADR says provider admins should have grant authority) but worth a privacy/compliance second-look before shipping.

### Option B — Implication chain: `partnership.manage → grant.{create,revoke,view}`

Add 3 rows to `permission_implications` so any user holding `partnership.manage` automatically derives `grant.*` via `compute_effective_permissions`.

**Pro**: zero backfill; takes effect on next token refresh.
**Con**: conceptually weird — `partnership.manage` is about the business relationship, not the per-user data grant. Conflates two concerns the ADR deliberately separated (Decision C.3 explicitly states "partnership.manage authorizes the BUSINESS RELATIONSHIP; grant.create authorizes PHI release against it"). The migration's own L825-867 docblock for `partnership.manage` calls this out: distinct from `grant.create`.

### Option C — Separate `grant_admin` sub-role within `provider_admin` hierarchy

Create a new `grant_admin` role that exists alongside `provider_admin`, with `grant.*` granted. Manage assignments separately so not every `provider_admin` gets grant authority.

**Pro**: principle of least privilege at the role level.
**Con**: new role surface; larger migration; raises governance questions (who provisions `grant_admin`?). Likely overkill for v1.

### Recommendation

**Option A**, with the privacy/compliance second-look done as part of the migration PR (architect review). This matches the existing seed convention (PR #71 Step 7b precedent) and keeps the "Provider-admin authority" matrix descriptions semantically accurate at runtime.

## Steps (Option A)

1. **Create migration**: `supabase migration new seed_grant_perms_into_provider_admin_role`. Migration body:
   - `INSERT INTO public.role_permission_templates (role_name, permission_name, is_active) VALUES ('provider_admin', 'grant.create', true), ('provider_admin', 'grant.revoke', true), ('provider_admin', 'grant.view', true) ON CONFLICT (role_name, permission_name) DO NOTHING;` (idempotent).
   - Backfill DO block: for each existing `provider_admin` role instance (`SELECT id FROM roles_projection WHERE name='provider_admin'`), emit 3 `role.permission.granted` events via `api.emit_domain_event` with `event_data = {role_id, permission_name, granted_at}` + `event_metadata = {user_id: '00...00', reason: 'Backfill: seed grant.* into provider_admin (Phase 2 PR #71 follow-up)'}`. Handler at `handle_rbac_role_permission_granted` projects to `role_permissions_projection` idempotently (codified pitfall #4 `IF NOT EXISTS` precondition).
2. **Stage E probe**: re-run the 2026-06-09 probe — expect provider_admin template with 4 permissions (`grant.create, grant.revoke, grant.view, partnership.manage`) and role_permissions_projection with 8 rows across 2 existing provider_admin instances (4 perms × 2 instances).
3. **UAT validation**: re-run Phase 2 UAT lifecycle E2E using a provider_admin user (NOT a platform-admin) to prove the "intended authority" path works end-to-end.
4. **Reachability matrix update**: the matrix entries don't change (bucket B + "Provider-admin authority"), but the implementation now matches the description.

## Out of scope

- Phase 3/4/N rollout work (parent card `cross-tenant-access-grant-rollout/`).
- Frontend integration UI for grant management (separate concern; the RPCs work — the gate just needs the permission).
- Seeding `grant.*` for other role templates (e.g., `super_admin` already has `has_platform_privilege()` so the OR fallback covers them).

## Files involved

- `infrastructure/supabase/supabase/migrations/20260601174841_cross_tenant_grant_phase_1_jwt_shape.sql` — Phase 1 originating migration that seeded the 3 `grant.*` permissions in `permissions_projection` but stopped there
- `infrastructure/supabase/supabase/migrations/20260604210910_cross_tenant_grant_phase_2_write_side.sql` § Step 7b (L820-880) — precedent pattern for "seed permission + grant to role template + backfill" that this seed card mirrors
- `documentation/architecture/authorization/cross-tenant-access-grant-rpc-reachability-matrix.md` — entries for `create_access_grant`, `revoke_access_grant`, `revoke_permission_across_grants` (the third is platform-only by design; the first two are the ones with the gap)
- `documentation/architecture/decisions/adr-cross-tenant-access-grant-jwt-shape.md` § Decision C.1 — declares "provider-admin authority" for grant emit
- `dev/active/phase-2-uat-var-partnership-lifecycle-seed.md` — UAT card that calls this out as a "production-readiness gap discovered during UAT planning"
