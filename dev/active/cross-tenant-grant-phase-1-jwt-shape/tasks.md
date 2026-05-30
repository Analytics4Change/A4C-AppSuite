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
- [ ] Auth-hook baseline-latency capture: `EXPLAIN ANALYZE` p50/p95 over 100 invocations of `compute_effective_permissions(<user>, <org>)` against dev — record for Stage E delta comparison **(HELD — requires representative user/org IDs; awaiting user direction)**
- [x] `claims_version` JWT distribution probe: all extant dev sessions at v4 (not v3 or NULL) — **PASS-WITH-INTERPRETATION** (all `auth.users.raw_app_meta_data->>'claims_version'` are NULL because the hook does not persist `claims_version` to that column; codebase audit confirms only 2 emit sites — both baseline_v4 and `20260226002002` — set it to literal `4`. No drift. Step 3's bump to 5 lands alongside a single prior shape.)
- [x] RPC count re-verification (step 11 scope): net-of-DROPs count = 104; any post-2026-05-26 new `api.*` RPCs identified + matrix-classified BEFORE migration drafts — **PASS** (zero new `api.*` CREATE statements since 2026-05-26 on either branch ancestry or `main`; matrix doc requires no pre-Phase-1 backfill of new entries)
- [ ] Five-tier JWT consumer audit complete; breaking tiers identified (architect 2026-05-29 confirmed Frontend / EF / Workflows tiers all duplicate-safe today)
- [x] Concurrency check: no in-flight PR on `main` touching `compute_effective_permissions` — **PASS** (1 open PR — #45 `refactor(users)` — 0 Phase-1-surface lines across `compute_effective_permissions`, `custom_access_token_hook`, `get_permission_scope`, `has_effective_permission`, `cross_tenant_access_grants*`, `permission_implications`, `grant_role_templates`)
- [ ] Baseline build green: `frontend` + `workflows` build against current generated types **(HELD — awaiting user direction; no probe-side blockers)**

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

**Per-bucket deltas to the matrix doc**:
| Bucket | Pre | Post | Δ |
|---|---:|---:|---:|
| A / A-variant | 1+1 | 1+1 | 0 |
| B | 15 | 51 | +36 net (+41 missing-72, -5 stale schedule) |
| C | 3 | 20 | +17 |
| C-legacy | 10 | 10 | 0 |
| D | 34 | 36 | +2 net (+4 missing-72, -2 stale schedule) |
| D-variant | 1 | 5 | +4 |
| E | 38 | 44 | +6 |
| E-variant | 1 | 1 | 0 |
| **Total** | 104 | 169 (live: 170 — 1-row residual) | +65 |

**Artifacts produced**:
- `matrix-reconciliation-inventory.md` (439+ lines) — full pg_proc dump + set diff + R-2 classification work-product
- `documentation/architecture/authorization/cross-tenant-access-grant-rpc-reachability-matrix.md` — master table now 170 rows; per-bucket counts updated; Phase 4 RLS audit list expanded to 41 RPCs; new "Stage R reconciliation 2026-05-29 — structural notes" subsection in § Edge cases documenting the B-vs-C path-source discriminator, the `update_organization` vestigial-variable pattern, the schedule template family COALESCE hybrid pattern, the `safety_net_deactivate_organization` service-role-only pattern, and the `deactivate_user` E-classification matching `delete_user`.

**Step 11 scope expansion implication**: step 11 originally drafted as "backfill on all 104 RPCs"; now backfills **on all ~170 RPCs**. Migration size grows from ~104 `COMMENT ON FUNCTION` statements to ~170. Still single-transactional; no risk; pre-merge architect review accounts for the larger surface. Step 11 drafting unblocked.

#### Held items

- **Auth-hook baseline-latency capture** — requires representative single-org user/org IDs from dev. Holding per user direction.
- **Baseline build green** — `frontend` + `workflows` builds against current generated types. Holding per user direction; no probe-side blockers identified.

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

**Stage**: B (pre-flight probes) — closing. Stage R (matrix-doc reconciliation) **complete 2026-05-29**; remaining Stage B items: auth-hook baseline-latency + baseline-build-greens (both user-held).
**Status**: Card seeded 2026-05-28. Architect review of plan.md 2026-05-29 returned APPROVE WITH IN-PR FIXES (4 must-fix F1-F6 + 4 nits N1-N4) — all findings folded in same-day. **Stage B pre-flight probes ran 2026-05-29 — all 6 user-requested probes PASS**. **Stage R matrix-doc reconciliation completed 2026-05-29**: 72 missing-from-matrix user-facing CRUD RPCs classified (B=41 / C=17 / D=4 / D-variant=4 / E=6; zero new C-legacy or A); 7 stale-in-matrix `*_user_schedule` entries removed; matrix doc + Phase 4 audit list + edge cases section all updated; full work-product persisted in `matrix-reconciliation-inventory.md`. Step 11 scope expanded from 104 → 170 RPCs (still single-transactional). Architect re-review of updated matrix pending (Stage R-6). NO migration SQL drafted yet.
**Next action**: User decision —
  (a) execute Stage R-6 architect re-review of the updated matrix doc (per plan recommendation to catch miscategorizations at the cheap stage);
  (b) capture auth-hook baseline-latency (requires representative dev user/org IDs);
  (c) run the held baseline-build-green checks (`frontend` + `workflows` typecheck against current generated types);
  (d) advance to Stage C drafting once (a)+(b)+(c) addressed.
