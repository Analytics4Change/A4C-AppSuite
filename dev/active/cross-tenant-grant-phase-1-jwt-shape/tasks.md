# Tasks — cross-tenant-grant Phase 1 JWT shape migration

> **Manifest source of truth**: ADR `documentation/architecture/decisions/adr-cross-tenant-access-grant-jwt-shape.md` § Consequences → Phase 1 migration manifest (15 ordered steps). This file tracks per-step *progress*; it does NOT duplicate the manifest content.

## Stage A — Plan gate

- [ ] Read ADR `adr-cross-tenant-access-grant-jwt-shape.md` in full
- [ ] Read reachability matrix `cross-tenant-access-grant-rpc-reachability-matrix.md` in full
- [ ] Read parent card `dev/active/cross-tenant-access-grant-rollout/` plan.md + tasks.md "Phase 0 — Outcomes" section
- [ ] Read memory files: `pr-67-close-out.md`, `feedback-branch-on-decision.md`, `feedback-no-deferral-to-cards.md`
- [ ] Read current `compute_effective_permissions` implementation in `baseline_v4.sql:6932-6985` *(F1: NOT 20260226002002 — that file replaces only `custom_access_token_hook`)*
- [ ] Read current `custom_access_token_hook` body in `20260226002002_organization_manage_page_phase1.sql` (rebase target for ADR step 3)
- [ ] Read `process_access_grant_event` `access_grant.created` branch (`baseline_v4.sql:10417-10451`)
- [x] **Architect review of plan.md** (`software-architect-dbc` per plan.md § Architect-review gate) — completed 2026-05-29; verdict APPROVE WITH IN-PR FIXES (4 must-fix F1-F6 + 4 nits N1-N4)
- [x] Address architect-review findings in plan.md before any migration SQL drafted — F1/F2/F3/F4/F5/F6/N1/N2/N3 folded in same-day; N4 (cosmetic matrix-doc citation) auto-fixes under step 13 codegen

## Stage B — Pre-flight checks (per plan.md § Pre-flight checks)

*(F3 + F6 + N2 expansion 2026-05-29 — list mirrors plan.md exactly.)*

- [ ] Row-count probe on dev: `SELECT COUNT(*) FROM public.cross_tenant_access_grants_projection;` returns 0
- [ ] Schema non-collision probe: `permission_implications.propagate_through_grants` does NOT exist on dev
- [ ] 10-RPC two-step-pattern verification (step 7 scope): re-grep each canonical body file for `get_permission_scope`; all 10 still on legacy pattern
- [ ] Auth-hook baseline-latency capture: `EXPLAIN ANALYZE` p50/p95 over 100 invocations of `compute_effective_permissions(<user>, <org>)` against dev — record for Stage E delta comparison
- [ ] `claims_version` JWT distribution probe: all extant dev sessions at v4 (not v3 or NULL)
- [ ] RPC count re-verification (step 11 scope): net-of-DROPs count = 104; any post-2026-05-26 new `api.*` RPCs identified + matrix-classified BEFORE migration drafts
- [ ] Five-tier JWT consumer audit complete; breaking tiers identified (architect 2026-05-29 confirmed Frontend / EF / Workflows tiers all duplicate-safe today)
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
- [ ] **Step 7** — Normalize 10 C-legacy RPCs to single `has_effective_permission(perm, path)` call. Draft in this order (plan.md constraint #7 / F2):
  - OU mutators (5): `create/update/delete/deactivate/reactivate_organization_unit`
  - Role-management mutations (2): `api.bulk_assign_role`, `api.sync_role_assignments`
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
- [ ] Apply any frontend patches surfaced by Stage B five-tier audit (architect 2026-05-29 baseline: none required)
- [ ] Apply any Edge Function patches surfaced by Stage B five-tier audit (architect 2026-05-29 baseline: none required)
- [ ] Apply any workflows patches surfaced by Stage B five-tier audit (architect 2026-05-29 baseline: none required)
- [ ] **N2: Update comment in `workflows/src/api/middleware/auth.ts:132-135`** to note multi-entry-per-permission tolerance under post-Phase-1 JWT shape (does NOT change behavior; comment-only)

## Stage E — Smoke & UAT (per plan.md § Smoke / UAT strategy)

- [ ] Transactional smoke harness: single-org user (today's shape) — JWT structure unchanged, permission counts unchanged
- [ ] Transactional smoke harness: simulated multi-org consultant — JWT includes grant-derived entries; `has_effective_permission` TRUE at grant scope; `accessible_organizations @>` TRUE at grant target org
- [ ] DISTINCT ON edge case: role-only widens by `nlevel ASC`
- [ ] DISTINCT ON edge case: grant + role at **SAME** scope collapses to one row
- [ ] DISTINCT ON edge case: cross-tenant grants at distinct provider orgs stay distinct
- [ ] DISTINCT ON edge case (F5): grant + role at **DIFFERENT** scopes for the SAME permission yields TWO rows (canonical multi-entry preservation)
- [ ] DISTINCT ON edge case (F5): collapsed-row source-tier verified UNDEFINED (no downstream reliance on role-vs-grant winner)
- [ ] **HIPAA invariant smoke (F5)**: `propagate_through_grants=false` (default) blocks implication-widening for a grant-derived permission
- [ ] **Revoke pathway smoke (F5)**: UPDATE `status='active'→'revoked'` on a grant removes provider org from `accessible_organizations` IFF no other active grant covers it (test both branches: with and without other coverage)
- [ ] Pre-PR-open: deploy migration to dev + smoke
- [ ] Auth-hook latency re-measure (per ADR § Performance and JWT-size considerations) — compare against Stage B baseline (p50/p95 delta)

## Stage F — PR + ship

- [ ] Pre-PR-open ritual evidence pasted into card (log lines from dev smoke)
- [ ] Open PR; CI gates: `Deploy Database Migrations` validate path, `RPC Shape Registry Sync`, `RPC Reachability Matrix Sync` (NEW)
- [ ] Architect-review the PR (`software-architect-dbc`); address in-PR fixes per `memory/feedback-no-deferral-to-cards.md`
- [ ] Merge (strategy TBD at merge time; user direction)
- [ ] Post-merge: `Deploy Database Migrations` green on main; no production alerts on auth-hook latency
- [ ] Update parent card `cross-tenant-access-grant-rollout/` tasks.md with Phase 1 outcomes
- [ ] Archive this card → `dev/archived/cross-tenant-grant-phase-1-jwt-shape/`
- [ ] Memory close-out: `pr-NN-close-out.md` (NN = PR number) + MEMORY.md leading-pointer update — **single line under ~200 chars** per PR #67 / PR #68 lesson (N3 2026-05-29); detail goes in the close-out topic file, NOT in MEMORY.md

## Current Status

**Stage**: A (plan gate) — architect review complete; findings folded in.
**Status**: Card seeded 2026-05-28 on branch `feat/cross-tenant-grant-phase-1-jwt-shape` from main (post PR #68 merge `ffad05aa`). Architect review of plan.md 2026-05-29 returned APPROVE WITH IN-PR FIXES (4 must-fix F1-F6 + 4 nits N1-N4). F1/F2/F3/F4/F5/F6/N1/N2/N3 folded in same-day; N4 (cosmetic matrix-doc citation) auto-fixes under step 13 codegen. NO migration SQL drafted yet — ready to proceed to Stage B (pre-flight checks) and then Stage C (drafting).
**Next action**: User decision — proceed to Stage B pre-flight probes (cheap, sequential, mostly Management API SQL queries against dev) or pause for plan.md skim before Stage B begins.
