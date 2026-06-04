# Phase 2 plan — Cross-tenant grant write-side (VAR partnerships + grant lifecycle RPCs)

> **Source of truth**: `documentation/architecture/decisions/adr-cross-tenant-access-grant-jwt-shape.md` Decisions C.1-C.5 (lines 177-367) + parent card `dev/active/cross-tenant-access-grant-rollout/` § Phase 0.4 + § Phase 1 — Outcomes (SHIPPED 2026-06-03). This file tracks per-step *progress*; it does NOT duplicate the manifest content.

## Why Phase 2

Phase 1 (PR #70, merged 2026-06-03 `485955fb`) shipped the foundation: JWT shape v5, `grant_role_templates` with 4 var_default rows, `authorization_reference` column, `propagate_through_grants` HIPAA flag, 7 new permissions (grant.create/view/revoke + 4 partner.*), and the `access_grant.policy_override_applied` handler (no emitter yet). The WRITE side is stub-only — `cross_tenant_access_grants_projection` has only SELECT RLS, no INSERT/UPDATE path, no emit RPC.

Phase 2 ships that write side:
- 5 VAR partnership emit RPCs (`api.create_var_partnership`, `update_`, `terminate_`, `suspend_`, `reactivate_`) + new `var_partnerships_projection` table + new `process_var_partnership_event` router + 5-event family (NO `expired` — deferred to follow-up card per user decision 2026-06-04).
- 3 grant lifecycle emit RPCs (`api.create_access_grant`, `revoke_access_grant`, `revoke_permission_across_grants`).
- 1 read RPC (`api.get_grant_role_templates`).
- 2 private validation helpers (`_validate_authorization_var_contract`, `_validate_authorization_emergency_access`).
- AsyncAPI updates: new `var_partnership.yaml` domain + N1 carry-forward (`access_grant.policy_override_applied` registration in existing `access_grant.yaml`).

## User-locked decisions (2026-06-04)

1. **`var_partnership.expired` emitter DEFERRED to follow-up card** — Phase 2 ships NO `expired` arm in router (no handler scaffold). Status `'expired'` stays in 4-value CHECK as future-reachable state. Same follow-up card covers `access_grant.expired` emitter (Phase 1 has handler, no emitter).
2. **All 5 VAR partnership emit RPCs in Phase 2** — `create/update/terminate/suspend/reactivate`. Without suspend/reactivate the `suspended` status is unreachable.
3. **Architect-review cadence: match Phase 1** — plan + per-step at schema/RPC-body/handler/typegen touches + full-PR.

## Sub-decisions resolved at plan time (A-F)

- **A — Private helper naming**: `public._validate_authorization_<type>` underscore-prefix as NEW convention. SECURITY DEFINER. `GRANT EXECUTE TO service_role`; `REVOKE ALL FROM PUBLIC`. Codify in `infrastructure/supabase/CLAUDE.md` as Phase 2 deliverable.
- **B — `revoke_permission_across_grants` partial-failure**: mirror PR #44 `api.modify_user_roles` envelope shape (`success: false, partial: true, error: 'PARTIAL_FAILURE', appliedGrantEventIds[], failureIndex, processingError`). Handler precondition `permissions != event_data->'permissions'` makes re-runs idempotent. Emit `audit.high_risk_action.logged` in partial-failure branch.
- **C — Migration ordering**: per manifest. NO `stream_type` CHECK ALTER (verified 2026-06-04: no such constraint on `domain_events`; dispatcher CASE is the only enforcement).
- **D — No new permissions seeded**: VAR partnership RPCs gate-reuse `grant.create` (HIPAA gate at provider path). Document gate-reuse in migration header.
- **E — Handler-reference divergence**: out of scope. Reference file is canonical (post-migration state); Phase 2 adds var_partnership branch to BOTH baseline + reference. Pre-existing 8-stream-type divergence noted in `observations.md` for future cleanup card.
- **F — Inline vs delegated handlers**: INLINE in router. Matches `process_access_grant_event` precedent (closest sibling). 5 event types is manageable size.

## 17-step manifest (single transactional migration)

`infrastructure/supabase/supabase/migrations/<timestamp>_cross_tenant_grant_phase_2_write_side.sql`

| # | Step | Reference |
|---|---|---|
| 1 | `CREATE TABLE public.var_partnerships_projection` (ADR L262-286, 14 columns, 4-value status CHECK). **Architect topic**: partial UNIQUE `WHERE status NOT IN ('terminated')` vs full UNIQUE? | ADR C.3 |
| 2 | 3 RLS policies (org-admin both-sides SELECT, platform-admin SELECT, service-role SELECT). NO write policies. | ADR L308-313 |
| 3 | 3 indexes (2 partial WHERE status='active' for partner_org_id + provider_org_id; 1 contract_end_date partial for future expiry job) | Phase 1 partial-index precedent |
| 4 | `process_var_partnership_event` router — 5-arm INLINE CASE + ELSE RAISE EXCEPTION P9001 (NO `expired` arm) | access_grant precedent |
| 5 | Dispatcher CASE extension (`WHEN 'var_partnership'`) on `public.process_domain_event()` | baseline_v4:10761-10813 |
| 6 | `public._validate_authorization_var_contract(p_reference, p_consultant_org_id, p_provider_org_id) RETURNS boolean` — queries var_partnerships_projection for active matching row | ADR L205 |
| 7 | `public._validate_authorization_emergency_access(...)` — accepts NULL reference, returns TRUE | ADR L205 |
| 8 | `api.create_access_grant` emit RPC (ADR L184-213 locked body skeleton; 13 params; Pattern A v2; INTERSECT narrowing; HIPAA gate at provider path) | ADR C.1 |
| 9 | `api.revoke_access_grant(p_grant_id, p_reason, p_revocation_details)` emit RPC | ADR C.5 |
| 10 | `api.revoke_permission_across_grants(p_permission_name)` — multi-event Pattern A v2 partial-failure contract (sub-decision B) | ADR C.5 + PR #44 precedent |
| 11-15 | 5 VAR emit RPCs — `api.create_var_partnership`, `update_`, `terminate_`, `suspend_`, `reactivate_` | ADR C.3 L306 |
| 16 | `api.get_grant_role_templates(p_authorization_type)` read RPC (mirrors `api.get_role_permission_templates` at baseline_v4:3492-3509) | ADR L255 |
| 17 | COMMENT ON FUNCTION tags on all 13 new functions (M3 + reachability matrix). Emit RPCs: envelope/B/no/provider-admin only/2. Read RPC: read/E/yes. | PR #70 Step 11 precedent |

## Hard ordering constraints

- Steps 1 → 6 (helper queries the table)
- Steps 4 + 5 → 8-15 (router + dispatcher must exist before emit RPCs would push events)
- Steps 6 + 7 → 8 (`api.create_access_grant` calls them; linear-readable ordering)

## Deliverables OUTSIDE the migration

**AsyncAPI**:
- NEW `infrastructure/supabase/contracts/asyncapi/domains/var_partnership.yaml` (5 messages, NO `expired`)
- MODIFY `infrastructure/supabase/contracts/asyncapi/domains/access_grant.yaml` (+`AccessGrantPolicyOverrideApplied` — PR #70 N1)
- MODIFY `infrastructure/supabase/contracts/asyncapi/asyncapi.yaml` (var_partnership channel wiring + stream_type enum line 252)
- `npm run generate:types` → commit regen + `cp` to `frontend/src/types/generated/`

**Handler reference files**:
- NEW `infrastructure/supabase/handlers/routers/process_var_partnership_event.sql`
- MODIFY `infrastructure/supabase/handlers/trigger/process_domain_event.sql` (add var_partnership branch)

**Type regen + codegen**:
- `frontend/src/types/database.types.ts` + `workflows/src/types/database.types.ts` (byte-identical)
- `frontend/src/services/api/rpc-registry.generated.ts` (M3 regen)
- `documentation/architecture/authorization/cross-tenant-access-grant-rpc-reachability-matrix.md` (matrix regen — 9 new RPC rows: 5 VAR + 3 grant + 1 read)

**Docs**:
- `infrastructure/supabase/CLAUDE.md` (codify underscore-prefix private-helper convention)
- `documentation/architecture/data/provider-partners-architecture.md` (verify no drift from locked ADR C.3 schema; PR #68 cohesion review noted stale L376-433 — confirm fixed)

## Architect-review checkpoints (Phase 1 cadence — 9 passes)

1. Plan-mode review of this plan + sub-decisions A-F
2. Steps 1-3 — schema CHECK enums, RLS posture, partial UNIQUE topic
3. Steps 4-5 — router 5-arm inline CASE + dispatcher branch + idempotency-guard form
4. Steps 6-7 — private-helper convention codification + GRANT posture
5. Step 8 — `api.create_access_grant` body (largest RPC; HIPAA gate, INTERSECT semantics, Pattern A v2 readback)
6. Steps 9-10 — revocation flow + multi-event partial-failure contract
7. Steps 11-15 — 5 VAR emit RPCs batch (homogeneous)
8. Step 16-17 + AsyncAPI + type-gen — M3 tag audit (0-untagged regression), var_partnership.yaml schema completeness, matrix regen
9. Stage E smoke + final-PR — all probes green, full-PR cohesion check

## Stage E smoke probes (~21)

Batch 1 — Structural (10): var_partnerships_projection 14-col shape; status/partnership_type/support_level CHECK enums; UNIQUE present; 3 RLS policies + 0 write policies; 3 indexes; dispatcher CASE; router 5-arm + ELSE (using `\y` regex per codified pitfall); all 9 new api.* RPCs tagged (M3 SQL-side extraction; 0-untagged).

Batch 2 — Dynamic (11): VAR partnership create/suspend/reactivate/terminate happy paths; create_access_grant happy + emergency_access NULL reference + non-emergency NULL fails CHECK; INTERSECT narrowing; permission-snapshot equality; revoke_access_grant happy; revoke_permission_across_grants partial-failure; RLS deny-by-default + recompute_user_accessible_organizations invariant preserved.

## Risks (carry into architect reviews)

- **`UNIQUE (partner_org_id, provider_org_id)` blocks re-establishing terminated partnership** — Step 1 architect topic. Resolution paths: full per ADR, partial WHERE status NOT IN ('terminated'), or business rule.
- Pattern A v2 race: none (synchronous trigger).
- Comment-tag regression: verify 9 new tagged RPCs don't break 0-untagged CI gate.
- JWT staleness window during partial-failure policy override: `audit.high_risk_action.logged` mitigation.
- `has_cross_tenant_access` still a stub (verified 2026-06-04). Phase 4 territory; Phase 2 independent.

## Verification (end-to-end)

1. **Stage B pre-flight** (mirror Phase 1): row-count probe for cross_tenant_access_grants_projection (= 0); confirm var_partnerships_projection does NOT exist; baseline auth-hook latency; baseline frontend+workflows typecheck on HEAD.
2. **Stage C drafting**: produce migration step-by-step under architect cadence. All 4 codified pitfalls apply (`\y` regex; psql `-R`; EXISTS form for `ANY((SELECT))`; `IF NOT EXISTS` not `EXCEPTION WHEN unique_violation`).
3. **Stage E deploy + smoke**: `supabase db push --linked` to dev; 21 probes; auth-hook latency re-measure within 2× baseline.
4. **Stage F PR + ship**: open PR; CI gates green; architect full-PR review; merge no-squash per PR #68/#70 precedent.
5. **Post-merge**: 3 deploy gates green; prod state verified via Mgmt API.
6. **Card archive + memory close-out**: `dev/active/` → `dev/archived/`; `pr-NN-close-out.md`; MEMORY.md one-line update.

## Estimated migration size

~42-46 top-level statements (vs Phase 1's 66).

## Plan-mode architect review

> Pending — to be invoked before any migration SQL is drafted (mirrors Phase 1 Stage A gate).
