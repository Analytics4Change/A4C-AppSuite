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

1. Seed a test `provider_partner` org via the standard partner-org bootstrap (or direct SQL fixture if bootstrap is too heavy for UAT — document either way).
2. Seed a provider-admin user holding `partnership.manage` at the provider org path AND `grant.create` / `grant.revoke`.
3. Capture both orgs + the provider-admin user UUIDs for the test harness.

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
