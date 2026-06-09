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
3. **Architect-cohesion-review miss**: the PR #71 final-PR architect review verified that `partnership.manage` was seeded (Step 7b) but did not flag the missing parallel seed for the 3 `grant.*` permissions. The cohesion review checklist should grow the following probe (S2 architect fold-in 2026-06-09 — strengthened from the original draft to cover three structural edge cases):

   > **Permission-gate-vs-role-template cohesion probe (cross-aggregate authz invariant)**
   >
   > For every `api.*` RPC whose body references a permission via `has_effective_permission('<perm>', <scope_path>)` **OR `has_permission('<perm>')`**, that `<perm>` MUST be granted in at least one row of `role_permission_templates` (or, equivalently, have an active `permission_implications` chain leading from another role-granted permission).
   >
   > **Carve-outs**:
   >
   > 1. **Intentionally platform-only RPCs** — if the gate is `has_platform_privilege()` with NO `OR has_effective_permission/has_permission` clause (e.g., `api.revoke_permission_across_grants`), the RPC is platform-admin-only by design and should NOT have a corresponding role-template entry. The probe MUST recognize this shape and skip those RPCs.
   >
   > 2. **`scope_type` catalog ⇄ runtime gate divergence** — if the permission's `permissions_projection.scope_type` is `'global'` but the gating RPC uses the scope-typed form `has_effective_permission(perm, <ltree_path>)`, this is a catalog/runtime divergence (works today because `compute_effective_permissions` derives scope from `user_roles_projection.scope_path`, but the conceptual mismatch is real). Either reclassify the catalog `scope_type` to `org`/`org_unit`, or document the structural rationale for why a global-typed permission is being scope-checked at runtime. The Phase 1 `grant.*` permissions match this divergent shape and warrant the explicit documentation (the gate's scope-typed check enforces tenancy at the provider org path even though the permission is catalog-global).
   >
   > **Audit query** (parametric for future architect-cohesion reviews):
   >
   > ```sql
   > WITH gate_refs AS (
   >   -- regex-extract has_effective_permission('<perm>', ...) AND has_permission('<perm>') from api.* bodies
   >   SELECT p.proname AS rpc,
   >          (regexp_matches(pg_get_functiondef(p.oid),
   >                          'has_(?:effective_)?permission\s*\(\s*''([^'']+)''', 'g'))[1] AS perm,
   >          CASE WHEN pg_get_functiondef(p.oid) ~ 'has_effective_permission\s*\(\s*''([^'']+)'''
   >               THEN 'has_effective_permission' ELSE 'has_permission' END AS gate_kind
   >   FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
   >   WHERE n.nspname='api'
   > ),
   > platform_only AS (
   >   SELECT p.proname AS rpc FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
   >   WHERE n.nspname='api'
   >     AND pg_get_functiondef(p.oid) ~ 'has_platform_privilege\s*\(\)'
   >     AND pg_get_functiondef(p.oid) !~ 'OR\s+has_(?:effective_)?permission'
   > )
   > SELECT g.rpc, g.perm, g.gate_kind, pp.scope_type AS catalog_scope_type
   > FROM gate_refs g
   > LEFT JOIN public.permissions_projection pp ON pp.name = g.perm
   > WHERE NOT EXISTS (SELECT 1 FROM public.role_permission_templates rpt
   >                   WHERE rpt.is_active=true AND rpt.permission_name = g.perm)
   >   AND NOT EXISTS (SELECT 1 FROM platform_only po WHERE po.rpc = g.rpc);
   > -- Every result row is a candidate defect (gate-perm in zero templates AND RPC isn't platform-only).
   > ```
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

