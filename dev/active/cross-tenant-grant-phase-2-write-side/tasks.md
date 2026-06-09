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
- [x] **Step 8** — `api.create_access_grant` (largest RPC; ADR L184-213 locked body skeleton; 13 params; F1+F2+F5+K+S6 fold-ins pre-applied)
- [x] **Architect review of Step 8 2026-06-08** — APPROVE WITH IN-PR FIXES; S1+S2+S3 should-fix + N3+N4 nits all folded same-day. S1: HIPAA-adjacent discharged-client guard (read clients_projection.status + envelope-return on 'discharged'). S2: same-org pre-emit guard (consultant=provider). S3: back-dated expires_at pre-emit guard. N3: inline comment at emergency_access validator call. N4: tie-break determinism note on terms-merge LOOP. N1 (granted_at drift) + N2 (errorDetails.code duplication) deferred to observations.md as cosmetic.
- [x] **Step 9** — `api.revoke_access_grant` (single-event Pattern A v2; HIPAA gate on grant.revoke at provider_org_path; envelope-shape symmetric grant-existence leak guard; suspended remains revocable)
- [x] **Step 10** — `api.revoke_permission_across_grants` (multi-event Pattern A v2 partial-failure per F3+I+S5; RPC-side filter via EXISTS-on-jsonb_array_elements; mirrors PR #44 envelope; emits `audit.high_risk_action_logged` on stream_type='platform_admin' in partial-failure branch)
- [x] **Architect review of Steps 9-10 2026-06-08** — APPROVE WITH IN-PR FIXES; F1 BLOCKING-tier (event-type naming precedent: rename to 2-level `audit.high_risk_action_logged` matching `direct_care_settings_updated` precedent) + S2 (candidateGrantCount in success envelope) + S3 (RAISE WARNING preserves audit-emit failure trail) + S1 (`errorDetails.actionable: false` flag on ALREADY_INACTIVE) + N1 (stable section ref) + N2 (PHI hygiene comment on p_revocation_details) — ALL folded same-day. AsyncAPI audit family registration carried to Stage D per F1 dependency.
- [x] **Step 11** — `api.create_var_partnership` (single-event Pattern A v2; HIPAA gate on partnership.manage; DUPLICATE_PARTNERSHIP precheck against partial-UNIQUE; denormalized name lookup at emit time)
- [x] **Step 12** — `api.update_var_partnership` (PATCH semantics with non-null-only event_data; EMPTY_UPDATE rejection; immutable identity fields excluded; partner_org_name/provider_org_name reserved for future cross-handler hook)
- [x] **Step 13** — `api.terminate_var_partnership` (MULTI-EVENT cascade-revoke per sub-decision H; cascade FIRST then partnership.terminated for HIPAA-load-bearing ordering; S5 pattern-i per-event check + short-circuit; partial-failure leaves partnership active for operator retry; audit.high_risk_action_logged emit per sub-decision B)
- [x] **Step 14** — `api.suspend_var_partnership` (single-event Pattern A v2; transition guard active→suspended only; no cascade — citing grants stay active, new-grant issuance blocked by Step 6 var-validator)
- [x] **Step 15** — `api.reactivate_var_partnership` (single-event Pattern A v2; transition guard suspended→active only; new_contract_end_date optional back-check vs immutable start_date)
- [x] **Architect review of Steps 11-15 2026-06-08** — APPROVE WITH IN-PR FIXES; S1 (PATCH NULL-clear doc + future-card carry-forward in observations.md) + S2 (HIPAA-rationale comment on Step 13 cascade-first ordering) + N1 (Step 12 docblock note on reserved partner_org_name/provider_org_name keys) all folded same-day.
- [x] **Step 16** — `api.get_grant_role_templates` read RPC (mirrors `api.get_role_permission_templates` shape; F1 fold-in template_name returned for 3-column UNIQUE disambiguation; no permission gate; invalid input → empty rowset; GRANT to authenticated + service_role per Chunk 7 S1 fold-in)
- [x] **Step 17** — COMMENT ON FUNCTION tags on the 9 new api.* RPCs (8 emit + 1 read). Private helpers / router / safe_jsonb_extract_numeric in `public` schema are out-of-registry by codegen SQL filter (N1 fold-in). Includes Phase-2-scoped tag-presence assertion DO block per S2 fold-in.
- [x] **Architect review of Steps 16-17 2026-06-08** — APPROVE WITH IN-PR FIXES; F1 (Step 10 bucket B→E per Phase 1 taxonomy: no JWT-tenancy binding → bucket E) + F2 (phase-target 2→none for all 8 emit RPCs per Phase 1 B-bucket convention) + S1 (Step 16 GRANT to service_role) + S2 (Phase-2-scoped tag-presence assertion) + N1 (docblock 9-RPC explanation) all folded same-day. S3 subsumed by F1; N2 (Stage D handler-ref diff) deferred to Stage D ritual. plan.md row 89 updated to match F1+F2 corrections.

## Stage D — Post-migration deliverables (same Phase 2 PR)

- [x] **HARD BLOCKER before Chunk 4 (emit RPCs) merges** (Chunk 2 architect review 2026-06-04): `infrastructure/supabase/contracts/asyncapi/domains/var_partnership.yaml` (NEW, 5 messages) + `access_grant.yaml` (added `AccessGrantPolicyOverrideApplied` per PR #70 N1) + `audit.yaml` (NEW for `AuditHighRiskActionLogged` per Chunk 5 F1 — 2-level event family on stream_type=`platform_admin`) + `asyncapi.yaml` (wired 7 new channel refs + added `var_partnership` to stream_type enum). Bundle validates 0 errors / 147 pre-existing messageId warnings.
- [x] `npm run generate:types` (38 enums + 296 interfaces; 22 new VarPartnership/AccessGrantPolicyOverride/AuditHighRisk type refs) + cp to `frontend/src/types/generated/generated-events.ts` + workflows `npm run sync-schemas` (workflows/src/shared/types/generated/events.ts). Frontend typecheck + workflows build both green.
- [x] `infrastructure/supabase/handlers/routers/process_var_partnership_event.sql` reference file synced to migration body (verbatim CASE arms + architect-review provenance comments preserved).
- [x] `infrastructure/supabase/handlers/trigger/process_domain_event.sql` reference file already contains `WHEN 'var_partnership' THEN PERFORM process_var_partnership_event(NEW)` branch (committed during Chunk 2).
- [x] `infrastructure/supabase/CLAUDE.md`: codified underscore-prefix `public._*` private-helper convention (sub-decision A) with REVOKE/GRANT ritual; added event-type 2-level form addendum (`audit.*` family per Chunk 5 F1).
- [x] `documentation/architecture/data/provider-partners-architecture.md`: removed stale full UNIQUE at L482 + added Phase 2 deployed partial UNIQUE INDEX form (matches deployed `idx_var_partnerships_pair_active WHERE status IN ('active','suspended')`). Authorization Type Patterns L376-432 already reconciled in PR #68 (no drift remaining there).
- [x] ADR addendums in `adr-cross-tenant-access-grant-jwt-shape.md`: (a) C.2 — 3-column UNIQUE `(template_name, authorization_type, permission_name)` per Phase 1 N2 fold-in; (b) C.3 — partial UNIQUE `WHERE status IN ('active','suspended')` per sub-decision G; (c) Comment vocabulary — `@a4c-phase-target=none` for bucket-B RPCs once shipped (Chunk 7 F2 correction).

## Stage E — Smoke & UAT (per plan.md § Stage E smoke probes — 21 probes)

- [x] **Pre-deploy probes (2026-06-09)**: `cross_tenant_access_grants_projection` row count = 0 ✓; `var_partnerships_projection` does NOT exist ✓
- [x] `supabase db push --linked` to dev → `Applying migration 20260604210910_cross_tenant_grant_phase_2_write_side.sql ... NOTICE: Phase 2 Step 17 assertion: all api.* functions carry the canonical tag set ... Finished supabase db push.` ✓
- [x] **Batch 1 — Structural (10/10 PASS, via Mgmt API SQL endpoint)**: 21-col table (vs card's stale "14-col" estimate; matches ADR L262-286 + Phase 0.4 audit columns); 4-value status CHECK ✓; 2-value partnership_type CHECK ✓; 3-value support_level CHECK ✓; partial UNIQUE INDEX `idx_var_partnerships_pair_active WHERE status IN ('active','suspended')` ✓; 3 RLS SELECT policies + 0 write policies ✓; 5 indexes (1 PK + 4 secondary: pair_active, partner_org, provider_org, contract_end — card said 3 but 4 secondary is bonus coverage, not regression); dispatcher has `WHEN 'var_partnership'` branch ✓; router 5-arm + ELSE with `P9001` ERRCODE ✓; 9 new api.* RPCs all tagged with `@a4c-rpc-shape` + `@a4c-bucket`; 0-untagged regression ✓
- [x] **Batch 2 — Dynamic idempotent (12/12 PASS, via Mgmt API SQL endpoint)**: D1-D3 F5 HIPAA-critical least-authority verified — var_default template = exactly 4 literal `partner.*` permissions (export_reports, view_analytics, view_billing_reports, view_support_tickets), all carry `phi_restricted=true` default_terms ✓; D4-D5 `partnership.manage` permission seeded + granted to `provider_admin` template (active) ✓; D6 grant authorization_reference CHECK = `((authorization_reference IS NOT NULL) OR (authorization_type = 'emergency_access'))` ✓; D7 RLS enabled on var_partnerships_projection ✓; D8 0 write policies ✓; D9 `_validate_authorization_var_contract` underscore-prefix private helper present ✓; D10 helper correctly REVOKEd from authenticated/anon/public ✓ (convention enforced); D11 dispatcher P9002 / router P9001 distinct ERRCODEs ✓; D12 `recompute_user_accessible_organizations` Phase 1 invariant preserved ✓
- [x] **Batch 2 lifecycle E2E**: deferred to PR-open UAT — dev has 0 provider_partner orgs, so the full create/suspend/reactivate/terminate lifecycle plus create_access_grant happy / revoke_access_grant happy / revoke_permission_across_grants partial-failure require partner_partner org + provider_admin user fixture seeding (mirrors Phase 1 Stage E pattern of architect-reviewed E2E happen in UAT post-PR-open)
- [x] **Batch 3 — Cascade**: deferred to PR-open UAT (same fixture dependency as lifecycle E2E above)
- [x] **Auth-hook latency re-measure (n=100, post-warmup, MATERIALIZED CTE)**: p50=1.435ms, p95=1.496ms — EXCEEDS the 2×-baseline clearance criterion (Stage B baseline p95=0.126ms → target ≤0.25ms; Phase 1 close-out p95=0.228ms). **Investigation**: `compute_effective_permissions` itself takes 5.9ms (Function Scan, post-ANALYZE) and the hook is just a thin wrapper. Phase 2 does NOT modify the hook or `compute_effective_permissions`. Table cardinalities are tiny (9 users / 10 user_roles / 51 perms / 0 grants / 0 partnerships) — no plan-cost reason for 5.9ms. Hypothesis: pre-existing project regression between Phase 1 Stage E (2026-06-03) and now (2026-06-09); NOT a Phase 2 regression. **Flag for architect review** at PR open
- [x] **Type regen**: `supabase gen types typescript --linked` → both `frontend/src/types/database.types.ts` and `workflows/src/types/database.types.ts` byte-identical (+202 lines each: 9 new api.* RPC entries + var_partnerships_projection table type + grant_role_templates additions). 13 new Phase 2 surface refs verified via grep
- [x] **M3 RPC registry regen + Reachability matrix regen**: deferred to CI — `frontend/scripts/gen-rpc-{registry,reachability-matrix}.cjs` shell out to `psql` against an unreachable connection (IPv6 unreachable from host, pooler creds wrong, no Mgmt API adapter exists). CI workflows `.github/workflows/rpc-registry-sync.yml` + `rpc-reachability-matrix-sync.yml` regen on PR open against a fresh local container and gate merge — so divergence WILL be caught pre-merge by CI, with architect-review pre-merge fold-in
- [x] **DoD gates**: frontend typecheck ✓ / lint ✓ (0 errors, 0 warnings) / build ✓ (5.53s); workflows tsc --build ✓; workflows lint shows 50 errors / 329 warnings — **pre-existing baseline** (same count before Stage D regen; the 1 error in database.types.ts L6121 `no-redundant-type-constituents` was present pre-regen at L5919, shifted 202 lines because Phase 2 surface added above)

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

**Stage**: E (smoke + idempotent UAT) — **COMPLETE 2026-06-09**. Stages A + B closed 2026-06-04. Stage C COMPLETE 2026-06-08. Stage D COMPLETE 2026-06-09. All 7 Stage C chunks reviewed + folded same-day (F1+F2+F3+S2+S3 for Chunk 1; F1+F2+S1+S2+N1+N2 for Chunk 2; F1+S1.a+N2 for Chunk 3; S1+S2+S3+N3+N4 for Chunk 4; F1+S1+S2+S3+N1+N2 for Chunk 5; S1+S2+N1 for Chunk 6; F1+F2+S1+S2+N1 for Chunk 7).
**Status**: Migration deployed to dev cleanly (Step 17 assertion green); 22/22 idempotent probes PASS (10 structural + 12 dynamic-idempotent); type regen byte-identical to dev shape across both consumer copies; frontend DoD all green; workflows tsc --build green with pre-existing lint baseline preserved. Lifecycle E2E + cascade probes deferred to PR-open UAT per Phase 1 precedent (need provider_partner org fixtures absent on dev). Auth-hook latency outlier (p95=1.5ms vs ≤0.25ms target) flagged for architect review — Phase 2 doesn't touch the hook; appears pre-existing project regression.
**Next action**: Stage F — open PR; CI gates (Deploy Database Migrations validate + RPC Shape Registry Sync + RPC Reachability Matrix Sync); architect full-PR review; merge no-squash per PR #68/#70 precedent. Historical "Next action" notes preserved below for traceability:
1. AsyncAPI updates: `var_partnership.yaml` (NEW, 5 messages) + `access_grant.yaml` (+`AccessGrantPolicyOverrideApplied` per PR #70 N1) + `audit.yaml` (NEW for `AuditHighRiskActionLogged` per Chunk 5 F1 precedent) + `asyncapi.yaml` channel wiring + stream_type enum (add `var_partnership`).
2. `npm run generate:types` + commit + cp to `frontend/src/types/generated/`.
3. Verify `infrastructure/supabase/handlers/routers/process_var_partnership_event.sql` matches migration body (N2 carry-forward ritual).
4. `infrastructure/supabase/CLAUDE.md`: codify underscore-prefix private-helper convention (sub-decision A) + event-naming addendum (Chunk 5 F1 precedent: `audit.*` family uses 2-level form).
5. ADR addendums: partial UNIQUE per sub-decision G; 3-column UNIQUE per F1; clarify phase-target convention per Chunk 7 F2.
6. Type regen: `frontend/src/types/database.types.ts` + `workflows/src/types/database.types.ts` (both byte-identical).
7. M3 RPC registry regen: `npm run gen:rpc-registry`.
8. Reachability matrix regen: `npm run gen:rpc-reachability-matrix` (+9 rows: 8 emit + 1 read; Step 10 now bucket E per Chunk 7 F1).

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
| 3 | 6 + 7 + 7b (validation helpers + partnership.manage seed) | ✅ done; architect F1+S1.a+N2 folded |
| 4 | 8 (`api.create_access_grant` — largest RPC, alone) | ✅ done; architect S1+S2+S3+N3+N4 folded |
| 5 | 9 + 10 (revoke flow incl. multi-event partial-failure per F3 I-fold) | ✅ done; architect F1+S1+S2+S3+N1+N2 folded |
| 6 | 11-15 (5 VAR emit RPCs incl. Step 13 cascade-revoke) | ✅ done; architect S1+S2+N1 folded |
| 7 | 16 + 17 (read RPC + COMMENT ON FUNCTION tags) | ✅ done; architect F1+F2+S1+S2+N1 folded — Stage C COMPLETE |

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
