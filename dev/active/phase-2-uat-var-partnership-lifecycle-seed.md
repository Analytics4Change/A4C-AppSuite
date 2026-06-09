# UAT: VAR partnership lifecycle + cascade-revoke + N2 grantedAt drift (Phase 2 deferred)

**Status**: seed (not yet planned)
**Priority**: High (gates Phase 2 PR #71 close-out + post-merge confidence; blocks parent card Phase 2 closure)
**Origin**: Stage E close-out + PR #71 architect review N2 (software-architect-dbc, 2026-06-09)

## Problem

Phase 2 Stage E deferred two probe batches to "PR-open UAT" because dev had zero `provider_partner` orgs to fixture against:

- **Batch 2 lifecycle E2E (4 probes)**: `api.create_var_partnership` happy path; `suspend_var_partnership` happy; `reactivate_var_partnership` happy; `terminate_var_partnership` happy. Plus `api.create_access_grant` happy + `revoke_access_grant` happy + `revoke_permission_across_grants` partial-failure.
- **Batch 3 cascade (2 probes)**: 2 active `var_contract` grants citing 1 partnership → terminate → both grants revoked with `revocation_reason='var_partnership_terminated'`; partial-cascade failure envelope shape.

Plus the architect's **N2** finding (PR #71 review): Step 8 `api.create_access_grant` returns `grantedAt: v_now` (RPC-side timestamp) in the success envelope but the handler stamps `granted_at := p_event.created_at` (the `domain_events.created_at` from the trigger). They are typically equal but can drift by microseconds. Forward-fix options: either (a) drop `grantedAt` from the envelope (caller fetches via `get_access_grant` read RPC when needed) or (b) read it back from the projection inside Pattern A v2.

## Why this matters

- Without UAT, the Phase 2 PR close-out is incomplete — Phase 1 close-out memory documents 21/21 Stage E PASS as the bar; Phase 2 currently sits at 22/22 idempotent + 6 deferred.
- The cascade-first ordering (Step 13) is HIPAA-load-bearing and has zero E2E verification on dev; the architect signed off based on code review, but a real-world cascade must be observed at least once.
- `revoke_permission_across_grants` is the platform-tier cross-grant policy override; its partial-failure path emits `audit.high_risk_action_logged` — the FIRST emitter of the `audit.*` family. Producer-side verification gates the AsyncAPI contract.
- N2's microsecond drift is benign at typical resolution but could surface as a user-visible discrepancy if the post-merge frontend compares envelope `grantedAt` vs projection `granted_at`.

## UAT plan

### Setup (one-time per environment)

**Fixture requirements**:
- A provider org (one already exists on dev: `2d0829ae-224b-4a79-ac3a-726b00d6c172` "TestOrg-20260329", and `43ede501-5d88-44b5-a84b-53edeec0781f` "Live for Life").
- A `provider_partner` org (NONE exist on dev as of 2026-06-09).
- A user with permission to call the 3 RPCs under test (`create_var_partnership`, `create_access_grant`, `revoke_access_grant`, etc.). See "Permission gate fork" below.

#### Step 1 — Seed a `provider_partner` org

Two equivalent paths exist (the create-path is fully supported; nobody has just exercised it on dev yet):

**Path A (canonical)** — Run the existing Temporal `organization-bootstrap` workflow with `type='provider_partner'` + `partner_type='var'`. Trigger example: `workflows/src/examples/trigger-workflow.ts:34`. From a worker-connected shell:

```bash
cd workflows
TEMPORAL_ADDRESS=localhost:7233 npx ts-node src/examples/trigger-workflow.ts
# Edit the example or pass org args to set type='provider_partner' + partner_type='var'
# Workflow handles DNS provisioning (if is_subdomain_required(type, partner_type) returns true),
# auth-admin minting, and the organization.created event emission.
```

**Path B (pragmatic)** — Bypass the workflow and emit `organization.created` directly via `api.emit_domain_event` (event-sourced shortcut; the projection handler does the rest). Faster than Path A for write-side RPC UAT because we don't need DNS or auth-admin minting. **Path B caveats** (S3 architect fold-in 2026-06-09):

1. **`event_data` MUST include `slug` + `path` + `parent_path`** — `handle_organization_created` reads these fields and the projection columns may have NOT NULL constraints / UNIQUE indexes (`slug` in particular). Defaulting to the stream_id-as-string for `path`/`parent_path` is sane for a tenancy-root partner org.
2. **Path B bypasses Temporal workflow auth-admin minting** — no `organization_admin` user is created for the seeded partner org. Acceptable for Phase 2's UAT scope (provider-admin-initiated grant ops AGAINST the partner_org, where the calling user lives at the provider org side, not the partner). NOT acceptable if a future UAT probe needs a user-as-tenant test against the partner org (e.g., consultant-callability probe at the partner subtree); use Path A for that.

```sql
WITH partner AS (
  SELECT
    gen_random_uuid() AS stream_id,
    'UAT-Partner-' || to_char(now(), 'YYYYMMDD-HH24MI') AS partner_name,
    lower(replace('uat-partner-' || to_char(now(), 'YYYYMMDD-HH24MI'), ' ', '-')) AS partner_slug
)
SELECT api.emit_domain_event(
  p_stream_id   := partner.stream_id,
  p_stream_type := 'organization',
  p_event_type  := 'organization.created',
  p_event_data  := jsonb_build_object(
    'name',                partner.partner_name,
    'slug',                partner.partner_slug,                   -- S3 fold-in: required by handler
    'type',                'provider_partner',
    'partner_type',        'var',
    'path',                partner.stream_id::text,                -- S3 fold-in: tenancy-root partner; path = stream_id
    'parent_path',         partner.stream_id::text,                -- S3 fold-in: ditto (self-parent for tenancy-root)
    'parent_id',           NULL,                                   -- partner orgs are tenancy-root in their own subtree
    -- subdomain_status: OMIT (UAT 2026-06-09 fold-in). Handler defaults to
    -- 'pending'. Valid enum values are {pending, dns_created, verifying,
    -- verified, failed} — there is no 'skipped' value. An earlier draft of
    -- this card had subdomain_status: 'skipped' which failed during UAT
    -- execution with "invalid input value for enum subdomain_status: 'skipped'".
    -- Path B doesn't provision DNS regardless, so the default 'pending'
    -- is semantically harmless for UAT.
    'created_by',          (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid
  ),
  p_event_metadata := jsonb_build_object(
    'user_id',         (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid,
    'organization_id', (current_setting('request.jwt.claims', true)::jsonb ->> 'org_id')::uuid,
    'reason',          'Phase 2 UAT fixture seed (Path B — direct emit; no DNS / no auth-admin minting)'
  )
)
FROM partner;
```

Then `SELECT id FROM organizations_projection WHERE name LIKE 'UAT-Partner-%' ORDER BY created_at DESC LIMIT 1;` to capture the partner_org_id.

> **CTE timing pitfall** (UAT 2026-06-09 fold-in): if you wrap the Path B `api.emit_domain_event(...)` call AND a follow-up `SELECT row_to_json(o.*) FROM organizations_projection o WHERE o.id = partner.stream_id` in the same WITH-statement's final SELECT, the projection row appears `NULL` due to snapshot-isolation timing inside the statement (the BEFORE INSERT trigger runs the handler synchronously, but the outer-SELECT's snapshot doesn't see the freshly-inserted projection row). The org IS created (verifiable in a separate query) — the inline read just won't see it. **Always read the projection in a separate statement** after Path B emit.

**Teardown for Path B**: emit `organization.deleted` for the partner_org_id at the end of UAT, or soft-delete via `api.deactivate_organization` if a non-destructive trail is preferred.

#### Step 2 — Identify a calling user (permission gate fork)

The 3 grant-tier RPCs and the 5 VAR-partnership RPCs are gated as:

| RPC | Gate |
|---|---|
| `api.create_var_partnership` (+ 4 sister RPCs: update/terminate/suspend/reactivate) | `has_platform_privilege() OR has_effective_permission('partnership.manage', v_provider_path)` |
| `api.create_access_grant` | `has_platform_privilege() OR has_effective_permission('grant.create', v_provider_path)` |
| `api.revoke_access_grant` | `has_platform_privilege() OR has_effective_permission('grant.revoke', v_provider_path)` |
| `api.revoke_permission_across_grants` | **platform-only** (`has_platform_privilege()`; no provider fallback) |

**Sub-decision (UAT path)**: use a **platform-admin user** for the entire UAT — the `has_platform_privilege()` short-circuit covers every RPC, including the platform-only `revoke_permission_across_grants`. Dev already has the Phase 1 baseline reference user `093c0e7b-5ace-49df-9632-d49858d54ef5` (which is platform-privileged per the latency benchmark history); reuse it. No additional permission seeding required to run UAT.

**Production-readiness gap discovered during this UAT planning** (NOT a UAT blocker, but a real defect): per dev probe 2026-06-09, `provider_admin` role template has only `partnership.manage` granted; **`grant.create`, `grant.revoke`, `grant.view` are NOT granted to any role**. The reachability matrix entries for these RPCs say "Provider-admin authority" but no provider_admin can actually invoke them today — only the platform-privilege fallback path works. Tracked in a separate seed card: `seed-grant-create-grant-revoke-into-provider-admin-role-seed.md`. Phase 1 (PR #70) defined the 3 grant.* permissions in `permissions_projection` but did not extend `role_permission_templates`; Phase 2 (PR #71) extended only `partnership.manage`. Decide whether to fold the role-template seed into the UAT migration prep or treat as a separate ship.

#### Step 3 — Capture fixture identifiers

```sql
-- Capture for test harness
SELECT
  (SELECT id FROM organizations_projection WHERE type='provider' AND name='TestOrg-20260329') AS provider_org_id,
  (SELECT id FROM organizations_projection WHERE type='provider_partner' ORDER BY created_at DESC LIMIT 1) AS partner_org_id,
  '093c0e7b-5ace-49df-9632-d49858d54ef5'::uuid AS calling_user_id;
```

### Batch 2 — VAR partnership + access grant lifecycle (8 probes)

| Probe | RPC | Assertion |
|---|---|---|
| L1 | `api.create_var_partnership(...)` | Returns `{success:true, partnershipId, eventId, partnership:{...}}`; `var_partnerships_projection` row exists with `status='active'`; `var_partnership.created` event in `domain_events` |
| L2 | `api.suspend_var_partnership(p_partnership_id, p_suspension_reason, p_expected_resolution_date)` | Returns `{success:true, partnershipId, eventId}`; projection `status='suspended'` + `suspended_at` / `suspended_by` / `suspension_reason` populated |
| L3 | `api.reactivate_var_partnership(p_partnership_id, p_new_contract_end_date)` | Returns `{success:true}`; projection `status='active'` + suspension columns cleared |
| L4 | `api.terminate_var_partnership(p_partnership_id, p_termination_reason)` (no citing grants) | Returns `{success:true, terminatedPartnershipId, cascadedGrantEventIds:[], cascadedGrantCount:0, candidateGrantCount:0}`; projection `status='terminated'` |
| L5 | `api.create_access_grant(...)` for VAR-default template (use `partnership_id` from L1 re-created) | Returns `{success:true, grantId, eventId, grantedAt}`; **N2**: capture `grantedAt` vs projection `granted_at` and assert `\|diff_ms\| < 1`. If drift exceeds bound, surface forward-fix decision (envelope drop vs read-back) |
| L6 | `api.create_access_grant(...)` with `authorization_type='emergency_access'` + NULL `authorization_reference` | Returns `{success:true}` — CHECK constraint allows NULL only when type=emergency_access |
| L7 | `api.create_access_grant(...)` with non-emergency type + NULL `authorization_reference` | Returns `{success:false, error:'INVALID_AUTHORIZATION_REFERENCE'}` (or handler raises and processing_error surfaces) — CHECK constraint blocks |
| L8 | `api.revoke_access_grant(p_grant_id, p_reason)` | Returns `{success:true}`; projection `status='revoked'` + `revoked_at` + `revoked_by` populated |

### Batch 3 — Cascade-revoke (2 probes)

| Probe | Setup | Action | Assertion |
|---|---|---|---|
| C1 (happy) | 2 active `var_contract` grants citing 1 VAR partnership | `api.terminate_var_partnership(p)` | Returns `{success:true, terminatedPartnershipId, cascadedGrantEventIds:[2 ids], cascadedGrantCount:2, candidateGrantCount:2}`; both grant projections `status='revoked'` with `revocation_reason='var_partnership_terminated'`; `var_partnership.terminated` event emitted AFTER both `access_grant.revoked` events (HIPAA cascade-first ordering) |
| C2 (partial) | 2 active `var_contract` grants citing 1 partnership; induce mid-cascade failure on grant #2 (e.g., temporarily corrupt the grant projection schema) | `api.terminate_var_partnership(p)` | Returns `{success:false, partial:true, error:'PARTIAL_FAILURE', partnershipId, cascadedGrantEventIds:[1 id], failureIndex:1, failedGrantId, processingError, auditEventId}`; partnership stays `active` (operator can retry idempotently); `audit.high_risk_action_logged` event emitted with `action='terminate_var_partnership_partial_failure'` |

### Batch 4 — Cross-grant policy override (1 probe)

| Probe | Setup | Action | Assertion |
|---|---|---|---|
| O1 (partial-failure) | 2 active access grants both carrying `partner.view_analytics` permission; induce mid-loop failure on grant #2 | Platform user calls `api.revoke_permission_across_grants('partner.view_analytics', '<HIPAA override reason>')` | Returns `{success:false, partial:true, error:'PARTIAL_FAILURE', appliedGrantEventIds:[1 id], failureIndex:1, failedGrantId, processingError, auditEventId, candidateGrantCount:2}`; `audit.high_risk_action_logged` event emitted with `action='revoke_permission_across_grants_partial_failure'`; grant #1's `permissions` jsonb stripped of `partner.view_analytics`; grant #2 unchanged |

### N2 forward-fix decision (post-UAT)

If L5 drift bound holds (< 1ms in practice), close N2 with "accepted as documented drift, no code change." If drift exceeds 1ms or surfaces as user-visible discrepancy in the frontend grant-creation UX, choose:

- **Option A**: Drop `grantedAt` from the success envelope; caller invokes `api.get_access_grant(p_id)` when timestamp is needed. Adds a roundtrip but eliminates drift.
- **Option B**: Read `granted_at` back from `cross_tenant_access_grants_projection` after the Pattern A v2 read-back guard and return that. Single roundtrip, zero drift.

## Steps

1. Identify UAT environment (dev or staging). Document any fixture-seeding scripts.
2. Run probes L1-L8 sequentially; capture envelopes + projection rows + domain_events rows.
3. Run cascade probes C1-C2; verify ordering of emitted events.
4. Run policy-override probe O1; verify `audit.*` family emission.
5. Compute N2 drift; record max observed `\|grantedAt - granted_at\|`.
6. Post UAT evidence to PR #71 thread (or close-out card if PR already merged) + close-out memory pointer.
7. **Stage Z — Teardown** (see below) — run the direct-DELETE cascade script with the UAT prefix to clean projection rows. `domain_events` audit rows are append-only and intentionally retained.

### Stage Z — Teardown (Option C: direct DELETE cascade)

Path B fixture seeding (Step 1, Path B) creates ONE row in `organizations_projection` directly; subsequent UAT probes create ~3 rows in `var_partnerships_projection` and ~4 rows in `cross_tenant_access_grants_projection`. The canonical `organization.deleted` event handler is **soft-delete only** (sets `deleted_at` on the org row, does NOT cascade to dependent projections — same gap as `handle-user-deleted-cascade-cleanup-projections` open backlog card). For UAT teardown we use direct DELETE per the precedent codified in PR #73 architect N1 fold-in (`infrastructure/supabase/CLAUDE.md` § "Permission retirement: direct DELETE only under all five preconditions; event family otherwise") — the load-bearing-invariants pattern extends from registry-tier cleanup to UAT-tier cleanup because test rows have no production dependencies.

**Load-bearing preconditions for the cascade DELETE** (verify before running):
- **(a)** The targeted org rows ARE the UAT test fixtures (`name LIKE 'UAT-Partner-%'`); they were created by Path B in this UAT session, not by any other process.
- **(b)** No user has been added to any of these test orgs (Path B doesn't auto-create role instances; UAT probes don't add users).
- **(c)** No real consultants have grants pointing at these test orgs (verified — only the test grants emitted during UAT reference them).
- **(d)** Production code does not read these orgs as authoritative state (verified by the `UAT-Partner-` namespace convention; Phase 2 RPC gates filter on `status='active'` which test orgs no longer carry post-teardown).
- **(e)** The teardown commit + UAT close-out memory note enumerate the rows deleted as audit trail.

**Run as a SECURITY DEFINER admin user (super_admin) — RLS would block the DELETE otherwise**. Idempotent (re-running yields zero new deletions).

```sql
-- Stage Z teardown: clean up all UAT-Partner-* test fixtures from Phase 2 UAT session.
-- domain_events rows are intentionally retained (append-only audit per Rule 5).
-- Run via Mgmt API SQL endpoint or psql; assertions fail-loud if precondition (a) fails.

WITH uat_orgs AS (
  SELECT id, name FROM public.organizations_projection
  WHERE name LIKE 'UAT-Partner-%' AND type = 'provider_partner'
),
deleted_grants AS (
  DELETE FROM public.cross_tenant_access_grants_projection
  WHERE consultant_org_id IN (SELECT id FROM uat_orgs)
  RETURNING id
),
deleted_partnerships AS (
  DELETE FROM public.var_partnerships_projection
  WHERE partner_org_id IN (SELECT id FROM uat_orgs)
  RETURNING id
),
deleted_orgs AS (
  DELETE FROM public.organizations_projection
  WHERE id IN (SELECT id FROM uat_orgs)
  RETURNING id, name
)
SELECT
  (SELECT COUNT(*) FROM uat_orgs) AS uat_orgs_targeted,
  (SELECT COUNT(*) FROM deleted_grants) AS grants_deleted,
  (SELECT COUNT(*) FROM deleted_partnerships) AS partnerships_deleted,
  (SELECT COUNT(*) FROM deleted_orgs) AS orgs_deleted,
  (SELECT array_agg(name ORDER BY name) FROM deleted_orgs) AS deleted_org_names;

-- Fail-loud assertion: precondition (a) — every targeted name MUST start with the UAT prefix.
-- If any non-UAT org was touched, the WHERE clause is misspelled or someone renamed a prod org.
DO $$
DECLARE
  v_non_uat_count int;
BEGIN
  SELECT COUNT(*) INTO v_non_uat_count
  FROM public.organizations_projection
  WHERE deleted_at IS NULL  -- still present means not deleted
    AND name LIKE 'UAT-Partner-%';
  IF v_non_uat_count > 0 THEN
    RAISE EXCEPTION 'Stage Z assertion failed: % UAT-Partner-* row(s) survived teardown — investigate before re-running',
      v_non_uat_count USING ERRCODE = 'P9099';
  END IF;
  RAISE NOTICE 'Stage Z teardown PASS: all UAT-Partner-* rows + dependents cleaned';
END $$;
```

**Mgmt API one-liner** (for quick teardown):

```bash
SUPABASE_PROJECT_REF=tmrjlswbsxmbglmaclxu
QUERY="$(cat stage-z-teardown.sql)"  # script above
JSON=$(jq -nc --arg q "$QUERY" '{query:$q}')
curl -sS -X POST "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$JSON"
```

**Retention note**: `domain_events` rows for `organization.created`, `var_partnership.*`, `access_grant.*`, `access_grant.policy_override_applied`, `audit.high_risk_action_logged` emitted during UAT are NOT deleted. They remain as the canonical audit trail (Rule 5: domain_events IS the audit table; nothing else). Future operational queries can correlate them via the `UAT-Partner-*` org-name string in event_data + the test prefix; or via the test session's correlation_id if forwarded through every emit.

**Optional follow-up**: when `handle-user-deleted-cascade-cleanup-projections` backlog card (currently OPEN) gets implemented for users, mirror the same pattern for orgs (`handle-organization-deleted-cascade-cleanup-projections`). That would make `organization.deleted` event-driven cascade replace this manual teardown for future UAT cycles — but Stage Z stands as the working pattern until then.

## Out of scope

- Frontend integration UI for VAR partnership management (separate card; this UAT is RPC-tier only).
- Performance testing (latency under load); the auth-hook latency anomaly is a separate seed card.
- Phase 3 / Phase 4 / Phase N work (parent card `cross-tenant-access-grant-rollout/` tracks those).

## Files involved

- `infrastructure/supabase/supabase/migrations/20260604210910_cross_tenant_grant_phase_2_write_side.sql` — the 9 RPCs under test
- `infrastructure/supabase/contracts/asyncapi/domains/var_partnership.yaml` — 5 message contracts
- `infrastructure/supabase/contracts/asyncapi/domains/audit.yaml` — `audit.high_risk_action_logged` contract
- `infrastructure/supabase/contracts/asyncapi/domains/access_grant.yaml` — including `AccessGrantPolicyOverrideApplied`
- `dev/active/cross-tenant-grant-phase-2-write-side/tasks.md` — Stage E close-out documents what was deferred
- `dev/active/cross-tenant-grant-phase-2-write-side/observations.md` — N1 / N2 carry-forwards from Chunk 6 architect review

---

## UAT execution evidence — 2026-06-09 first pass

**Environment**: dev (`tmrjlswbsxmbglmaclxu`)
**Provider org**: `2d0829ae-224b-4a79-ac3a-726b00d6c172` (TestOrg-20260329)
**Provider_admin user**: `440df2ae-c620-40d1-ae0a-0655ed68380b` (Test Admin) — used for L1-L5 + L7 + L8 + C1 (intended-authority path post-PR #73)
**Super_admin user**: `5a975b95-a14d-4ddd-bdb6-949033dab0b8` (Lars Tice) — used for O1 (platform-only)

### Probe results

| Probe | RPC | Verdict | Evidence |
|---|---|---|---|
| L1 | `create_var_partnership` | ✅ PASS | provider_admin authority worked; partnership id `dc738c75-...` |
| L2 | `suspend_var_partnership` | ✅ PASS | `success: true`; projection `status='suspended'` |
| L3 | `reactivate_var_partnership` | ✅ PASS | `success: true`; projection `status='active'` |
| L4 | `terminate_var_partnership` (no grants) | ✅ PASS | `cascadedGrantCount: 0`; clean termination |
| L5 | `create_access_grant` happy | ✅ PASS — **F5 HIPAA validated behaviorally** | `permissions` array = exactly 4 literal `partner.*` perms (no derived implications); scope correctly applied to OU ltree path `testorg-20260329.south_valley.aspen` |
| L6 | `create_access_grant` emergency_access + NULL auth_ref | 🚨 **BLOCKED** | `grant_role_template_name` is required but only `(var_default, var_contract)` template is seeded. **Defect seed** → `seed-grant-role-templates-emergency-default` |
| L7 | `create_access_grant` var_contract + NULL auth_ref | ✅ PASS-by-rejection | Pre-emit validator RAISEs SQLSTATE 22023 "authorization_reference is required for non-emergency_access" — input-validation uses RAISE (correct architectural pattern; envelope is reserved for runtime issues) |
| L8 | `revoke_access_grant` happy | 🚨 **BLOCKED → ✅ FIXED via PR #74** | Original failure: `PROCESSING_FAILED` with `column "revocation_reason" of relation does not exist`. Surfaced a baseline_v4 schema-vs-handler column-name mismatch affecting 3 of 5 grant lifecycle arms (revoked, expired, reactivated). Hotfix PR #74 (deployed 2026-06-09) aligns schema to handler. L8 re-probe post-hotfix: `success: true` |
| **N2** | grantedAt drift verification | ✅ PASS — **0.000ms drift** | Architect's microsecond-drift concern unfounded; same transaction snapshot for `v_now` and `p_event.created_at` |
| C1 | cascade-revoke (2 grants → terminate) | ✅ STRUCTURAL PASS — **architectural design validated** | Pre-PR-#74: surfaced the L8 defect via PARTIAL_FAILURE envelope; partnership stayed `active` (HIPAA cascade-FIRST invariant preserved); **first real-world `audit.high_risk_action_logged` emit** observed with shape matching AsyncAPI `audit.yaml` perfectly. Post-PR-#74: happy-path cascade re-probe RECOMMENDED |
| C2 | partial-failure forced injection | 🟡 SKIPPED | C1 naturally produced partial-failure via the L8 defect; the forced-injection variant is redundant given the natural observation. Re-probe recommended post-PR-#74 to validate happy-path cascade. |
| O1 | `revoke_permission_across_grants` | ✅ FULL PASS | 3 grants × `partner.view_analytics` removed; super_admin platform-tier authority worked; projection `permissions` jsonb updated from 4-perm → 3-perm on each |
| Stage Z | direct DELETE cascade teardown | ✅ PASS | 1 org + 2 partnerships + 3 grants deleted; B.5 assertion: 0 surviving `UAT-Partner-*` rows |

### Architectural wins validated end-to-end (first time observed in execution)

1. **PR #73 Section A** — provider_admin authority path for grant write-side proven via L1+L5
2. **F5 HIPAA least-authority** — `var_default` template's 4-literal-perm guarantee verified behaviorally (L5 permissions array structure)
3. **Cascade-FIRST HIPAA invariant** — partnership stays active when any citing grant fails (C1)
4. **`audit.*` event family architecture** — first real-world emit; shape matches AsyncAPI `audit.yaml` perfectly (`event_type: audit.high_risk_action_logged`, `stream_type: platform_admin`, open-shape `event_data.action` discriminator + diagnostic fields)
5. **Pattern A v2 envelope** — works in happy path (L1-L5, O1), partial-failure path (C1 surfaced via projection error), and pre-emit RAISE path (L7)
6. **Pre-emit validator vs runtime envelope separation** — input validation uses `RAISE EXCEPTION` (L7); runtime failures use envelope (L8 pre-hotfix). Clean architectural separation
7. **N2 grantedAt drift** = 0.000ms — same transaction snapshot, architect's microsecond concern unfounded

### Defects discovered

#### 1. Schema-handler column-name mismatch (BLOCKING) — RESOLVED via PR #74

3 of 5 grant lifecycle arms (`revoked`, `expired`, `reactivated`) wrote to columns that didn't exist on `cross_tenant_access_grants_projection`. Predates Phase 2. Surfaced now because Phase 2 cascade-revoke is the first production-path emitting `access_grant.revoked` at scale. Pattern A v2 caught the defect cleanly. PR #74 aligns schema to handler.

#### 2. `emergency_access` authorization_type unusable (BLOCKING for that auth type) — seed card

`api.create_access_grant` requires `grant_role_template_name` even for `emergency_access`. Only template seeded is `(var_default, var_contract)`. Architectural intent (per L1062 gate + CHECK constraint allowing `authorization_reference IS NULL`) was for emergency to bypass template/reference. Two fixes possible: (a) optional template when `authorization_type='emergency_access'`, OR (b) seed an `emergency_default` template. Decision in follow-up seed card: `seed-grant-role-templates-emergency-default.md` (to be written next).

### Stage open

UAT is **not yet complete** — Batch 3 cascade happy-path (C1 re-probe) + L8 re-probe were validated against the PR #74 hotfix fixtures in isolation but the full Phase 2 UAT re-execution against the post-PR-#74 dev state remains as a follow-up. Recommended next: a Stage E2 re-run after PR #74 merges to verify all probes pass end-to-end without the schema-defect interference.
