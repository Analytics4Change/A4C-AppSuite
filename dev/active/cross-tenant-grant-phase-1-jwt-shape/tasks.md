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

- [x] Row-count probe on dev: `SELECT COUNT(*) FROM public.cross_tenant_access_grants_projection;` returns 0 — **PASS** (2026-05-29; see § Stage B probe results)
- [x] Schema non-collision probe: `permission_implications.propagate_through_grants` does NOT exist on dev — **PASS**
- [x] 10-RPC two-step-pattern verification (step 7 scope): re-grep each canonical body file for `get_permission_scope`; all 10 still on legacy pattern — **PASS**
- [x] Auth-hook baseline-latency capture: p50/p95 over 100 invocations of `compute_effective_permissions(<user>, <org>)` against dev — **PASS** (2026-05-30; representative user `61cbb03f-…0821` / org `2d0829ae-…c172` — single-org with 2 distinct roles; 15 permission rows returned per call). Results: **mean 0.543 ms · p50 0.222 ms · p95 0.267 ms · p99 0.636 ms · min 0.175 ms · max 32.668 ms · n=100 (61 distinct timings — per-row LATERAL forced via `CASE WHEN i.n > 0 THEN <uuid> ELSE NULL END` to defeat scalar-subquery constant-folding)**. Max is a cold-start outlier (first invocation); steady-state p95 0.267 ms gives Phase 1's CTE expansion comfortable headroom. Stage E re-measure target: keep p95 within ~2× baseline (~0.5 ms) or document deltas.
- [x] `claims_version` JWT distribution probe: all extant dev sessions at v4 (not v3 or NULL) — **PASS-WITH-INTERPRETATION** (all `auth.users.raw_app_meta_data->>'claims_version'` are NULL because the hook does not persist `claims_version` to that column; codebase audit confirms only 2 emit sites — both baseline_v4 and `20260226002002` — set it to literal `4`. No drift. Step 3's bump to 5 lands alongside a single prior shape.)
- [x] RPC count re-verification (step 11 scope): net-of-DROPs count = 104; any post-2026-05-26 new `api.*` RPCs identified + matrix-classified BEFORE migration drafts — **PASS** (zero new `api.*` CREATE statements since 2026-05-26 on either branch ancestry or `main`; matrix doc requires no pre-Phase-1 backfill of new entries)
- [ ] Five-tier JWT consumer audit complete; breaking tiers identified (architect 2026-05-29 confirmed Frontend / EF / Workflows tiers all duplicate-safe today)
- [x] Concurrency check: no in-flight PR on `main` touching `compute_effective_permissions` — **PASS** (1 open PR — #45 `refactor(users)` — 0 Phase-1-surface lines across `compute_effective_permissions`, `custom_access_token_hook`, `get_permission_scope`, `has_effective_permission`, `cross_tenant_access_grants*`, `permission_implications`, `grant_role_templates`)
- [x] Baseline build green: `frontend` + `workflows` typecheck against current generated types — **PASS** (2026-05-30; both `tsc --noEmit` exit 0 on HEAD `0d91e11c`)

### Stage B probe results (2026-05-29)

All 6 user-requested pre-flight probes returned green. Auth-hook baseline latency capture and baseline build green deliverables remain HELD pending user direction.

| # | Probe | Expected | Observed | Verdict |
|---|-------|----------|----------|---------|
| 1 | Row count `cross_tenant_access_grants_projection` (Mgmt API SQL) | 0 | 0 | ✅ PASS — no backfill care needed for step 14 column add |
| 2 | Schema non-collision `permission_implications.propagate_through_grants` (Mgmt API SQL, `information_schema.columns`) | column does NOT exist | 3 columns only: `permission_id`, `implies_permission_id`, `created_at` — no `propagate_through_grants` | ✅ PASS — step 2 ALTER TABLE is safe today |
| 3 | 10-RPC two-step-pattern verification (codebase grep of `baseline_v4` canonical bodies) | all 10 still call `get_permission_scope` | all 10 confirmed at expected line numbers (table below) | ✅ PASS — step 7 scope is exactly the matrix doc's Phase 1 must-pair set |
| 4 | `claims_version` JWT distribution (Mgmt API SQL on `auth.users.raw_app_meta_data`) + codebase emit-site audit | all v4 (no v3, no NULL) | all 13 dev users NULL in `raw_app_meta_data->>'claims_version'`; codebase audit confirms only `20260212010625_baseline_v4.sql` + `20260226002002_organization_manage_page_phase1.sql` emit `claims_version`, both literal `4` | ✅ PASS-WITH-INTERPRETATION — the SQL probe targets the persisted column (which the hook does not populate), so NULL is expected and orthogonal to JWT shape. The codebase emit-site audit is the load-bearing verification: only one prior shape (v4) exists. Step 3's bump-to-5 lands alongside v4 alone. |
| 5 | RPC count re-verification — net-of-DROPs = 104; identify post-2026-05-26 new `api.*` (codebase git delta) | 104; zero new since 2026-05-26 | ZERO new `+CREATE OR REPLACE FUNCTION "api".` lines since 2026-05-26 on either this branch's ancestry or `main`. Codebase raw count: 119 CREATE OR REPLACE / 101 distinct names / 99 net-of-pure-DROPs. **Live dev pg_proc: 170 distinct names / 172 total — DRIFT from matrix doc's curated 104 figure** (likely matrix is a curated subset of user-facing RPCs, not all `api.*` functions; see drift note below) | ✅ PASS for the gate (no new RPCs to classify before migration drafts). ⚠ Side observation: matrix doc reconciliation needed at step 11 — see drift note. |
| 6 | Concurrency check — no in-flight PR on `main` touching `compute_effective_permissions` (gh + git) | no PR | 1 open PR (#45 `refactor(users): remove Pattern A v2 deploy-window fallbacks`, last updated 2026-05-05 — stale). 0 Phase-1-surface keyword hits across all open-PR diffs. | ✅ PASS — no merge-conflict risk on critical function |

#### Probe 3 detail — 10-RPC legacy-pattern map (canonical body = `baseline_v4` per F1)

| # | RPC | Permission queried | baseline_v4 line |
|---|-----|---------------------|------------------|
| 1 | `api.bulk_assign_role` | `user.role_assign` | 353 |
| 2 | `api.sync_role_assignments` | `user.role_assign` | 5562 |
| 3 | `api.create_organization_unit` | `organization.create_ou` | 640 |
| 4 | `api.update_organization_unit` | `organization.update_ou` | 6105 |
| 5 | `api.delete_organization_unit` | `organization.delete_ou` | 1313 |
| 6 | `api.deactivate_organization_unit` | `organization.update_ou` | 1069 |
| 7 | `api.reactivate_organization_unit` | `organization.update_ou` | 4871 |
| 8 | `api.get_organization_unit_by_id` | `organization.view_ou` | 2851 |
| 9 | `api.get_organization_unit_descendants` | `organization.view_ou` | 2930 |
| 10 | `api.get_organization_units` | `organization.view_ou` | 3003 |

Cross-check: PR #67's `20260521195657_fix_list_users_sister_functions_membership_gating.sql` references `get_permission_scope` only in header comments (lines 20, 46 — explanatory prose about the old pattern). The three sister RPCs (`list_users_for_bulk_assignment` L4696, `list_users_for_role_management` L4784, plus the third covered in that PR) were normalized to `has_effective_permission` by that migration — confirms the 10-RPC set above is the complete remaining legacy population.

#### Probe 5 drift note — matrix doc reconciliation **COMPLETE 2026-05-29**

Live `pg_proc` count on dev shows **170 distinct function names / 172 total overloads** in the `api` schema. The reachability matrix doc previously stated **104** as the current `api.*` RPC inventory.

**Resolution (Stage R — Matrix-doc reconciliation, completed 2026-05-29)**: The 66-function gap was diagnosed and resolved. Original hypothesis ("matrix is curated user-callable subset; the 66 are trigger-bound helpers") turned out to be wrong. The 66 are first-class user-facing CRUD RPCs the 2026-05-26 hand-curation simply missed. See § Reconciliation outcome below; full work-product in `matrix-reconciliation-inventory.md`.

#### Reconciliation outcome (Stage R, 2026-05-29)

**Set arithmetic** (vs live pg_proc):
- MATCHES (in both): 98
- MISSING-FROM-MATRIX (in live; matrix missed): **72** (entire client lifecycle, field categories/definitions, schedule template family, org-CRUD, admin surfaces)
- STALE-IN-MATRIX (in matrix; not in live): **7** (`*_user_schedule` family dropped by `20260217211231_schedule_template_refactor.sql` 2026-02-17 — replaced by schedule_template + assignment model; matrix curation missed this 3-month-old refactor)

**R-2 classification of the missing 72** (via v4 path-source discriminator + manual overrides):
- **B: 41** (client lifecycle, field categories/defs, JWT-bound CRUD)
- **C: 17** (org address/contact/phone CRUD entity-derived + schedule template COALESCE-hybrid + `update_organization` + `update_organization_phone`)
- **D: 4** (`check_field_definitions_exist`, `deactivate_all_field_definitions`, `get_organization_details`, `list_schedule_templates`)
- **D-variant: 4** (`deactivate_organization`, `delete_organization`, `reactivate_organization`, `retry_deletion_workflow`)
- **E: 6** (`get_failed_events_with_detail`, `get_orphaned_deletions`, `list_field_definition_templates`, `list_system_field_categories`, `deactivate_user` [manual override matching delete_user precedent], `safety_net_deactivate_organization` [service-role-only])

**Critical zero-cases**:
- **C-legacy: 0** ✅ — no new operational tripwires; step 7 scope remains exactly the 10 known RPCs.
- **A / A-variant: 0** ✅ — no new Phase 3 refactor targets.

**Per-bucket deltas to the matrix doc** (post-Stage-R; the Stage R-6 fold-in 2026-05-30 reshuffles within D / D-variant / E — see § Stage R-6 below for post-fold-in numbers):
| Bucket | Pre (matrix 2026-05-26) | Post Stage R (matrix L46-57 2026-05-29) | Δ |
|---|---:|---:|---:|
| A / A-variant | 1+1 | 1+1 | 0 |
| B | 15 | 56 | +41 net (+41 missing-72; B was undercounted pre-R from missing-72) |
| C | 4 | 21 | +17 |
| C-legacy | 10 | 10 | 0 |
| D | 34 | 38 | +4 net (+4 missing-72: `check_field_definitions_exist`, `deactivate_all_field_definitions`, `get_organization_details`, `list_schedule_templates`; -2 stale: `get_schedule_by_id`, `list_user_schedules`) |
| D-variant | 1 | 5 | +4 |
| E | 38 | 37 | -1 net (+6 missing-72; -7 stale) |
| E-variant | 1 | 1 | 0 |
| **Total** | 105 (matrix L63 = "104 stated / 105 actual"; hand-curated 104 was 1-row undercount) | 170 | +65 (per set-diff: +72 missing -7 stale) |

> N2 fold-in 2026-05-30: prior table version showed "Total | 104 | 169 | +65" with a 1-row residual annotation. The matrix's master per-RPC table sums cleanly to 170; the 169 was a stale arithmetic artifact. Corrected here to mirror the matrix doc as sole source of truth.

**Artifacts produced**:
- `matrix-reconciliation-inventory.md` (508+ lines after R-6 fold-in) — full pg_proc dump + set diff + R-2 classification work-product + Stage R-6 reclassification section
- `documentation/architecture/authorization/cross-tenant-access-grant-rpc-reachability-matrix.md` — master table now 170 rows; per-bucket counts updated post-R-6 (D=36, D-variant=1, E=43); Phase 4 RLS audit list now 37 RPCs after R-6 F1+F2 moves; new "Stage R reconciliation 2026-05-29 — structural notes" subsection in § Edge cases documenting the B-vs-C path-source discriminator, the `update_organization` vestigial-variable pattern, the schedule template family COALESCE hybrid pattern (re-worded in R-6 F4 for consultant-callability accuracy), the `safety_net_deactivate_organization` service-role-only pattern, and the `deactivate_user` E-classification matching `delete_user`.

**Step 11 scope expansion implication**: step 11 originally drafted as "backfill on all 104 RPCs"; now backfills **on all ~170 RPCs**. Migration size grows from ~104 `COMMENT ON FUNCTION` statements to ~170. Still single-transactional; no risk; pre-merge architect review accounts for the larger surface. Step 11 drafting unblocked.

#### Stage R-6 architect re-review (2026-05-30) — APPROVE WITH IN-PR FIXES; all 6 findings folded in

Spawned `software-architect-dbc` 2026-05-30 to re-review the post-Stage-R matrix doc + inventory work-product (per Stage R-6 plan recommendation: catch missing-72 R-2 miscategorizations at the cheap stage before Stage C migration drafting). Verdict: **APPROVE WITH IN-PR FIXES** (4 must-fix F1-F4 + 2 nits N1-N2). All 6 findings folded into the matrix doc + inventory + this tasks.md on the same branch, same day (2026-05-30).

**Critical zero-claims independently verified** (load-bearing for Phase 1 scope correctness):
- **C-legacy zero-from-missing-72** ✅ — independent grep of `get_permission_scope` callers across all active migrations reduces to exactly the 10 known C-legacy RPCs (architect verified at the SQL grep level). Step 7 normalization scope stays at 10; no hidden caller will break when DISTINCT ON is tightened.
- **A / A-variant zero-from-missing-72** ✅ — independent grep of `p_org_id = get_current_org_id()` strict-A discriminator returns only the 2 known entries (`list_users` strict-A, `list_invitations` A-variant). No new Phase 3 refactor target surfaced by reconciliation.

**Findings folded** (each links to its specific edit; matrix doc commit will follow this tasks.md update):

| # | Severity | Summary | Fold-in |
|---|---|---|---|
| F1 | must-fix | `check_field_definitions_exist` + `deactivate_all_field_definitions` were D but `GRANT EXECUTE ... TO service_role` only (no `authenticated` grant) — structurally identical to `safety_net_deactivate_organization` E `[service-role-only]` | Matrix per-RPC table + per-bucket count table + Phase 4 RLS audit list + inventory R-6 reclassification section all updated D→E `[service-role-only]` |
| F2 | must-fix | 4 org-lifecycle RPCs (`deactivate_organization`, `delete_organization`, `reactivate_organization`, `retry_deletion_workflow`) were D-variant but `has_platform_privilege()` early-return is ONLY enforcement (RLS not load-bearing) — structurally identical to existing E `[admin-only]` siblings (`retry_failed_event`, `dismiss_failed_event`) | Matrix per-RPC table + per-bucket count table + Phase 4 RLS audit list all updated D-variant→E `[admin-only]` |
| F3 | must-fix | `get_organization_details` + `list_schedule_templates` are SECURITY DEFINER (bypasses caller-RLS); guard column "RLS on underlying projection" was misleading | Matrix guard column rewritten to "none (SECURITY DEFINER bypasses caller-RLS); RLS on `<table>` is informational only"; Phase 4 sub-audit subsection extended from `check_user_org_membership`-only to a 3-RPC definer-bypasses-RLS cluster with per-RPC decisions; possible follow-up card flagged (`dev/active/security-audit-definer-bypass-rls/`) |
| F4 | must-fix | Schedule-template family consultant-callability claim was too optimistic — hard-coded `organization_id = v_org_id` validation against `get_current_org_id()` blocks grant-targeted calls even when perm-check succeeds | Structural-notes bullet at matrix § Edge cases rewritten with the correct framing; Phase 2+ parameterization called out as the consultant variant requirement |
| N1 | nit | Variant-rows note example imbalance after F2 collapsed D-variant from 5 to 1 | Variant-rows note paragraph expanded with 3 balanced examples (A-variant `list_invitations`, D-variant `get_user_addresses_for_org`, E-variant `list_user_organizations`) |
| N2 | nit | tasks.md L96 Pre→Post→Δ table showed "Total | 104 | 169 (live: 170 — 1-row residual) | +65" | Corrected: pre-count was matrix's "104 stated / 105 actual" undercount; post-count cleanly 170; rebalanced per-bucket column to match matrix as sole source of truth |

**Stage C readiness assessment** (architect verdict): **YES** after F1-F4 + N1-N2 folded — matrix doc is load-bearing enough for Stage C migration drafting to proceed.

- Step 7 normalization scope (10 C-legacy) — independently verified; ships with correct set
- Step 11 backfill scope (~170 RPCs) — F1+F2 reshuffle ~6 RPCs between D/D-variant/E but do not change *which* RPCs need tags; complexity unchanged
- Phase 3 refactor scope (A + A-variant = 2 RPCs) — independently verified; unchanged
- Phase 4 RLS audit scope — F1+F2 reduce from 43 → 37 RPCs (correct shrink: 6 RPCs that don't belong in a per-table RLS audit moved to E)

The F3 pre-existing security gap (definer-bypasses-RLS on `get_organization_details` + `list_schedule_templates`) is documented for Phase 4 sub-audit; not blocking Phase 1.

#### Held items

- ~~**Auth-hook baseline-latency capture**~~ — **RESOLVED 2026-05-30**: representative single-org user `61cbb03f-…0821` / org `2d0829ae-…c172` picked from dev (top of the role-richness-sorted single-org candidate list; 2 distinct roles, 15 permission rows from `compute_effective_permissions`). 100-invocation latency capture via Mgmt API SQL endpoint with per-row LATERAL + `CASE WHEN i.n > 0 THEN <uuid> ELSE NULL END` to defeat scalar-subquery constant-folding (first attempt collapsed all 100 timings to one value). Steady-state: **p50 0.222 ms / p95 0.267 ms / p99 0.636 ms** (mean 0.543, min 0.175, max 32.668 — cold-start outlier; 61 distinct timings over 100 runs). Stage E re-measure target: p95 within ~2× baseline (~0.5 ms) or document the delta.
- ~~**Baseline build green**~~ — **RESOLVED 2026-05-30**: both `frontend` and `workflows` `tsc --noEmit` exit 0 against current generated types on HEAD `0d91e11c`. Stage E regen-induced breakage will be attributable to this PR alone.

## Stage C — Migration drafting (the 15 manifest steps)

Each checkbox = one manifest step. Refer to ADR § Consequences → Phase 1 migration manifest for the canonical specification.

- [x] **Step 1** — `compute_effective_permissions`: asymmetric `DISTINCT ON` + `grant_derived_perms` CTE + implication flag gating — **DRAFTED 2026-06-01**; **architect-reviewed same-day** (APPROVE WITH IN-PR FIXES; F1 + F2 must-fix + N1/N2 nits all folded same-day in commit). Lives in `infrastructure/supabase/supabase/migrations/20260601174841_cross_tenant_grant_phase_1_jwt_shape.sql:125-294`. Migration-session `SET search_path` at L42 (rationale: defensive for Step 7's `p_scope_path ltree` parameter signatures — Step 1 alone doesn't strictly need it; N1 fold-in). Four-arm UNION in `with_implications` CTE: role-source explicit + role-source implications (unconditional) + grant-source explicit + grant-source implications (gated on `pi.propagate_through_grants = true`). `widest_explicit_role` preserves baseline's per-perm widening via inner `DISTINCT ON (permission_name) ORDER BY nlevel ASC`. **F1 fold-in**: outer `final_effective` uses plain `SELECT DISTINCT permission_name, scope_path` (not `DISTINCT ON`); 4-arm UNION projects only `(permission_name, scope_path)` — drops `permission_id` so dedupe is robust against any future non-unique `permissions_projection.name` (defensive correctness; strictly equivalent semantically today). **F2 fold-in**: containment comment block extended with the TS type surface at `frontend/src/types/database.types.ts:4683` + `workflows/src/types/database.types.ts:4683` (signature unchanged → regen optional but recommended per DoD). **N2 fold-in**: `user_home_org` CTE filtered by `u.deleted_at IS NULL` (defensive; the JWT hook only fires for live login today so academic for Phase 1 but hardens future non-hook callers). Function attributes preserved verbatim from baseline (`LANGUAGE sql STABLE SECURITY DEFINER`, function-scope `SET search_path TO 'public', 'extensions'`). NOT YET DEPLOYED — awaiting Stage C completion (Steps 3-15) + Stage E smoke harness before any `supabase db push`.
- [x] **Step 2** — `permission_implications.propagate_through_grants boolean NOT NULL DEFAULT false` — **DRAFTED 2026-06-01** at migration L62-65. Idempotent via `ADD COLUMN IF NOT EXISTS`. Ordered BEFORE Step 1 in the file because Step 1's function body references the column (DDL takes effect immediately in PG transactions, so file ordering is sufficient — no separate transaction needed). Column comment captures the gating semantics: role-source implications unconditional, grant-source implications gated by this flag.
- [x] **Step 3** — `custom_access_token_hook` rebase on `20260226002002_*` body; `claims_version` bump to 5 — **DRAFTED 2026-06-01** at migration L368-573. Body copied verbatim from `20260226002002_organization_manage_page_phase1.sql:12-208` with the sole behavioral delta being `claims_version: 4 → 5` in **all four emit sites** (happy path, access-date access_blocked, org-deactivated access_blocked, EXCEPTION). ADR phrasing "bump on the happy path" interpreted as principal intent; uniform bump across all 4 branches for shape-contract consistency (consumers cannot tell which branch produced their token; reading mixed v4/v5 across branches forces handling both shapes for empty arrays). Function attributes preserved verbatim (`LANGUAGE plpgsql STABLE SECURITY DEFINER`, function-scope `SET search_path TO 'public', 'extensions', 'pg_temp'`). Signature unchanged → OID-keyed COMMENT + OWNER preserved; richer COMMENT re-issued documenting v5 contract + multi-entry-per-permission consumer requirements. The EFFECTIVE_PERMISSIONS materialization (jsonb_agg over `compute_effective_permissions(v_user_id, v_org_id)`) is structurally unchanged — only the underlying function's row count semantics differ (Step 1's multi-scope survival). Migration now 595 lines, 11 top-level statements.
- [x] **Step 4** — `sync_accessible_organizations_from_grants()` function + trigger on `cross_tenant_access_grants_projection` — **DRAFTED 2026-06-01** at migration L657-867 (4 sub-steps a-d). **Spec-gap drafter's note**: the DBC at plan.md L107-112 requires `users.accessible_organizations` be the UNION of `user_organizations_projection.org_id`s + active grant `provider_org_id`s, with idempotency under any DML sequence. The existing baseline trigger `sync_accessible_organizations` (baseline_v4:11767-11790) OVERWRITES with `user_organizations_projection` only — would erase grant-sourced orgs on the next user_organizations_projection change. Step 4 closes the gap by extracting a shared helper and rewriting both trigger bodies to call it. **Step 4a** (`recompute_user_accessible_organizations(p_user_id uuid) RETURNS void`) — single-user canonical UNION recomputation, soft-delete-safe via `deleted_at IS NULL` guard on both home-org lookup + UPDATE target. **Step 4b** (`sync_accessible_organizations()` rewrite) — body now delegates to helper; trigger binding on `user_organizations_projection` preserved verbatim (CREATE OR REPLACE FUNCTION updates body in-place; trigger binds by name). Behavior delta vs baseline: pre-Phase-1 output identical (UNION arm b empty); post-Phase-1 grant rows preserved. **Step 4c** (`sync_accessible_organizations_from_grants()` NEW) — enumerates affected users from both OLD and NEW (UPDATE), handles user-specific (`consultant_user_id IS NOT NULL`) and org-wide (`consultant_user_id IS NULL AND consultant_org_id = home_org`) grant shapes, iterates `recompute_user_accessible_organizations` for each unique user. **Step 4d** — `CREATE OR REPLACE TRIGGER trg_sync_accessible_orgs_from_grants AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW` per DBC DML-row trigger requirement. All functions SECURITY DEFINER. Migration now 872 lines, 23 top-level statements. Worth flagging to architect at the next review: the spec-gap fix (modifying the existing trigger) is architecturally correct per the L111 idempotency invariant but expands Step 4's footprint beyond the ADR minimum.
- [ ] **Step 5** — One-time backfill `DO $$ ... $$;` block for existing active grants (idempotent dedup)
- [ ] **Step 6** — Composite partial index `idx_access_grants_consultant_user_status_partial` (auth-hook query gap)
- [ ] **Step 7** — Normalize 10 C-legacy RPCs to single `has_effective_permission(perm, path)` call. Draft in this order (plan.md constraint #7 / F2):
  - OU mutators (5): `create/update/delete/deactivate/reactivate_organization_unit`
  - Role-management mutations (2): `api.bulk_assign_role`, `api.sync_role_assignments`
  - OU readers (3): `get_organization_unit_by_id`, `get_organization_unit_descendants`, `get_organization_units`
- [ ] **Step 8** — M3 RPC Shape Registry re-tag for all 10 RPCs from step 7 + post-migration `UncategorizedRpcs = never` assertion. **N1 fold-in 2026-05-30**: positive-guard — retain `@a4c-rpc-shape: read` for `safety_net_deactivate_organization` and the 4 sibling state-mutating-but-custom-shape RPCs (`bulk_assign_role`, `sync_role_assignments`, `sync_schedule_assignments`, `deactivate_all_field_definitions`) per the M3 backfill's wire-shape body-introspection rule. Do NOT promote these to `envelope` — their bodies lack the `{success, ...}` top-level discriminator and the frontend services callers (`SupabaseRoleService`, `SupabaseScheduleService`) consume them via `apiRpc<T>` (read helper). See Stage D § N1 RESOLVED line for full reasoning.
- [ ] **Step 9** — `cross_tenant_access_grants_projection_authorization_type_check` CHECK constraint (5 values)
- [ ] **Step 10** — `access_grant.policy_override_applied` handler (handler-only, no emit RPC) + emit `permission.defined` for 3 grant perms + 4 partner perms
- [ ] **Step 11** — Backfill `@a4c-bucket` / `@a4c-consultant-callable*` / `@a4c-phase-target` COMMENT tags on all ~170 `api.*` RPCs (Stage R reconciliation 2026-05-29 expanded scope from 104 → 170; see matrix doc § The matrix for authoritative set + § Edge cases for structural patterns)
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
- [x] **Stage R-6 N1 RESOLVED — REJECTED 2026-05-30**. `safety_net_deactivate_organization`'s `@a4c-rpc-shape: read` tag is correct per the M3 backfill's wire-shape body-introspection rule (ADR §"Type-level enforcement (M3)"; SKILL.md Rule 17). Architect re-evaluation 2026-05-30 confirmed the original R-6 N1 finding misapplied a state-mutation interpretation to a wire-shape contract. The RPC has zero frontend reach (service-role-only Temporal compensation lever); the typed helpers `apiRpc<T>` / `apiRpcEnvelope<T>` are frontend-only. 5 sibling state-mutating-but-custom-shape RPCs (`bulk_assign_role`, `sync_role_assignments`, `sync_schedule_assignments`, `deactivate_all_field_definitions`, `safety_net_deactivate_organization`) share the same `read` classification per the same rule; 3 are actively consumed by frontend services via `apiRpc<T>` and depend on it. No migration change. See `documentation/architecture/decisions/adr-rpc-readback-pattern.md` §"Type-level enforcement (M3)" for the wire-shape contract; `20260430172625_backfill_rpc_shape_comments.sql` for the body-introspection rule; this card's `matrix-reconciliation-inventory.md` § "N1 resolution 2026-05-30" for the per-question evaluation.

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
- [ ] **Org-wide grant smoke (step-1+2 architect review 2026-06-01)**: insert grant row with `consultant_user_id=NULL, consultant_org_id=<U's home org>`; simulate U; assert grant-derived perms appear in JWT. Verifies the `(consultant_user_id IS NULL AND consultant_org_id = <home org>)` branch of `compute_effective_permissions.grant_derived_perms`.
- [ ] **Empty `permissions jsonb` array smoke (step-1+2 architect review)**: `CROSS JOIN LATERAL jsonb_array_elements('[]'::jsonb)` returns zero rows by SQL semantics; lock that against future PG behavior changes — insert grant with empty `permissions`; assert no rows from `grant_derived_perms` for that grant.
- [ ] **Expired-but-not-yet-status-flipped grant smoke (step-1+2 architect review)**: insert grant with `expires_at < now() AND status='active'` (handler hasn't processed `access_grant.expired` yet); assert `compute_effective_permissions` correctly drops it via the `(g.expires_at IS NULL OR g.expires_at > now())` filter.
- [ ] **Provisioning race smoke (step-1+2 architect review N2)**: simulate user with `auth.users` row but missing `public.users` row; assert no exception, org-wide-grant branch silently drops, function returns role-source perms only (or empty if no role assignments yet).
- [ ] **User-specific vs org-wide grant for SAME provider org smoke (step-1+2 architect review)**: user-specific grant + org-wide grant covering the same provider org for the same user — assert both rows survive in the function output (multi-entry preservation; no inadvertent dedupe).
- [ ] **Step 4 trigger fires on each TG_OP (step-3+4 architect review)**: INSERT grant, UPDATE grant (status flip), DELETE grant — each correctly updates `accessible_organizations`.
- [ ] **Step 4 org-wide grant onboarding (step-3+4 architect review; M1 regression test)**: insert org-wide grant for consultant org with 3 users (each with `accessible_organizations @> [consultant_org_id]`) — all 3 users' accessible_organizations now include `provider_org_id`. **Specifically test users whose `current_organization_id` differs from `consultant_org_id` (switched to a different active session)** — must still receive the grant per M1 fix.
- [ ] **Step 4 org-wide grant revocation (step-3+4 architect review)**: same as above but UPDATE status='revoked' → all 3 users lose the provider org from accessible_organizations IFF no other active grant covers it (test both branches: with and without other coverage).
- [ ] **Step 4 mixed grant + role coverage (step-3+4 architect review)**: user has a role assignment in org X AND a grant targeting org X — `accessible_organizations` includes X exactly once (UNION dedupes via the helper).
- [ ] **Step 4 `sync_accessible_organizations` regression smoke (step-3+4 architect review)**: insert/update/delete `user_organizations_projection` row; assert the rewritten body still updates `accessible_organizations` correctly under zero-grant state (regression smoke ensures the helper extraction preserves baseline behavior).
- [ ] **Step 4 switched-org user enumeration (step-3+4 architect review M1 regression)**: user U with `current_organization_id = Y` but `accessible_organizations @> [X]` (was switched to Y). Insert org-wide grant targeting X — assert U is enumerated in `sync_accessible_organizations_from_grants` and their `accessible_organizations` is recomputed to include `provider_org_id`.
- [ ] **Step 4 DELETE-without-OLD edge case (step-3+4 architect review N2)**: confirm helper's UPDATE handles `WHERE id = NULL` gracefully (predicate fails via NULL semantics; no error). Belt-and-suspenders.
- [ ] **Step 4 100-user org-wide-grant trigger latency (step-3+4 architect review N2)**: BEGIN ... ROLLBACK transaction. Insert org-wide grant targeting consultant org with 100 users. Assert trigger executes under 500 ms. Belt-and-suspenders against pathological consultant org sizes.
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

**Stage**: C (migration drafting) — IN PROGRESS. Steps 1 + 2 drafted 2026-06-01 (migration file `20260601174841_cross_tenant_grant_phase_1_jwt_shape.sql`, 295 lines, 7 top-level statements). Stage A done. Stage B closed 2026-05-30 (all 9 pre-flight items pass).
**Status**: Card seeded 2026-05-28. Architect review of plan.md 2026-05-29 returned APPROVE WITH IN-PR FIXES (4 must-fix F1-F6 + 4 nits N1-N4) — all findings folded in same-day. **Stage B pre-flight probes ran 2026-05-29 — all 6 user-requested probes PASS**. **Stage R matrix-doc reconciliation completed 2026-05-29**: 72 missing-from-matrix user-facing CRUD RPCs classified; 7 stale-in-matrix entries removed; matrix doc now 170 rows. **Stage R-6 architect re-review completed 2026-05-30**: APPROVE WITH IN-PR FIXES (4 must-fix F1-F4 + 2 nits N1-N2); all 6 findings folded same-day. C-legacy zero-claim and A/A-variant zero-claim both independently verified by architect at the SQL grep level — Phase 1 step 7 (10-RPC normalization) and Phase 3 (2-RPC refactor) scopes confirmed correct. **Auth-hook baseline-latency captured 2026-05-30**: p50 0.222 ms / p95 0.267 ms / p99 0.636 ms (n=100; representative user 61cbb03f-…0821 / org 2d0829ae-…c172). **Baseline build green confirmed 2026-05-30**: both `frontend` and `workflows` `tsc --noEmit` exit 0. NO migration SQL drafted yet.
**Next action**: Continue Stage C drafting. Steps 1 + 2 + 3 + 4 done with two rounds of architect-review fold-in (Steps 1+2 fold-in 2026-06-01; Steps 3+4 fold-in 2026-06-01). Steps 3+4 architect review surfaced **M1 (must-fix)**: Steps 1, 4a, 4c all used `current_organization_id` (active-session pointer) instead of the canonical `accessible_organizations` membership oracle codified by PR #67 — same defect class as PR #67 cleaned up in `list_users*` family. Fix applied at all 3 sites (`compute_effective_permissions.grant_derived_perms`, `recompute_user_accessible_organizations` helper, `sync_accessible_organizations_from_grants` trigger). Also folded: S1 (document per-branch claim shape variation in hook COMMENT — option 1: preserve baseline shape, document the contract), S2 (ORDER BY org_id in helper for deterministic array output), N1 (codify UNION-canonical invariant in `infrastructure/supabase/CLAUDE.md`), N2 (8 new Stage E smoke probes added — covering trigger TG_OPs, M1 regression, mixed coverage, regression of rewritten body, switched-org enumeration, DELETE-without-OLD, 100-user latency), N3 (reorder `claims_version` before `claims_error` in EXCEPTION branch for truncation-safety). **Step 5 readiness**: architect confirms can proceed after M1 lands; Step 5's backfill SQL WHERE clause must carry M1 forward (`g.consultant_org_id = ANY(u.accessible_organizations)` not `= u.current_organization_id`). Next in sequence: Step 5 (one-time backfill DO-block — idempotent dedup of grants into `accessible_organizations`) → Step 6 (composite partial index closing the auth-hook query gap) → Step 7 (10 C-legacy RPC normalizations in plan.md constraint #7 / F2 ordering) → Step 8 (M3 re-tag) → Step 9 (CHECK constraint) → Step 10 (`access_grant.policy_override_applied` handler + perm-defined events) → Step 11 (170-RPC `@a4c-bucket` backfill). Steps 12/13 are file additions (codegen script + CI workflow) rather than SQL. Steps 14 + 15 close the migration.
