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

## Architect plan-mode review fold-in (2026-06-04)

Plan-mode architect review (`software-architect-dbc`) returned **APPROVE WITH IN-PR FIXES** (5 must-fix F1-F5 + 6 should-fix S1-S6 + 3 nits N1-N3 + 5 new sub-decisions G-K to lock). All findings folded same-day; user-facing decisions G/H/J answered via AskUserQuestion same-day.

**Locked sub-decisions G-K** (architect recommendations all accepted):

- **G — `var_partnerships_projection` UNIQUE shape**: **partial** `UNIQUE (partner_org_id, provider_org_id) WHERE status IN ('active', 'suspended')`. Mirrors `idx_grant_role_templates_active` partial-index precedent. Allows re-establishment of terminated/expired partnership via new row; audit trail preserved. **ADR addendum required**: ADR L285 specifies full UNIQUE — Stage D adds an addendum below C.3 documenting the Phase-2-locked partial form.
- **H — Termination cascade**: Step 13 `api.terminate_var_partnership` becomes **multi-event RPC**. Looks up grants WHERE `authorization_type='var_contract' AND authorization_reference = vp.id AND status='active'`; emits `access_grant.revoked` for each (`revocation_reason='var_partnership_terminated'`); plus the `var_partnership.terminated` event. Pattern A v2 partial-failure envelope (per S5 pattern-i: per-event check inside loop with short-circuit). Keeps `accessible_organizations` clean; no two-tier inconsistency window.
- **I — Idempotency mechanism for `policy_override_applied`**: **RPC-side filter** (NOT handler precondition extension). Step 10 body computes `affected_grants` via `WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(permissions) p WHERE p->>'p' = p_permission_name) AND status='active'` — emit events only when state will change. Cleaner: no Phase 1 handler change, no duplicate no-op events.
- **J — Permission seeding**: **NEW permission `partnership.manage`** (org-scoped, no MFA) seeded via `permission.defined` event in Phase 2 migration. Gates Steps 11-15 on `has_platform_privilege() OR has_effective_permission('partnership.manage', <provider_org_path>)`. Default-bundle into provider-admin role template. Forward-compatible: allows future delegation to non-clinical contracts officers.
- **K — Step 8 template lookup**: filter by triple `(template_name, authorization_type, is_active)` per F1 (Phase 1 deployed 3-column UNIQUE, not ADR's 2-column).

**Must-fix findings F1-F5** (all folded inline in manifest below):

- **F1**: Phase 1 deployed `grant_role_templates` with `UNIQUE (template_name, authorization_type, permission_name)` — 3-column, not ADR L232's 2-column. Step 8 template lookup MUST filter on `authorization_type` (sub-decision K). Step 16 read RPC MUST return `template_name` as a column for caller disambiguation.
- **F2**: `api.create_access_grant` HIPAA gate path derivation needs explicit lookup. Pattern: `SELECT path INTO v_provider_path FROM organizations_projection WHERE id = p_provider_org_id AND deleted_at IS NULL; RAISE EXCEPTION if not found; gate on has_platform_privilege() OR has_effective_permission('grant.create', v_provider_path)`. Org-move invariant: provider org path is resolved live by `compute_effective_permissions`; hybrid-snapshot grant permissions don't change; this is correct.
- **F3**: Phase 1 handler `process_access_grant_event.sql:108-116` UPDATES unconditionally — Step 10 RPC must use RPC-side filter (sub-decision I) to avoid emitting no-op events.
- **F4**: Resolved via sub-decision H (cascade-revoke in Step 13).
- **F5**: Add new smoke probe to Batch 2 verifying INTERSECT excludes implication-chains for `var_default` template — assert `permissions` jsonb is exactly the 4 literal `partner.*` permissions, NO derived implications appear.

**Should-fix findings S1-S6**:

- **S1**: Stage B pre-flight grep for existing `public._*` functions; if zero matches, codify underscore-prefix convention with mandatory `REVOKE ALL FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE TO service_role` ritual.
- **S2**: Resolved via sub-decision J (seed `partnership.manage`).
- **S3**: Resolved via sub-decision G (partial UNIQUE).
- **S4**: Add § "Event payload schemas (handler input contract)" enumerating event_data keys for all 5 `var_partnership.*` events; lock denormalized-name sync semantic from ADR L296.
- **S5**: Step 10 + Step 13 multi-event RPCs use pattern (i): per-event `processing_error` check inside loop with short-circuit on first failure. Envelope per F3 lock includes `failedGrantId` field.
- **S6**: One-line note added: Step 8 keeps 13-param ADR signature; jsonb-bundle alternative considered + rejected per typing ergonomics.

**Nits N1-N3**:

- **N1**: Re-estimated migration size from ~42-46 to **60-70 top-level statements** (Phase 1 was 66; Phase 2 has 17 steps with comparable surface area; J adds ~5 statements; cascade-revoke in Step 13 grows it ~10).
- **N2**: Card seed commit `docs(card):` scoping is correct.
- **N3**: observations.md updated to note Phase 2 wiring reduces the 8-stream-type reference-file divergence by one.

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
| 1 | `CREATE TABLE public.var_partnerships_projection` (ADR L262-286, 14 columns, 4-value status CHECK). **UNIQUE shape per sub-decision G**: partial `UNIQUE (partner_org_id, provider_org_id) WHERE status IN ('active', 'suspended')` — NOT full UNIQUE. ADR addendum in Stage D. | ADR C.3 + sub-decision G |
| 2 | 3 RLS policies (org-admin both-sides SELECT, platform-admin SELECT, service-role SELECT). NO write policies. | ADR L308-313 |
| 3 | 3 indexes (2 partial WHERE status='active' for partner_org_id + provider_org_id; 1 contract_end_date partial for future expiry job) | Phase 1 partial-index precedent |
| 4 | `process_var_partnership_event` router — 5-arm INLINE CASE + ELSE RAISE EXCEPTION P9001 (NO `expired` arm) | access_grant precedent |
| 5 | Dispatcher CASE extension (`WHEN 'var_partnership'`) on `public.process_domain_event()` | baseline_v4:10761-10813 |
| 6 | `public._validate_authorization_var_contract(p_reference, p_consultant_org_id, p_provider_org_id) RETURNS boolean` — queries var_partnerships_projection for active matching row | ADR L205 |
| 7 | `public._validate_authorization_emergency_access(...)` — accepts NULL reference, returns TRUE | ADR L205 |
| 7b | **NEW (sub-decision J)** — Emit `permission.defined` event seeding `partnership.manage` permission (org-scoped, requires_mfa=false). Default-bundle into provider-admin role template. | sub-decision J + S2 |
| 8 | `api.create_access_grant` emit RPC (ADR L184-213; 13 params per S6). **F2 fold-in**: provider path lookup via `SELECT path FROM organizations_projection WHERE id = p_provider_org_id AND deleted_at IS NULL` with not-found RAISE. **K fold-in**: template lookup filter triple `(template_name, authorization_type, is_active)` — NOT 2-column. INTERSECT narrowing on literal permissions only (implications correctly excluded — see F5 smoke probe). Pattern A v2 envelope; jsonb-bundle alternative rejected per S6. | ADR C.1 + F1+F2+K+S6 |
| 9 | `api.revoke_access_grant(p_grant_id, p_reason, p_revocation_details)` emit RPC | ADR C.5 |
| 10 | `api.revoke_permission_across_grants(p_permission_name)` — multi-event Pattern A v2 partial-failure (sub-decision B). **I fold-in**: RPC-side filter — `WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(permissions) p WHERE p->>'p' = p_permission_name) AND status='active'`. Only emit events when state will change. **S5 fold-in**: pattern (i) per-event `processing_error` check inside loop with short-circuit on first failure. | ADR C.5 + PR #44 + I+S5 |
| 11 | `api.create_var_partnership` emit RPC — gate on `partnership.manage` per sub-decision J. | ADR C.3 + J |
| 12 | `api.update_var_partnership` emit RPC — gate on `partnership.manage`. | ADR C.3 + J |
| 13 | `api.terminate_var_partnership` — **multi-event RPC per sub-decision H**: emits `var_partnership.terminated` + cascade-revoke `access_grant.revoked` (with `revocation_reason='var_partnership_terminated'`) for each `authorization_type='var_contract' AND authorization_reference = vp.id AND status='active'` grant. Pattern A v2 partial-failure shape per F3 locked envelope. Gate on `partnership.manage`. | ADR C.3 + H+S5 |
| 14 | `api.suspend_var_partnership` emit RPC — gate on `partnership.manage`. | ADR C.3 + J |
| 15 | `api.reactivate_var_partnership` emit RPC — gate on `partnership.manage`. | ADR C.3 + J |
| 16 | `api.get_grant_role_templates(p_authorization_type)` read RPC. **F1 fold-in**: `RETURNS TABLE("template_name" text, "permission_name" text, "default_terms" jsonb)` — `template_name` returned for caller disambiguation under 3-column UNIQUE. | ADR L255 + F1 |
| 17 | COMMENT ON FUNCTION tags on the 9 new api.* RPCs (8 emit + 1 read). Private helpers (`_validate_authorization_*`), router (`process_var_partnership_event`), and `safe_jsonb_extract_numeric` are in `public` schema — M3/matrix registries N/A by codegen SQL filter. Emit RPCs: envelope/B (Steps 8+9+11-15) or E (Step 10 platform-only)/no/per-RPC reason text/phase-target=`none` (canonical at deploy — matches Phase 1 B-bucket convention). Read RPC (Step 16): read/E/yes/phase-target=`none`. | PR #70 Step 11 precedent + Chunk 7 architect F1+F2 fold-ins (2026-06-08) |

## Hard ordering constraints

- Steps 1 → 6 (helper queries the table)
- Steps 4 + 5 → 8-15 (router + dispatcher must exist before emit RPCs would push events)
- Steps 6 + 7 → 8 (`api.create_access_grant` calls them; linear-readable ordering)
- **Step 7b → 11-15** (`partnership.manage` permission must exist before VAR RPCs gate-check on it; sub-decision J)
- **Step 1 → Step 13** (cascade-revoke queries `var_partnerships_projection`)

## Event payload schemas (handler input contract) — per S4

Each `var_partnership.*` event's `event_data` MUST carry the following keys (handler reads them in Step 4 inline CASE arms):

**`var_partnership.created`** (10 keys; remaining columns = handler defaults):
- `partner_org_id` uuid, `partner_org_name` text, `provider_org_id` uuid, `provider_org_name` text
- `partnership_type` text ('standard'|'white_label'), `contract_number` text (nullable)
- `contract_start_date` date, `contract_end_date` date (nullable)
- `revenue_share_percentage` numeric(5,2) (nullable), `support_level` text (nullable; 'tier1'|'tier1_tier2'|'full')
- `terms` jsonb (defaults to `'{}'`)

**`var_partnership.updated`** (variable; immutable identity fields excluded):
- IMMUTABLE (excluded from event_data): `id`, `partner_org_id`, `provider_org_id`, `contract_start_date`
- MUTABLE: `partner_org_name`, `provider_org_name`, `partnership_type`, `contract_number`, `contract_end_date`, `revenue_share_percentage`, `support_level`, `terms` (any subset; handler PATCH semantics — only non-null keys overwrite)

**`var_partnership.terminated`** (2 keys + audit):
- `terminated_by` uuid (defaults from `event_metadata.user_id` if absent), `termination_reason` text

**`var_partnership.suspended`** (3 keys + audit):
- `suspended_by` uuid, `suspension_reason` text, `expected_resolution_date` date (nullable)

**`var_partnership.reactivated`** (2 keys + audit):
- `reactivated_by` uuid, `new_contract_end_date` date (nullable; extends contract if present)

**Denormalized-name sync** (ADR L296): out of Phase 2 scope per S4 architect recommendation. Cross-handler hook for `org.updated` → `var_partnerships_projection.{partner,provider}_org_name` sync deferred. Add to observations.md as Phase N carry-forward.

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

Batch 2 — Dynamic (12 — added 1 per F5): VAR partnership create/suspend/reactivate/terminate happy paths; create_access_grant happy + emergency_access NULL reference + non-emergency NULL fails CHECK; INTERSECT narrowing; permission-snapshot equality; revoke_access_grant happy; revoke_permission_across_grants partial-failure; RLS deny-by-default + recompute_user_accessible_organizations invariant preserved; **F5 NEW** — verify Step 8 INTERSECT excludes implication-chains for `var_default` template: assert created grant `permissions` jsonb is exactly the 4 literal `partner.*` permissions, NO derived implications appear (HIPAA least-authority guarantee).

Batch 3 — Cascade (NEW per sub-decision H): seed 2 active `var_contract` grants citing a single VAR partnership; call `api.terminate_var_partnership`; assert both grants' `status='revoked'` with `revocation_reason='var_partnership_terminated'`; envelope returns `{success: true, terminatedPartnershipId, cascadedGrantEventIds: [2 ids], cascadedGrantCount: 2}`. Partial-failure cascade test: induce mid-cascade failure on grant #2; envelope returns `{success: false, partial: true, error: 'PARTIAL_FAILURE', terminatedPartnershipId, cascadedGrantEventIds: [1 id], failureIndex: 1, failedGrantId, processingError}`.

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

**~60-70 top-level statements** (re-estimated post-architect review per N1; vs Phase 1's 66). Breakdown: 1 CREATE TABLE + 3 RLS + 3 INDEX + 1 CREATE OR REPLACE router + 1 CREATE OR REPLACE dispatcher + 2 validation helpers + GRANT/REVOKE pairs + `partnership.manage` permission seed (1 event emit DO block) + 10 emit/read RPCs (9 + cascade-extended terminate) + 14 COMMENT ON FUNCTION + ~8 Stage E assertion blocks + DROP IF EXISTS pairs for re-appliability = ~65 statements typical.

## Plan-mode architect review

> **COMPLETED 2026-06-04**. Verdict APPROVE WITH IN-PR FIXES. 5 must-fix F1-F5 + 6 should-fix S1-S6 + 3 nits N1-N3 + 5 sub-decisions G-K to lock. All folded same-day. User-facing sub-decisions G/H/J answered via AskUserQuestion same-day per architect recommendations.
