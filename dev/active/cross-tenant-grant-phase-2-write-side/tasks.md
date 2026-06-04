# Tasks — cross-tenant-grant Phase 2 write-side

> **Manifest source of truth**: plan.md § "17-step manifest" — itself derived from ADR `adr-cross-tenant-access-grant-jwt-shape.md` Decisions C.1-C.5 (lines 177-367). This file tracks per-step *progress*; it does NOT duplicate the manifest content.

## Stage A — Plan gate

- [x] Read ADR `adr-cross-tenant-access-grant-jwt-shape.md` Decisions C.1-C.5 in full
- [x] Read parent card `dev/active/cross-tenant-access-grant-rollout/` Phase 0.4 Outcomes + Phase 1 Outcomes
- [x] Read memory files: `pr-70-close-out.md`, `feedback-no-deferral-to-cards.md`, `feedback-branch-on-decision.md`
- [x] Read process_access_grant_event.sql (the closest sibling — Phase 1 just extended it)
- [x] Read api.get_role_permission_templates (mirror for `get_grant_role_templates`) at baseline_v4.sql:3492-3509
- [x] Read api.modify_user_roles (PR #44 partial-failure contract precedent for `revoke_permission_across_grants`) at `20260430172139_*.sql`
- [x] User-locked decisions captured (2026-06-04): expire deferred, 5 emit RPCs, Phase 1 review cadence
- [x] Sub-decisions A-F resolved at plan time
- [ ] **Architect review of plan.md** — `software-architect-dbc` — pending; must complete before any migration SQL drafted

## Stage B — Pre-flight checks (per plan.md § Verification step 1)

- [ ] Row-count probe on dev: `SELECT COUNT(*) FROM public.cross_tenant_access_grants_projection;` returns 0
- [ ] Schema non-collision probe: `var_partnerships_projection` does NOT exist on dev (confirms Phase 2 is the first to introduce it)
- [ ] Auth-hook baseline-latency capture: reuse Phase 1 representative user `61cbb03f-…0821` / org `2d0829ae-…c172` — 100-invocation `compute_effective_permissions` via Mgmt API SQL endpoint with per-row LATERAL + CASE-WHEN scalar-subquery-defeat pattern (see Phase 1 Stage B for exact harness)
- [ ] Five-tier consumer audit: confirm no new tier-touchpoints since Phase 1 architect-verified set (frontend, EF, workflows, RLS, RPC consumers)
- [ ] Concurrency check: `gh pr list --base main` returns no open PR touching var_partnership / access_grant / process_domain_event surface
- [ ] Baseline build green: `frontend` + `workflows` `tsc --noEmit` exit 0 on HEAD
- [ ] `npm run gen:rpc-reachability-matrix` against current dev produces 170-row matrix (no drift since Phase 1 ship)

## Stage C — Migration drafting (17 manifest steps)

> Architect review fires per Phase 1 cadence (9 passes) — see plan.md § Architect-review checkpoints.

- [ ] **Step 1** — `CREATE TABLE var_partnerships_projection` (14 cols, status CHECK, partnership_type CHECK, support_level CHECK, UNIQUE)
- [ ] **Step 2** — 3 RLS policies (org-admin both sides SELECT, platform-admin SELECT, service-role SELECT; NO write policies)
- [ ] **Step 3** — 3 indexes (2 partial WHERE status='active', 1 contract_end_date partial)
- [ ] **Architect review of Steps 1-3** — schema CHECK enums, RLS posture, partial UNIQUE topic
- [ ] **Step 4** — `process_var_partnership_event` router with 5-arm INLINE CASE + ELSE RAISE EXCEPTION P9001
- [ ] **Step 5** — Dispatcher CASE extension on `public.process_domain_event()`
- [ ] **Architect review of Steps 4-5** — router 5-arm + dispatcher branch + idempotency-guard form
- [ ] **Step 6** — `public._validate_authorization_var_contract` (SECURITY DEFINER, GRANT EXECUTE service_role only)
- [ ] **Step 7** — `public._validate_authorization_emergency_access`
- [ ] **Architect review of Steps 6-7** — private-helper convention codification + GRANT posture
- [ ] **Step 8** — `api.create_access_grant` (largest RPC; ADR L184-213 locked body skeleton)
- [ ] **Architect review of Step 8** — HIPAA gate, INTERSECT semantics, Pattern A v2 readback completeness
- [ ] **Step 9** — `api.revoke_access_grant`
- [ ] **Step 10** — `api.revoke_permission_across_grants` (multi-event Pattern A v2 partial-failure)
- [ ] **Architect review of Steps 9-10** — revocation flow + partial-failure contract
- [ ] **Step 11** — `api.create_var_partnership`
- [ ] **Step 12** — `api.update_var_partnership`
- [ ] **Step 13** — `api.terminate_var_partnership`
- [ ] **Step 14** — `api.suspend_var_partnership`
- [ ] **Step 15** — `api.reactivate_var_partnership`
- [ ] **Architect review of Steps 11-15** — 5 VAR emit RPCs batch (homogeneous)
- [ ] **Step 16** — `api.get_grant_role_templates` read RPC
- [ ] **Step 17** — COMMENT ON FUNCTION tags on all 13 new functions
- [ ] **Architect review of Steps 16-17 + AsyncAPI + type-gen** — M3 tag audit, var_partnership.yaml schema completeness, matrix regen diff

## Stage D — Post-migration deliverables (same Phase 2 PR)

- [ ] `infrastructure/supabase/contracts/asyncapi/domains/var_partnership.yaml` (NEW, 5 messages)
- [ ] `infrastructure/supabase/contracts/asyncapi/domains/access_grant.yaml` (add `AccessGrantPolicyOverrideApplied` — PR #70 N1)
- [ ] `infrastructure/supabase/contracts/asyncapi/asyncapi.yaml` (var_partnership channel + stream_type enum L252)
- [ ] `npm run generate:types` + commit regen + `cp` to `frontend/src/types/generated/generated-events.ts`
- [ ] `infrastructure/supabase/handlers/routers/process_var_partnership_event.sql` (NEW reference file, inline pattern)
- [ ] `infrastructure/supabase/handlers/trigger/process_domain_event.sql` (add var_partnership branch)
- [ ] `infrastructure/supabase/CLAUDE.md` (codify underscore-prefix private-helper convention)
- [ ] `documentation/architecture/data/provider-partners-architecture.md` (verify no drift from ADR C.3; PR #68 cohesion review noted stale L376-433 — confirm fixed)

## Stage E — Smoke & UAT (per plan.md § Stage E smoke probes — 21 probes)

- [ ] **Pre-deploy probe**: re-run row-count probe on `cross_tenant_access_grants_projection` (still 0); confirm `var_partnerships_projection` still does NOT exist (no race with another in-flight branch)
- [ ] `supabase db push --linked` to dev → confirm `Finished supabase db push.`
- [ ] **Batch 1 — Structural (10 probes)**: var_partnerships_projection 14-col shape; status/partnership_type/support_level CHECK enums; UNIQUE present; 3 RLS + 0 write policies; 3 indexes; dispatcher CASE has WHEN 'var_partnership'; router 5-arm + ELSE using `\y` regex; all 9 new api.* RPCs tagged (M3 SQL-side extraction; 0-untagged regression)
- [ ] **Batch 2 — Dynamic (11 probes)**: VAR partnership create/suspend/reactivate/terminate; create_access_grant happy + emergency_access NULL + non-emergency NULL fails CHECK; INTERSECT narrowing; permission-snapshot equality; revoke_access_grant happy; revoke_permission_across_grants partial-failure; RLS deny-by-default; recompute_user_accessible_organizations invariant preserved
- [ ] **Auth-hook latency re-measure**: p50/p95 within architect 2× clearance criterion (~0.5ms p95 max)
- [ ] **Type regen**: `npx supabase gen types typescript --linked > frontend/src/types/database.types.ts 2>/dev/null` + copy byte-identical to workflows
- [ ] **M3 RPC registry regen**: `npm run gen:rpc-registry` against dev (using Mgmt API adapter pattern from PR #70) → diff zero or expected additions only
- [ ] **Reachability matrix regen**: `npm run gen:rpc-reachability-matrix` → 9 new rows expected (5 VAR + 3 grant + 1 read); C-legacy still 0 (no Phase 2 regressions)
- [ ] **DoD gates**: frontend + workflows typecheck/lint/build all exit 0

## Stage F — PR + ship

- [ ] Pre-PR-open ritual: paste smoke evidence into card (log lines from dev)
- [ ] Open PR; CI gates: `Deploy Database Migrations` validate, `RPC Shape Registry Sync`, `RPC Reachability Matrix Sync`
- [ ] Architect-review the PR (`software-architect-dbc`); address in-PR fixes per `memory/feedback-no-deferral-to-cards.md`
- [ ] Merge no-squash per PR #68/#70 precedent (preserve per-step + architect-fold-in progression)
- [ ] Post-merge: 3 deploy gates green (Database Migrations, Frontend, Temporal Workers); no production alerts on auth-hook latency
- [ ] Prod state verification via Mgmt API: `var_partnerships_projection` exists; 9 new api.* RPCs in pg_proc; process_var_partnership_event exists; dispatcher branch present
- [ ] Update parent card `cross-tenant-access-grant-rollout/` tasks.md with Phase 2 outcomes
- [ ] Archive this card → `dev/archived/cross-tenant-grant-phase-2-write-side/`
- [ ] Memory close-out: `pr-NN-close-out.md` + MEMORY.md leading-pointer ONE LINE under ~200 chars per N3 rule

## Current Status

**Stage**: A (plan gate) — IN PROGRESS. Plan drafted 2026-06-04 from approved planning session. Sub-decisions A-F resolved. User-locked decisions captured.
**Status**: Card seeded 2026-06-04. Branch `feat/cross-tenant-grant-phase-2-write-side` created from main. plan.md + tasks.md + observations.md written. Awaiting architect plan-mode review before any migration SQL drafted.
**Next action**: Invoke `software-architect-dbc` for plan.md review (Phase 1 precedent: review verdict folded in same-day before Stage B starts).
