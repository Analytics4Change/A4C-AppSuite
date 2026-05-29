# Phase 1 — JWT shape migration (cross-tenant access grant rollout)

**Status**: architect-reviewed 2026-05-29 (verdict APPROVE WITH IN-PR FIXES; all 4 must-fix + 3 of 4 nits folded into commit on this branch; N4 cosmetic auto-fixes under step 13). Ready for Stage B pre-flight probes.
**Priority**: High (unblocks Phases 2–5 of `cross-tenant-access-grant-rollout/`; closes the PR #67 operational tripwire — the two legacy `get_permission_scope + manual @>` callers break the moment DISTINCT ON is relaxed)
**Origin**: PR #68 (`feat/cross-tenant-access-grant-phase-0-design`) merge commit `ffad05aa` (2026-05-28). Phase 0 of `cross-tenant-access-grant-rollout/` closed with 6 locked decisions and a 15-step migration manifest. This card implements that manifest.
**Parent card**: `dev/active/cross-tenant-access-grant-rollout/` (umbrella; stays open for Phases 2–N)
**Branch**: `feat/cross-tenant-grant-phase-1-jwt-shape` (branched from `main` per branch-on-decision rule, before this seed was written)

## Why this card exists

PR #68 produced the canonical ADR `documentation/architecture/decisions/adr-cross-tenant-access-grant-jwt-shape.md` with a 15-step Phase 1 migration manifest in § Consequences. The manifest is the single source of truth — this card is its execution vehicle.

Phase 1 ships a single transactional migration that:

1. **Extends `compute_effective_permissions`** to emit grant-derived permissions (Path B JWT shape).
2. **Tightens the outer `DISTINCT ON (permission_name)`** to `DISTINCT ON (permission_name, scope_path)` — enables multi-scope grants while deduping exact duplicates.
3. **Must-pair normalization** of 10 legacy `get_permission_scope + manual @>` two-step callers to single `has_effective_permission(perm, path)` calls — closes the operational tripwire from PR #67.
4. Adds `cross_tenant_access_grants_projection.authorization_reference` column + populating handler branch + CHECK constraint.
5. Creates `grant_role_templates` table + seeds `var_default` template (4 `partner.*` permission rows).
6. Ships codegen + CI workflow for the RPC reachability matrix (transitioning that doc from hand-edited to generated artifact).

## Reference material (READ BEFORE starting Phase 1 work)

### Canonical sources

- **ADR** `documentation/architecture/decisions/adr-cross-tenant-access-grant-jwt-shape.md` — read in full. The 15-step manifest is in § Consequences → Phase 1 migration manifest. The five-tier JWT consumer audit checklist is in § JWT consumer audit. The two non-negotiable invariants are at the end of § Consequences.
- **Reachability matrix** `documentation/architecture/authorization/cross-tenant-access-grant-rpc-reachability-matrix.md` — per-RPC consultant-callability decisions. Phase 1's must-pair normalization set (10 RPCs) is enumerated under § Phase 1 must-pair normalization.
- **Provider partners architecture** `documentation/architecture/data/provider-partners-architecture.md` — full background, RLS pattern, the 5-value `authorization_type` set.

### Memory files (in `~/.claude/projects/-home-lars-dev-A4C-AppSuite/memory/`)

- **`pr-67-close-out.md`** — the operational tripwire this card resolves. The four-site distribution of the legacy two-step pattern is documented here.
- **`feedback-branch-on-decision.md`** — branch-on-decision rule: the Phase 1 branch was created from `main` BEFORE this seed was written.
- **`feedback-no-deferral-to-cards.md`** — in-PR fixes over follow-up cards. Reviewer findings get folded into the open PR, not deferred.

### Codebase touch points

- **Current `compute_effective_permissions`**: lives in `baseline_v4.sql:6932-6985` (never replaced post-baseline). Read in full before drafting step 1. *(Plan-review fix F1, 2026-05-29 — prior version incorrectly pointed at `20260226002002_*.sql`, which replaces only the auth hook.)*
- **Current `custom_access_token_hook`**: lives in `infrastructure/supabase/supabase/migrations/20260226002002_organization_manage_page_phase1.sql` (REPLACED there; adds the `org.is_active` gate + `access_blocked` claim branch + the exception branch at baseline_v4:7167-7184). ADR step 3 mandates Phase 1 rebases the hook on **this** body, not baseline.
- **`process_access_grant_event`**: `baseline_v4.sql:10417-10451` (`access_grant.created` branch). Step 10 extends with `policy_override_applied`; step 14 extends `created` to populate `authorization_reference`.
- **`cross_tenant_access_grants_projection`**: `baseline_v4.sql:12468` (column list incl. `permissions jsonb DEFAULT '[]'::jsonb` + `authorization_type text`).
- **Existing `idx_access_grants_consultant_user`**: `baseline_v4.sql:14103` — single-column partial `WHERE consultant_user_id IS NOT NULL`. Step 6's new composite partial does NOT replace it; **both stay**. Existing index serves user-keyed lookups (e.g., the Phase 2 emit RPC's pre-flight); new composite serves the auth-hook's `(consultant_user_id, status='active')` access pattern. *(Plan-review nit N1, 2026-05-29.)*
- **RPC registry**: `frontend/src/services/api/rpc-registry.generated.ts`, generator at `frontend/scripts/gen-rpc-registry.cjs`. Phase 1 step 8 re-tags 10 RPCs; step 12 mirrors the generator for the reachability matrix.
- **Reachability matrix doc**: post-step-13 transitions from hand-edited to generated artifact. CI workflow at `.github/workflows/rpc-reachability-matrix-sync.yml` (NEW in step 13).

