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
- [x] **Architect review of plan.md** — `software-architect-dbc` — COMPLETED 2026-06-04. Verdict APPROVE WITH IN-PR FIXES. 5 must-fix F1-F5 + 6 should-fix S1-S6 + 3 nits N1-N3 + 5 sub-decisions G-K to lock. All folded same-day.
- [x] User-facing sub-decisions G/H/J answered (2026-06-04): G=partial UNIQUE, H=cascade-revoke, J=seed `partnership.manage`. Architect-recommended choice on each.

## Stage B — Pre-flight checks (per plan.md § Verification step 1)

- [x] Row-count probe on dev: `SELECT COUNT(*) FROM public.cross_tenant_access_grants_projection;` returns **0** (Phase 1 cleanup verified — safe deploy)
- [x] Schema non-collision probe: `var_partnerships_projection` does NOT exist on dev (`information_schema.tables` returns `table_exists: false`)
- [x] Auth-hook baseline-latency capture: Phase 1 reference user `61cbb03f-…0821` no longer exists on prod (verified `SELECT FROM users WHERE id = ...` returned empty). Re-baselined with valid single-org single-role user `093c0e7b-5ace-49df-9632-d49858d54ef5` / org `2d0829ae-224b-4a79-ac3a-726b00d6c172` (the same user used for Phase 1 Stage E smoke tests). **Result**: n=100, mean=**0.193 ms**, p50=**0.085 ms**, p95=**0.126 ms**, min=0.081, max=10.385, permission_rows=2. **Phase 2 Stage E clearance criterion**: keep p95 within ~2× baseline = **0.25 ms**. (Note: Phase 1's recorded baseline was for a higher-permission-count user; recalibration here is fair since Phase 2 doesn't change `compute_effective_permissions`.)
- [x] Five-tier consumer audit: deferred to Stage D type-regen — Phase 2 adds 10 new RPCs + 1 new permission + 1 new event family + 1 new permission; consumers TBD. Phase 1 architect-verified five-tier compatibility (frontend / EF / workflows / RLS / RPC consumers) stands for Phase 2 because Phase 2 doesn't change the JWT shape or the auth hook.
- [x] Concurrency check: `gh pr list --base main --state open` returned 1 PR (#45 `followup/blocker-3-followup-2-fallback-removal`) — does NOT touch Phase 2 surface (var_partnerships, access_grant emit RPCs, process_domain_event, partnership.manage)
- [x] Baseline build green: `frontend` + `workflows` `tsc --noEmit` exit 0 on HEAD `d3de86e9`
- [x] `npm run gen:rpc-reachability-matrix` against current dev (verified via row count): **170 RPCs** in PER-RPC-TABLE section, matches live `pg_proc` distinct count (170). No drift since Phase 1 ship.
- [x] **S1 per architect**: `grep -nE "CREATE OR REPLACE FUNCTION public\._" infrastructure/supabase/supabase/migrations/*.sql` → **zero matches**. Underscore-prefix convention is uncontested. Lock as new convention; codify in `infrastructure/supabase/CLAUDE.md` with mandatory `REVOKE ALL FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE TO service_role` ritual.

**Stage B CLOSED 2026-06-04**. All 7 probes pass. Ready for Stage C drafting.

## Stage C — Migration drafting (17 manifest steps)

> Architect review fires per Phase 1 cadence (9 passes) — see plan.md § Architect-review checkpoints.

- [x] **Step 1** — `CREATE TABLE var_partnerships_projection` (21 cols, status CHECK 4-value, partnership_type CHECK, support_level CHECK, partial UNIQUE per sub-decision G, FKs with ON DELETE CASCADE per F2 fold-in)
- [x] **Step 2** — 3 RLS policies (org-admin BOTH-sides SELECT via `has_effective_permission('organization.view', <org_path>)` scope-bound — deliberate departure from baseline `get_current_org_id()` pattern per F1 fold-in; platform-admin SELECT; service-role SELECT; NO write policies)
- [x] **Step 3** — 3 partial indexes (partner_org_id active, provider_org_id active, contract_end_date active+nonnull)
- [x] **Architect review of Steps 1-3 2026-06-04** — APPROVE WITH IN-PR FIXES; F1+F2+F3 must-fix + S2+S3 should-fix all folded same-day. Migration file at 276 lines / 17 statements after fold-in.
- [x] **Step 4.0 (NEW per Chunk 2 architect F2)** — `public.safe_jsonb_extract_numeric(jsonb, text, numeric)` 7th member of safe_jsonb_extract_* family. Symmetric with safe_jsonb_extract_date body shape.
- [x] **Step 4** — `process_var_partnership_event` router with 5-arm INLINE CASE + ELSE RAISE EXCEPTION P9001. F1 idempotency guard on stream_id replay added per architect fold-in.
- [x] **Step 5** — Dispatcher CASE extension on `public.process_domain_event()`. FULL deployed body preserved (DECLARE + idempotency + PII three-layer model + clock_timestamp + ERRCODE P9002). New `WHEN 'var_partnership'` branch inserted between `client` and administrative-absorbed types. Reference file `handlers/trigger/process_domain_event.sql` synced in same commit per S2.
- [x] **Architect review of Steps 4-5 2026-06-04** — APPROVE WITH IN-PR FIXES; F1+F2 must-fix + S1+S2 should-fix + N1+N2 nits all folded same-day. New router reference file `handlers/routers/process_var_partnership_event.sql` created.
- [x] **Step 6** — `public._validate_authorization_var_contract` (STABLE, SECURITY DEFINER, GRANT EXECUTE service_role only; queries var_partnerships_projection for ACTIVE row). 'suspended' status intentionally excluded per S1.a fold-in.
- [x] **Step 7** — `public._validate_authorization_emergency_access` (returns TRUE unconditionally; signature uniformity for Phase N court/agency/family helpers per N2 fold-in)
- [x] **Step 7b (per sub-decision J + F1 fold-in)** — THREE-PART seed per canonical Phase 1 + `20260422052825_*.sql:653-680` precedent:
  - 7b.a: emit `permission.defined` event (precondition-guarded)
  - 7b.b: INSERT INTO role_permission_templates ('provider_admin', 'partnership.manage') ON CONFLICT DO NOTHING — future bootstraps grant it
  - 7b.c: BACKFILL existing provider_admin roles' role_permissions_projection — closes gap for existing prod tenants
- [x] **Architect review of Steps 6-7b 2026-06-04** — APPROVE WITH IN-PR FIXES; F1 must-fix (partnership.manage bundling gap — Option A: implement plan as written via template INSERT + backfill) + S1.a should-fix (SECURITY DEFINER COMMENT honesty) + N2 nit (ADR cross-reference) all folded same-day. Phase-N validator helper gotcha noted in observations.md.
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

- [ ] **HARD BLOCKER before Chunk 4 (emit RPCs) merges** (Chunk 2 architect review 2026-06-04): `infrastructure/supabase/contracts/asyncapi/domains/var_partnership.yaml` (NEW, 5 messages with stream_id/stream_type/event_type/event_data/event_metadata structure per access_grant.yaml precedent; payloads enumerate keys per plan.md § "Event payload schemas") + `infrastructure/supabase/contracts/asyncapi/domains/access_grant.yaml` (add `AccessGrantPolicyOverrideApplied` per PR #70 N1) + `infrastructure/supabase/contracts/asyncapi/asyncapi.yaml` (var_partnership channel + stream_type enum L252). The router (Step 4, shipped Chunk 2) currently handles 5 event types with NO AsyncAPI schemas — emit RPCs at Steps 11-15 make these externally observable, so AsyncAPI must land before/with that chunk.
- [ ] `npm run generate:types` + commit regen + `cp` to `frontend/src/types/generated/generated-events.ts`
- [ ] `infrastructure/supabase/handlers/routers/process_var_partnership_event.sql` (NEW reference file, inline pattern)
- [ ] `infrastructure/supabase/handlers/trigger/process_domain_event.sql` (add var_partnership branch)
- [ ] `infrastructure/supabase/CLAUDE.md` (codify underscore-prefix private-helper convention)
- [ ] `documentation/architecture/data/provider-partners-architecture.md` (verify no drift from ADR C.3; PR #68 cohesion review noted stale L376-433 — confirm fixed)

## Stage E — Smoke & UAT (per plan.md § Stage E smoke probes — 21 probes)

- [ ] **Pre-deploy probe**: re-run row-count probe on `cross_tenant_access_grants_projection` (still 0); confirm `var_partnerships_projection` still does NOT exist (no race with another in-flight branch)
- [ ] `supabase db push --linked` to dev → confirm `Finished supabase db push.`
- [ ] **Batch 1 — Structural (10 probes)**: var_partnerships_projection 14-col shape; status/partnership_type/support_level CHECK enums; UNIQUE present; 3 RLS + 0 write policies; 3 indexes; dispatcher CASE has WHEN 'var_partnership'; router 5-arm + ELSE using `\y` regex; all 9 new api.* RPCs tagged (M3 SQL-side extraction; 0-untagged regression)
- [ ] **Batch 2 — Dynamic (12 probes, +1 per F5)**: VAR partnership create/suspend/reactivate/terminate; create_access_grant happy + emergency_access NULL + non-emergency NULL fails CHECK; INTERSECT narrowing; permission-snapshot equality; revoke_access_grant happy; revoke_permission_across_grants partial-failure; RLS deny-by-default; recompute_user_accessible_organizations invariant preserved; **F5 NEW** — `var_default` template-created grant `permissions` jsonb is exactly 4 literal `partner.*` permissions (no derived implications) — HIPAA least-authority guarantee
- [ ] **Batch 3 — Cascade (NEW per sub-decision H)**: 2 active var_contract grants citing 1 partnership → terminate → both grants revoked with `revocation_reason='var_partnership_terminated'`; partial-cascade failure envelope shape verified
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

**Stage**: C (drafting) — IN PROGRESS. Stages A + B closed 2026-06-04. Chunks 1+2+3 of Stage C complete with architect reviews folded.
**Status**: Migration at ~895 lines / 35 top-level statements. Chunks 1-3 (Steps 1-7b) on branch HEAD pending Chunk 3 fold-in commit. All 3 chunks reviewed + folded same-day (F1+F2+F3+S2+S3 for Chunk 1; F1+F2+S1+S2+N1+N2 for Chunk 2; F1+S1.a+N2 for Chunk 3 + Phase-N validator gotcha noted).
**Next action** (after context clear): Chunk 4 — Step 8 `api.create_access_grant` (largest single RPC; ADR L184-213 locked body skeleton; 13 params; F1 + F2 + K fold-ins from plan-mode pre-applied). This is the biggest single-RPC drafting of Phase 2; fresh context recommended.

## Resume guide (for fresh-context continuation)

If picking up in a new conversation, read these in order:

1. **Card files**:
   - `dev/active/cross-tenant-grant-phase-2-write-side/plan.md` — 17-step manifest + locked sub-decisions A-K + architect plan-mode review fold-in
   - `dev/active/cross-tenant-grant-phase-2-write-side/tasks.md` (this file) — per-step progress + Stage B/C status
   - `dev/active/cross-tenant-grant-phase-2-write-side/observations.md` — carry-forwards + pre-existing divergences out of scope

2. **Memory**:
   - `~/.claude/projects/-home-lars-dev-A4C-AppSuite/memory/MEMORY.md` — groom log + user prefs + key patterns
   - `~/.claude/projects/-home-lars-dev-A4C-AppSuite/memory/pr-70-close-out.md` — Phase 1 close-out + 4 codified pitfalls
   - `~/.claude/projects/-home-lars-dev-A4C-AppSuite/memory/feedback-no-deferral-to-cards.md` — default "APPROVE WITH IN-PR FIXES" verdict
   - `~/.claude/projects/-home-lars-dev-A4C-AppSuite/memory/feedback-branch-on-decision.md` — branch immediately on card-work decision

3. **ADR**:
   - `documentation/architecture/decisions/adr-cross-tenant-access-grant-jwt-shape.md` Decisions C.1-C.5 (lines 177-367)

4. **Migration in progress**:
   - `infrastructure/supabase/supabase/migrations/20260604210910_cross_tenant_grant_phase_2_write_side.sql`
   - Per CLAUDE.md `infrastructure/supabase/CLAUDE.md` § codified pitfalls: PG `\y` not `\b`; psql `-R` row-separator for codegen; EXISTS form for `ANY((SELECT))`; `IF NOT EXISTS` precondition (NOT `EXCEPTION WHEN unique_violation`)

5. **Branch + push status**: branch `feat/cross-tenant-grant-phase-2-write-side` pushed; HEAD `c9ad76c3` (Chunk 2 fold-in). All work durable in git.

### Chunking strategy (7 total; 2 done, 5 remaining)

| Chunk | Steps | Status |
|---|---|---|
| 1 | 1-3 (schema) | ✅ done; architect F1+F2+F3+S2+S3 folded |
| 2 | 4.0 + 4 + 5 (helper + router + dispatcher) | ✅ done; architect F1+F2+S1+S2+N1+N2 folded |
| **3** | **6 + 7 + 7b** (validation helpers + partnership.manage seed) | **NEXT** |
| 4 | 8 (`api.create_access_grant` — largest RPC, alone) | pending |
| 5 | 9 + 10 (revoke flow incl. multi-event partial-failure per F3 I-fold) | pending |
| 6 | 11-15 (5 VAR emit RPCs incl. Step 13 cascade-revoke) | pending |
| 7 | 16 + 17 (read RPC + COMMENT ON FUNCTION tags) | pending |

### Architect-review cadence

Fires after each chunk per Phase 1 cadence (sub-decision 3 user-locked). 9 total passes planned; 2 done. Default verdict for non-blocking findings = "APPROVE WITH IN-PR FIXES" with same-day fold-in.

### Codified-pitfall checklist (apply during every chunk)

1. PG regex word-boundary: use `\y` not `\b`
2. Codegen reading `pg_description.description`: use psql `-R '<<<A4C_ROW>>>'` row-separator OR SQL-side `~` extraction
3. `ANY((SELECT array_col FROM CTE))`: use EXISTS form with column reference
4. Handler precondition: use `IF NOT EXISTS ... THEN INSERT` (NOT `EXCEPTION WHEN unique_violation`)
5. **NEW from Chunk 2**: BEFORE `CREATE OR REPLACE FUNCTION` of any pre-existing function, fetch the deployed body via Mgmt API SQL (`pg_get_functiondef`) to verify load-bearing semantics aren't silently dropped (caught my dispatcher draft missing the PII three-layer model + idempotency guard + ERRCODE P9002).

### Architect-clearance criteria

- Auth-hook latency p95: ≤ 0.25 ms (Stage B baseline 0.126 ms × 2)
- M3 RPC registry: 0 untagged regressions (post-Chunk 7)
- Reachability matrix: +10 rows (5 VAR + 3 grant + 1 read + 1 cascade-extended terminate); C-legacy still 0
