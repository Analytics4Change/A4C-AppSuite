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

**Path B (pragmatic)** — Bypass the workflow and emit `organization.created` directly via `api.emit_domain_event` (event-sourced shortcut; the projection handler does the rest). Faster than Path A for write-side RPC UAT because we don't need DNS or auth-admin minting:

```sql
SELECT api.emit_domain_event(
  p_stream_id   := gen_random_uuid(),
  p_stream_type := 'organization',
  p_event_type  := 'organization.created',
  p_event_data  := jsonb_build_object(
    'name',                'UAT-Partner-' || to_char(now(), 'YYYYMMDD-HH24MI'),
    'type',                'provider_partner',
    'partner_type',        'var',
    'parent_id',           NULL,  -- partner orgs are tenancy-root in their own subtree
    'created_by',          (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid
  ),
  p_event_metadata := jsonb_build_object(
    'user_id',         (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid,
    'organization_id', (current_setting('request.jwt.claims', true)::jsonb ->> 'org_id')::uuid,
    'reason',          'Phase 2 UAT fixture seed'
  )
);
```

Then `SELECT id FROM organizations_projection WHERE name LIKE 'UAT-Partner-%' ORDER BY created_at DESC LIMIT 1;` to capture the partner_org_id.

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
