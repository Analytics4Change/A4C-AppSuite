# Phase 1 — JWT shape migration (cross-tenant access grant rollout)

**Status**: seed (awaiting architect-review pass on this plan before any migration SQL is drafted)
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

- **Current `compute_effective_permissions`**: lives in `infrastructure/supabase/supabase/migrations/20260226002002_organization_manage_page_phase1.sql` (NOT baseline_v4 — it was REPLACED there). Read in full before drafting step 1.
- **`process_access_grant_event`**: `baseline_v4.sql:10417-10451` (`access_grant.created` branch). Step 10 extends with `policy_override_applied`; step 14 extends `created` to populate `authorization_reference`.
- **`cross_tenant_access_grants_projection`**: `baseline_v4.sql:12468` (column list incl. `permissions jsonb DEFAULT '[]'::jsonb` + `authorization_type text`).
- **RPC registry**: `frontend/src/services/api/rpc-registry.generated.ts`, generator at `frontend/scripts/gen-rpc-registry.cjs`. Phase 1 step 8 re-tags 10 RPCs; step 12 mirrors the generator for the reachability matrix.
- **Reachability matrix doc**: post-step-13 transitions from hand-edited to generated artifact. CI workflow at `.github/workflows/rpc-reachability-matrix-sync.yml` (NEW in step 13).

## Pre-flight checks (must pass before drafting the migration file)

- [ ] **Row-count probe**: `SELECT COUNT(*) FROM public.cross_tenant_access_grants_projection;` returns 0 on dev (per ADR step 14 pre-flight; if non-zero, the `authorization_reference` backfill needs care).
- [ ] **Five-tier JWT consumer audit** (see ADR § JWT consumer audit). Any tier that materializes `effective_permissions` via map-by-key (`{p1: s1}` shape) breaks under multi-entry-per-permission and MUST be patched in the same PR. Tiers:
  - [ ] PL/pgSQL helpers — `public.has_permission`, `public.has_effective_permission`, `public.get_permission_scope`. The first two use EXISTS/ANY → safe; the third does `LIMIT 1` → **the tripwire**.
  - [ ] Frontend — `frontend/src/services/auth/` claim parsing and any code that materializes claims into a `{perm: scope}` map.
  - [ ] Edge Functions — `_shared/` claim helpers + per-EF claim reads. Audit: `grep -rn "'effective_permissions'\\|\"effective_permissions\"" infrastructure/supabase/supabase/functions/`.
  - [ ] Workflows — Temporal activity claim parsing; `workflows/src/types/database.types.ts` consumes the generated type.
  - [ ] RLS — policy bodies invoking `has_permission` / `has_effective_permission`. Safe by delegation IF the PL/pgSQL helpers are safe.
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

## Architect-review gate

Per the parent card's tasks.md 0.6 ("Architect review of the design doc before any Phase 1 work begins (mirror PR #67's plan-review architect pass)"), this card requires an architect-review pass on **this plan** BEFORE any migration SQL is drafted. The review surfaces structural issues at the cheap stage.

Review request: `Agent software-architect-dbc` with prompt:
> Review `dev/active/cross-tenant-grant-phase-1-jwt-shape/plan.md` against ADR `documentation/architecture/decisions/adr-cross-tenant-access-grant-jwt-shape.md` § Consequences. Surface (a) any drift between this plan and the ADR's 15-step manifest, (b) gaps in the pre-flight checklist, (c) violations of the 6 architectural constraints, (d) missing reference material, (e) anti-patterns or design-by-contract gaps that should be addressed before drafting the migration file.

## Smoke / UAT strategy

Per the parent card's "Operational reminders" and the PR #67 precedent:

- **Transactional smoke harness**: `BEGIN; ... ROLLBACK;` against dev with JWT-claim simulation via `set_config('request.jwt.claims', ...)` (see `memory/simulate-jwt-claims-for-rpc-test.md`). Exercise:
  - Single-org user (today's shape) — JWT structure unchanged, permission counts unchanged.
  - Hypothetical multi-org consultant (simulated grant row) — JWT includes grant-derived entries; `has_effective_permission` returns TRUE at grant scope; `accessible_organizations @>` returns TRUE at grant target org.
  - DISTINCT ON edge cases per ADR Decision A worked examples (role-only widens; grant + role at same scope collapses; cross-tenant grants stay distinct).
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
