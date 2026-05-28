# Tasks — cross-tenant-grant Phase 1 JWT shape migration

> **Manifest source of truth**: ADR `documentation/architecture/decisions/adr-cross-tenant-access-grant-jwt-shape.md` § Consequences → Phase 1 migration manifest (15 ordered steps). This file tracks per-step *progress*; it does NOT duplicate the manifest content.

## Stage A — Plan gate

- [ ] Read ADR `adr-cross-tenant-access-grant-jwt-shape.md` in full
- [ ] Read reachability matrix `cross-tenant-access-grant-rpc-reachability-matrix.md` in full
- [ ] Read parent card `dev/active/cross-tenant-access-grant-rollout/` plan.md + tasks.md "Phase 0 — Outcomes" section
- [ ] Read memory files: `pr-67-close-out.md`, `feedback-branch-on-decision.md`, `feedback-no-deferral-to-cards.md`
- [ ] Read current `compute_effective_permissions` implementation in `20260226002002_organization_manage_page_phase1.sql`
- [ ] Read `process_access_grant_event` `access_grant.created` branch (`baseline_v4.sql:10417-10451`)
- [ ] **Architect review of plan.md** (`software-architect-dbc` per plan.md § Architect-review gate)
- [ ] Address architect-review findings in plan.md before any migration SQL drafted

## Stage B — Pre-flight checks (per plan.md § Pre-flight checks)

- [ ] Row-count probe on dev: `SELECT COUNT(*) FROM public.cross_tenant_access_grants_projection;` returns 0
- [ ] Five-tier JWT consumer audit complete; breaking tiers identified
- [ ] Concurrency check: no in-flight PR on `main` touching `compute_effective_permissions`
- [ ] Baseline build green: `frontend` + `workflows` build against current generated types

## Stage C — Migration drafting (the 15 manifest steps)

Each checkbox = one manifest step. Refer to ADR § Consequences → Phase 1 migration manifest for the canonical specification.

- [ ] **Step 1** — `compute_effective_permissions`: asymmetric `DISTINCT ON (permission_name, scope_path)` + `grant_derived_perms` CTE + implication flag gating
- [ ] **Step 2** — `permission_implications.propagate_through_grants boolean NOT NULL DEFAULT false`
- [ ] **Step 3** — `custom_access_token_hook` rebase on `20260226002002_*` body; `claims_version` bump to 5
- [ ] **Step 4** — `sync_accessible_organizations_from_grants()` function + trigger on `cross_tenant_access_grants_projection`
- [ ] **Step 5** — One-time backfill `DO $$ ... $$;` block for existing active grants (idempotent dedup)
- [ ] **Step 6** — Composite partial index `idx_access_grants_consultant_user_status_partial` (auth-hook query gap)
- [ ] **Step 7** — Normalize 10 C-legacy RPCs to single `has_effective_permission(perm, path)` call
  - Role-management mutations (2): `api.bulk_assign_role`, `api.sync_role_assignments`
  - OU mutators (5): `create/update/delete/deactivate/reactivate_organization_unit`
  - OU readers (3): `get_organization_unit_by_id`, `get_organization_unit_descendants`, `get_organization_units`
- [ ] **Step 8** — M3 RPC Shape Registry re-tag for all 10 RPCs from step 7 + post-migration `UncategorizedRpcs = never` assertion
- [ ] **Step 9** — `cross_tenant_access_grants_projection_authorization_type_check` CHECK constraint (5 values)
- [ ] **Step 10** — `access_grant.policy_override_applied` handler (handler-only, no emit RPC) + emit `permission.defined` for 3 grant perms + 4 partner perms
- [ ] **Step 11** — Backfill `@a4c-bucket` / `@a4c-consultant-callable*` / `@a4c-phase-target` COMMENT tags on all 104 `api.*` RPCs
- [ ] **Step 12** — Ship `frontend/scripts/gen-rpc-reachability-matrix.cjs` codegen
- [ ] **Step 13** — Ship `.github/workflows/rpc-reachability-matrix-sync.yml` CI workflow + matrix doc transitions to generated artifact
- [ ] **Step 14** — `authorization_reference uuid` column + CHECK + partial index + `process_access_grant_event.access_grant.created` branch extension
- [ ] **Step 15** — `CREATE TABLE public.grant_role_templates` + RLS policies + indexes + `var_default` seed (4 rows)

## Stage D — Post-migration deliverables (same Phase 1 PR)

- [ ] Regenerate `frontend/src/types/database.types.ts`
- [ ] Regenerate `workflows/src/types/database.types.ts`
- [ ] Regenerate `frontend/src/services/api/rpc-registry.generated.ts`; verify `UncategorizedRpcs = never`
- [ ] Verify `provider-partners-architecture.md` L324 `authorization_type` list = 5 values (PR #68 F1 fix; confirm preserved)
- [ ] Apply any frontend patches surfaced by Stage B five-tier audit
- [ ] Apply any Edge Function patches surfaced by Stage B five-tier audit
- [ ] Apply any workflows patches surfaced by Stage B five-tier audit

## Stage E — Smoke & UAT (per plan.md § Smoke / UAT strategy)

- [ ] Transactional smoke harness: single-org user (today's shape) — JWT structure unchanged, permission counts unchanged
- [ ] Transactional smoke harness: simulated multi-org consultant — JWT includes grant-derived entries; `has_effective_permission` TRUE at grant scope; `accessible_organizations @>` TRUE at grant target org
- [ ] Transactional smoke harness: DISTINCT ON edge cases (role-only widens by nlevel; grant + role at same scope collapses; cross-tenant grants stay distinct)
- [ ] Pre-PR-open: deploy migration to dev + smoke
- [ ] Auth-hook latency re-measure (per ADR § Performance and JWT-size considerations) — record baseline + post-bump comparison

## Stage F — PR + ship

- [ ] Pre-PR-open ritual evidence pasted into card (log lines from dev smoke)
- [ ] Open PR; CI gates: `Deploy Database Migrations` validate path, `RPC Shape Registry Sync`, `RPC Reachability Matrix Sync` (NEW)
- [ ] Architect-review the PR (`software-architect-dbc`); address in-PR fixes per `memory/feedback-no-deferral-to-cards.md`
- [ ] Merge (strategy TBD at merge time; user direction)
- [ ] Post-merge: `Deploy Database Migrations` green on main; no production alerts on auth-hook latency
- [ ] Update parent card `cross-tenant-access-grant-rollout/` tasks.md with Phase 1 outcomes
- [ ] Archive this card → `dev/archived/cross-tenant-grant-phase-1-jwt-shape/`
- [ ] Memory close-out: `pr-NN-close-out.md` (NN = PR number) + MEMORY.md leading-pointer update

## Current Status

**Stage**: A (plan gate) — plan.md seeded; awaiting architect review.
**Status**: Card seeded 2026-05-28 on branch `feat/cross-tenant-grant-phase-1-jwt-shape` from main (post PR #68 merge `ffad05aa`). NO migration SQL drafted yet — gated on architect review of plan.md per parent card's Phase 0 tasks.md 0.6 ("Architect review of the design doc before any Phase 1 work begins"; reinterpreted post-PR-#68 as: design doc = ADR ✓ shipped; PLAN for execution = this card's plan.md, awaiting review).
**Next action**: User decision — kick off architect review now, or pause for review/refinement of plan.md scope first.