1. **Create migration**: `supabase migration new seed_grant_perms_into_provider_admin_role`. Migration body mirrors PR #71 Step 7b precedent **verbatim** (S1 architect fold-in 2026-06-09 — the prior draft incorrectly proposed event-emit backfill; precedent uses direct INSERT). Step 7b reference: migration `20260604210910...sql:879-894`.

   ```sql
   -- 1a — Extend the template (idempotent)
   INSERT INTO public.role_permission_templates (role_name, permission_name, is_active)
   VALUES
     ('provider_admin', 'grant.create', true),
     ('provider_admin', 'grant.revoke', true),
     ('provider_admin', 'grant.view',   true)
   ON CONFLICT (role_name, permission_name) DO NOTHING;

   -- 1b — Backfill: direct INSERT into role_permissions_projection (NOT event-emit).
   -- Mirrors PR #71 Step 7b L879-894 precedent. Audit trail is the migration commit
   -- itself; events are the wrong layer for this kind of bulk-template-extension.
   INSERT INTO public.role_permissions_projection (role_id, permission_id, granted_at)
   SELECT rp.id AS role_id, pp.id AS permission_id, now() AS granted_at
   FROM public.roles_projection rp
   CROSS JOIN public.permissions_projection pp
   WHERE rp.name = 'provider_admin' AND rp.deleted_at IS NULL
     AND pp.applet = 'grant' AND pp.action IN ('create', 'revoke', 'view')
   ON CONFLICT (role_id, permission_id) DO NOTHING;
   ```

2. **Stage E probe** (parametric per N2 fold-in 2026-06-09): assert `expected_rows = (perm_count_in_template × provider_admin_instance_count)`. Snapshot of dev 2026-06-09: 2 provider_admin instances pre-migration with 2 rows (`partnership.manage` × 2); Option A adds 6 new rows (3 perms × 2 instances); total post-migration 8 rows. Production may have different instance counts — write the probe as the parametric assertion above, not the snapshot count. Idempotency: re-running the migration produces zero new rows.

3. **UAT validation**: re-run Phase 2 UAT lifecycle E2E using a provider_admin user (NOT a platform-admin) to prove the "intended authority" path works end-to-end.

4. **Reachability matrix update**: the matrix entries don't change (bucket B + "Provider-admin authority"), but the implementation now matches the description.

## Out of scope

- Phase 3/4/N rollout work (parent card `cross-tenant-access-grant-rollout/`).
- Frontend integration UI for grant management (separate concern; the RPCs work — the gate just needs the permission).
- Seeding `grant.*` for other role templates (e.g., `super_admin` already has `has_platform_privilege()` so the OR fallback covers them).
- **Sibling defect with the same shape** (N1 architect fold-in 2026-06-09): `api.get_failed_events_with_detail` gated on `has_permission('platform.view_event_details')` with no `has_platform_privilege()` fallback. **RESOLVED 2026-06-09** by bundling Design B (architectural consolidation, NOT the original "seed the permission" plan) into the same migration as this card's Section A. Section B of `20260609212115_seed_grant_perms_into_provider_admin_and_fix_failed_events_detail_gate.sql` consolidates the gate to `has_platform_privilege()` uniformly and retires the granular permission as YAGNI — `platform.*` family reduces to `{platform.admin}` only. Companion archive: `dev/archived/seed-platform-view-event-details-permission-seed.md`.

## Files involved

- `infrastructure/supabase/supabase/migrations/20260601174841_cross_tenant_grant_phase_1_jwt_shape.sql` — Phase 1 originating migration that seeded the 3 `grant.*` permissions in `permissions_projection` but stopped there
- `infrastructure/supabase/supabase/migrations/20260604210910_cross_tenant_grant_phase_2_write_side.sql` § Step 7b (L820-880) — precedent pattern for "seed permission + grant to role template + backfill" that this seed card mirrors
- `documentation/architecture/authorization/cross-tenant-access-grant-rpc-reachability-matrix.md` — entries for `create_access_grant`, `revoke_access_grant`, `revoke_permission_across_grants` (the third is platform-only by design; the first two are the ones with the gap)
- `documentation/architecture/decisions/adr-cross-tenant-access-grant-jwt-shape.md` § Decision C.1 — declares "provider-admin authority" for grant emit
- `dev/active/phase-2-uat-var-partnership-lifecycle-seed.md` — UAT card that calls this out as a "production-readiness gap discovered during UAT planning"