## Pre-flight checks (must pass before drafting the migration file)

*(Plan-review F3 + F6 + N2 expansions, 2026-05-29 — original 4-item list expanded with schema non-collision, 10-RPC verify, auth-hook baseline-latency, claims_version distribution, and RPC count re-verify probes; five-tier audit annotated with architect's per-tier probe results.)*

- [ ] **Row-count probe** (paired to step 14): `SELECT COUNT(*) FROM public.cross_tenant_access_grants_projection;` returns 0 on dev. If non-zero, the `authorization_reference` backfill needs care.
- [ ] **Schema non-collision probe** (paired to step 2): `permission_implications.propagate_through_grants` must NOT already exist on dev. Verify via `\d public.permission_implications` (or `information_schema.columns` query) shows no such column. Architect's 2026-05-29 probe: `grep -rn "propagate_through_grants" infrastructure/supabase/supabase/migrations/` returned empty → safe today, but a concurrent PR could land it before Phase 1 ships.
- [ ] **10-RPC two-step-pattern verification** (paired to step 7): re-grep each of the 10 RPCs' latest canonical body files for `get_permission_scope` immediately before drafting the migration. Confirm all 10 still match the expected scope-perm names from the matrix doc § Phase 1 must-pair normalization. If any has been refactored mid-flight by a concurrent PR, adjust step 7's scope accordingly. Architect's 2026-05-29 probe confirmed all 10 still on the legacy pattern (per-RPC body-file table in the F3 finding).
- [ ] **Auth-hook baseline-latency capture** (paired to step 6 + ADR § Performance and JWT-size considerations): measure `EXPLAIN ANALYZE` on `SELECT compute_effective_permissions(<user>, <org>)` against dev BEFORE the migration; record p50/p95 over 100 invocations for a representative single-org user. **Stage E's post-deploy re-measure is meaningful only against this baseline.**
- [ ] **`claims_version` JWT distribution probe** (paired to step 3): verify all extant dev sessions are at v4 (not v3 or NULL). `SELECT raw_app_meta_data->>'claims_version' AS cv, COUNT(*) FROM auth.users GROUP BY 1` via Management API SQL endpoint. Any non-v4 population means step 3's bump-to-5 lands alongside two distinct prior shapes.
- [ ] **RPC count re-verification** (paired to step 11): `grep -c "^CREATE OR REPLACE FUNCTION \"api\"\\." infrastructure/supabase/supabase/migrations/*.sql` net-of-DROPs equals 104 (current per matrix doc). Identify any post-2026-05-26 new `api.*` RPCs lacking matrix classification: `git log --since=2026-05-26 -p -- infrastructure/supabase/supabase/migrations/ | grep -E "^\\+CREATE OR REPLACE FUNCTION \"api\""`. Each needs an explicit `@a4c-bucket` decision in the matrix doc BEFORE the migration drafts.
- [ ] **Five-tier JWT consumer audit** (see ADR § JWT consumer audit). Any tier that materializes `effective_permissions` via map-by-key (`{p1: s1}` shape) breaks under multi-entry-per-permission and MUST be patched in the same PR. Tiers (with architect's 2026-05-29 probe results):
  - [ ] **PL/pgSQL helpers** — `public.has_permission`, `public.has_effective_permission`, `public.get_permission_scope`. The first two use EXISTS/ANY → safe; the third does `LIMIT 1` → **the tripwire**. Step 7's normalization removes both remaining call sites.
  - [ ] **Frontend** — `frontend/src/services/auth/SupabaseAuthProvider.ts:385-393` uses `.some(ep => ep.p === permission)` → **duplicate-safe**. Audit any new code that materializes claims into a `{perm: scope}` map.
  - [ ] **Edge Functions** — `_shared/types.ts:57-72` uses `.some(ep => ep.p === permission)` → **duplicate-safe**. `manage-user/index.ts:206` delegates to the same helper. Audit additions: `grep -rn "'effective_permissions'\\|\"effective_permissions\"" infrastructure/supabase/supabase/functions/`.
  - [ ] **Workflows** — `workflows/src/api/middleware/auth.ts:140` does `(jwtPayload.effective_permissions ?? []).map(ep => ep.p)` then `.includes(permission)` → **duplicate-safe** (flat-array `.includes` is correct under duplicates). Comment at L132-135 needs a one-line update to note multi-entry tolerance (no behavior change; see Stage D).
  - [ ] **RLS** — policy bodies invoking `has_permission` / `has_effective_permission`. Safe by delegation IF the PL/pgSQL helpers are safe.
- [ ] **Concurrency check** — no in-flight PR on `main` touches `compute_effective_permissions` (avoid merge conflict on a critical function).
- [ ] **Baseline build** — `frontend/package.json` and `workflows/package.json` builds pass against the current generated types (so a regen-induced break is attributable to this PR alone).

## Phase 1 work breakdown

The 15-step manifest is in the ADR § Consequences → Phase 1 migration manifest. **Do not duplicate it here** — that's the F1/F6 drift class the PR #68 cohesion review eliminated. `tasks.md` tracks per-step progress; the ADR is the authoritative specification.

**Operational-tripwire must-pair set**: steps 1, 7, 8 ship together or not at all. Splitting them produces intermittent permission failures for multi-scope users because `get_permission_scope`'s `LIMIT 1` picks arbitrarily from the relaxed multi-entry permission set.

## Architectural constraints (do not violate)

1. **Single transactional migration.** All 15 steps land in ONE migration file. Step 5 (backfill) is a `DO $$ ... $$;` block within that same file. Splitting steps across migrations breaks the must-pair invariant and exposes the operational tripwire mid-deploy.
2. **`migration-session SET search_path`** at top of the file. Mandatory under the PR #67 codified rule for any migration that uses extension-typed parameters — and step 1's `compute_effective_permissions` signature passes `ltree`-derived paths through CTE. See `infrastructure/supabase/CLAUDE.md` § "Migration-session SET search_path gotcha".
3. **`grant_role_templates` is a NEW table** — NOT a flag on `role_permission_templates`. (Phase 0.4 Decision B.1.)
4. **`permission_implications.propagate_through_grants` defaults to FALSE** — HIPAA least-authority. Future implications opt in.
5. **`cross_tenant_access_grants_projection.permissions` jsonb is the JWT wire contract** — any reshape MUST pair with a `claims_version` bump and the five-tier consumer audit. See ADR § Non-negotiable invariant: `permissions jsonb` shape.
6. **Grant projection has no consultant-write path** — no INSERT/UPDATE/DELETE RLS policy may be added. Writes are exclusively event-sourced via SECURITY DEFINER handlers. See ADR § Non-negotiable invariant: grant projection.
7. **Step 7/8 internal ordering** *(Plan-review F2, 2026-05-29)*: within the single transactional migration, draft the 10 step-7 `CREATE OR REPLACE FUNCTION` bodies in this order: **(1)** 5 OU mutators (`create/update/delete/deactivate/reactivate_organization_unit`), **(2)** 2 role-management mutations (`bulk_assign_role`, `sync_role_assignments`), **(3)** 3 OU readers (`get_organization_unit_by_id`, `get_organization_unit_descendants`, `get_organization_units`). Step 8's M3 re-tag `COMMENT ON FUNCTION` statements MUST come AFTER each function's `CREATE OR REPLACE` — interleave or block-at-end (either acceptable), but a `COMMENT` preceding its function is a syntax error against a not-yet-existing signature. Convention precedent: `20260430002824_strip_processing_error_detail_with_admin_rpc.sql` (COMMENT-after-CREATE).

## Function contracts (DBC) — write these against the ADR before drafting SQL

*(Plan-review F4, 2026-05-29 — added so Stage E smoke harness verifies specs directly rather than reverse-engineering SQL behavior. Mirrors the PR #67 plan-review precedent of pinning the three-step skeleton contract up front.)*

The Phase 1 migration writes/extends four functions. Pin their contracts here so the implementation has explicit pre/post/invariant criteria.

### `compute_effective_permissions(p_user_id uuid, p_org_id uuid) RETURNS TABLE(...)` — extended (step 1)

- **Preconditions**:
  - `p_user_id` is a valid `auth.users.id`; `p_org_id` is a valid `public.organizations.id`.
  - Function declared `SECURITY DEFINER` (preserved from baseline `baseline_v4.sql:6932-6985`).
- **Postconditions**:
  - Output relation has at-most-one row per `(permission_name, scope_path)` tuple (tightened from at-most-one-per-`permission_name`).
  - **Role-source rows**: widened by `nlevel(scope_path) ASC` per existing behavior (widest wins per permission; ties broken arbitrarily — pre-existing semantics preserved).
  - **Grant-source rows**: emitted at the grant's scope without widening. Filtered by `status='active' AND (expires_at IS NULL OR expires_at > now())` on `cross_tenant_access_grants_projection`.
  - **Implication-propagated rows**: included IFF the source `permission_implications` row has `propagate_through_grants=true`; default FALSE → grant-derived permissions do NOT implicitly widen (HIPAA least-authority per Decision B.2).
- **Invariants**:
  - Single read path: function reads `cross_tenant_access_grants_projection.permissions jsonb` directly; **no template join** at issuance (per Decision B hybrid snapshot).
  - Auth-hook integration unchanged: `custom_access_token_hook` continues to call this function with the same signature; only the output multiplicity expands.
  - Output is duplicate-safe-by-consumer: PL/pgSQL helpers use EXISTS/ANY; frontend/EF/workflows use `.some()` / `.includes()` on flattened keys (all verified duplicate-safe by architect 2026-05-29 audit).

### `sync_accessible_organizations_from_grants() RETURNS trigger` — NEW (step 4)

- **Preconditions**:
  - Trigger fires AFTER INSERT OR UPDATE OR DELETE on `cross_tenant_access_grants_projection` (DML-row trigger; not statement-level).
- **Postconditions**:
  - For each affected `consultant_user_id` (or `consultant_org_id`-matched home-org users when `consultant_user_id IS NULL`), `public.users.accessible_organizations` is recomputed as the UNION of: **(a)** orgs sourced from `user_organizations_projection` via the existing `sync_accessible_organizations` trigger; **(b)** `provider_org_id`s from active in-window grant rows.
  - On status flip `'active' → 'revoked'` (or expiration via the `access_grant.expired` event-driven mutation per ADR step 4 note): provider org is REMOVED from `accessible_organizations` IFF no other active grant covers it (the UNION recomputation handles this naturally).
- **Invariants**:
  - Trigger NEVER removes orgs sourced from `user_organizations_projection`. Two sources, one UNION.
  - Idempotent: rerun on identical projection state yields identical `accessible_organizations`.
  - Single membership oracle preserved: the trigger ensures `public.users.accessible_organizations` remains the canonical membership predicate even after grants land (the `@>` convention from PR #66/#67 still holds).

### `process_access_grant_event.access_grant.policy_override_applied` — NEW handler branch (step 10)

- **Preconditions**:
  - `p_event.event_data->'permissions'` is the new resolved permission jsonb array (well-formed; same shape as `cross_tenant_access_grants_projection.permissions`).
  - `p_event.event_data->>'override_reason'` is non-empty (HIPAA audit-trail requirement; enforced at handler entry).
  - Target grant row identified by `p_event.stream_id` (per the global rule "use `stream_id`, not `aggregate_id`").
- **Postconditions**:
  - Matching grant row's `permissions jsonb` is **REPLACED** (NOT merged) with `event_data->'permissions'`.
  - Grant row's `updated_at` is bumped.
  - No other grant fields modified (NOT `status`, NOT `scope`, NOT `consultant_*`, NOT `authorization_*`, NOT `expires_at`).
- **Invariants**:
  - Handler is purely projective (no event emission from within). Phase 1 ships **handler-only**; emit RPC `api.revoke_permission_across_grants` deferred to Phase 2 per Decision B.3.
  - The replacement is byte-exact: future re-emission of identical override events is idempotent on the projection.

### `process_access_grant_event.access_grant.created` — EXTENDED handler branch (step 14)

- **Precondition delta**:
  - `p_event.event_data->>'authorization_reference'` is either a valid UUID or NULL.
  - NULL allowed IFF `p_event.event_data->>'authorization_type' = 'emergency_access'` (per CHECK from step 14 + the type CHECK from step 9).
- **Postcondition delta**:
  - Created grant row's `authorization_reference` column populated from event payload (NEW column from step 14).
- **Invariants preserved**:
  - Existing branch behavior (creating the projection row, populating `permissions jsonb`, `expires_at`, etc.) unchanged. The extension is column-additive only.
  - All existing event-handler rules (Rule 7.1 reference-file discipline, ELSE-clause `RAISE EXCEPTION` ERRCODE) preserved.

## Architect-review gate

Per the parent card's tasks.md 0.6 ("Architect review of the design doc before any Phase 1 work begins (mirror PR #67's plan-review architect pass)"), this card requires an architect-review pass on **this plan** BEFORE any migration SQL is drafted. The review surfaces structural issues at the cheap stage.

Review request: `Agent software-architect-dbc` with prompt:
> Review `dev/active/cross-tenant-grant-phase-1-jwt-shape/plan.md` against ADR `documentation/architecture/decisions/adr-cross-tenant-access-grant-jwt-shape.md` § Consequences. Surface (a) any drift between this plan and the ADR's 15-step manifest, (b) gaps in the pre-flight checklist, (c) violations of the 6 architectural constraints, (d) missing reference material, (e) anti-patterns or design-by-contract gaps that should be addressed before drafting the migration file.

## Smoke / UAT strategy

Per the parent card's "Operational reminders" and the PR #67 precedent:

- **Transactional smoke harness**: `BEGIN; ... ROLLBACK;` against dev with JWT-claim simulation via `set_config('request.jwt.claims', ...)` (see `memory/simulate-jwt-claims-for-rpc-test.md`). Exercise:
  - Single-org user (today's shape) — JWT structure unchanged, permission counts unchanged.
  - Hypothetical multi-org consultant (simulated grant row) — JWT includes grant-derived entries; `has_effective_permission` returns TRUE at grant scope; `accessible_organizations @>` returns TRUE at grant target org.
  - **DISTINCT ON edge cases** per ADR Decision A worked examples *(F5 expansion 2026-05-29)*:
    - role-only widens by `nlevel ASC` (e.g., `provider_admin @ acme.pediatrics` + `@ acme.psychiatry` collapses to one row at widest)
    - grant + role at **SAME** scope collapses to one row (no JWT bloat)
    - cross-tenant grants at distinct provider orgs stay distinct (multi-entry preservation)
    - **grant + role at DIFFERENT scopes for the SAME permission yields TWO rows** — canonical multi-entry preservation case (not in ADR worked examples; added per architect 2026-05-29 review)
    - **collapsed-row source-tier verified UNDEFINED** — no downstream code may rely on which source (role vs grant) wins the DISTINCT ON when both match same `(perm, path)`; pinning this prevents accidental future reliance
  - **HIPAA implication-propagation invariant** (highest-stakes contract in Phase 1) *(F5)*: `propagate_through_grants=false` (default) means a `permission_implications` row mapping `client.view_phi → client.view_records` does NOT propagate for a grant of `client.view_phi`. Verify by inserting both (the implication with flag=false; a grant for the base permission), simulating a grant-only consultant, asserting `client.view_records` is NOT in the JWT.
  - **Revoke pathway for `sync_accessible_organizations_from_grants`** *(F5)*: UPDATE `status` `'active'` → `'revoked'` on a grant removes the provider org from `accessible_organizations` IFF no other active grant covers it. Exercise both branches (revoke-with-other-coverage = stays; revoke-without = removed).
- **CI gates** (must pass): `Deploy Database Migrations` (Validate + Deploy), `RPC Shape Registry Sync` (post step-8 re-tag), `RPC Reachability Matrix Sync` (NEW workflow in step 13 — first run on this PR validates the codegen).
- **Pre-PR-open**: deploy to dev + smoke (per `pr-60-61-pre-deploy-ritual.md` lesson). Migration involves config-dependent behavior (JWT-hook trigger from `auth.users`), so local-only validation is insufficient.

## Out of scope (deferred to subsequent phases)

- **Grant creation/revocation RPCs** — Phase 2 (`api.create_access_grant` per ADR Decision C.1; revocation flow per Decision C.5). Phase 1 ships the `policy_override_applied` event handler ONLY (no emit RPC).
- **`api.list_users` tenancy guard refactor** — Phase 3. The early-return guard `IF NOT (has_platform_privilege() OR p_org_id = get_current_org_id())` is forward-incompatible with consultants; cleanest delayed until Phase 1's grant-derived permissions are in JWT.
- **Bucket D RLS audit** (~88 entity-lookup RPCs) — Phase 4. Largest single piece of work in the rollout.
- **UI flows** — Phase 5.
- **Per-authorization-type backing tables** beyond `grant_role_templates` `var_default` seed — Phase 2+ per ADR § Phase N partitioning (court_orders, social_services_assignments, family_consents, var_partnerships — the latter scaffolds in ADR Decision C.3 but is not part of Phase 1 work).

## Definition of Done

- [ ] All 15 manifest steps shipped in a single transactional migration file.
- [ ] Pre-flight five-tier audit complete; any breaking tier patched in same PR.
- [ ] Generated types regenerated: `frontend/src/types/database.types.ts` AND `workflows/src/types/database.types.ts`.
- [ ] `rpc-registry.generated.ts` regenerated; `UncategorizedRpcs = never`.
- [ ] NEW workflow `rpc-reachability-matrix-sync.yml` green on first run.
- [ ] Documentation reconciled: `provider-partners-architecture.md` L324 `authorization_type` list updated to 5 values (already done in PR #68's F1 fix — verify).
- [ ] Transactional smoke harness exercised on dev (single-org + simulated multi-org consultant + DISTINCT ON edge cases).
- [ ] Architect-reviewed (verdict at minimum APPROVE WITH IN-PR FIXES).
- [ ] CI green on PR: Deploy Database Migrations validate path + RPC Shape Registry Sync + RPC Reachability Matrix Sync.
- [ ] Deployed to dev + manual smoke per PR open ritual.
- [ ] Post-merge: Deploy Database Migrations green; no production alerts on auth-hook latency.
