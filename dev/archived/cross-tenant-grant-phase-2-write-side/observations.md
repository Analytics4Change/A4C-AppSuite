# Observations — cross-tenant-grant Phase 2 write-side

> Side observations, deferred concerns, and notes that don't fit plan.md or tasks.md.

## Pre-existing divergences out of Phase 2 scope (per sub-decision E)

**Handler reference file divergence** (Plan Phase 1 Agent 3 finding 2026-06-04): `infrastructure/supabase/handlers/trigger/process_domain_event.sql` has 8 additional stream_types compared to baseline_v4 (`schedule`, `client_field_definition`, `client_field_category`, `client`) + a refined junction-event exclusion (`NOT IN ('contact.user.linked', 'contact.user.unlinked')`).

This is pre-existing drift — the reference file reflects post-migration state (subsequent migrations added these stream types) while baseline_v4 is frozen at 2026-02-12. The reference file is canonical for "current cluster state"; baseline is canonical for "history".

**Resolution for Phase 2**: out of scope. Phase 2 adds `var_partnership` to BOTH baseline diff (via Step 5 dispatcher CASE extension) AND the reference file. Pre-existing divergence not audited or fixed.

**Carry forward**: a future cleanup card could either (a) baseline-rebase the reference file post-Phase-2 or (b) emit an idempotent migration that re-creates `process_domain_event` matching the reference file exactly. Not blocking any phase of cross-tenant-grant rollout.

**Phase 2 impact** (per N3 architect note): Phase 2 wiring REDUCES the 8-stream-type reference-file divergence by one (var_partnership goes into both baseline-diff via Step 5 dispatcher CASE extension AND the reference file via Stage D handler-reference sync). Net divergence post-Phase-2: 7 stream_types unaccounted-for in baseline.

## Architect plan-mode review carry-forwards (2026-06-04)

**Denormalized-name sync deferred to Phase N** (per S4 architect recommendation): ADR L296 specifies that `var_partnership.*` handlers should sync denormalized name columns on `org.updated` cross-events. Phase 2 ships the columns (`partner_org_name`, `provider_org_name`) but NOT the cross-handler hook. Risk: an org-rename leaves `var_partnerships_projection` with stale names. Mitigation: low-impact (denormalization is for display only; grant authorization uses IDs); Phase N can add a cross-handler hook OR scheduled reconciler.

**Pre-existing ADR drift (sub-decision K)**: Phase 1 deployed `grant_role_templates` with 3-column UNIQUE `(template_name, authorization_type, permission_name)` per Phase 1 architect N2 fold-in, but ADR L232 still shows 2-column UNIQUE. Stage D should fold an ADR correction note below C.2.

**Phase 4 cross-tenant access stub**: `public.has_cross_tenant_access(p_consultant_org_id, p_provider_org_id, p_user_id, p_scope)` still returns FALSE on prod (verified 2026-06-04). Phase 4 implements the body; Phase 2 confirms independence — `api.create_access_grant` HIPAA gate is at provider org path via `has_effective_permission('grant.create', v_provider_path)`, not via `has_cross_tenant_access`.

## Phase N validator helper Phase-N gotcha (Chunk 3 architect 2026-06-04)

The Phase 2 `_validate_authorization_var_contract` body uses the mapping `partner_org_id = p_consultant_org_id` because in a VAR partnership the "partner_org" IS the consultant party (the `provider_partner` org_type that consults at `provider` orgs). This 1:1 mapping is VAR-specific.

Phase N forward-compat gotcha: court/agency/family backing projections will likely NOT have a `partner_org_id` column. Examples:
- `court_authorizations_projection` — may have `authorized_party_org_id` or no consultant-org-identity at all (courts authorize specific individuals)
- `agency_assignments_projection` — may have `agency_org_id` (CPS / social services)
- `family_consents_projection` — may have no org column (consent is per-individual)

The Phase N helpers will need to translate `p_consultant_org_id` to whatever the type-specific projection's column is named. This is exactly the abstraction the underscore-prefix helper convention is designed to encapsulate — but the Phase N card author must NOT blindly grep-replace `partner_org_id` → `court_org_id`.

Action for Phase N cards: each card MUST audit its type-specific projection schema and produce its own validation helper body that maps the canonical `(p_reference, p_consultant_org_id, p_provider_org_id)` signature to that projection's columns explicitly.

## New codifiable pitfall from Chunk 2 (2026-06-04)

**Verify deployed body before `CREATE OR REPLACE FUNCTION` of any pre-existing function**. Discovered during Chunk 2 Step 5 drafting: my initial draft of `process_domain_event` (CREATE OR REPLACE to add the `var_partnership` branch) silently dropped four load-bearing semantics from the deployed body:

1. The `IF NEW.processed_at IS NOT NULL THEN RETURN NEW; END IF;` idempotency guard
2. The PII three-layer model (`GET STACKED DIAGNOSTICS MESSAGE_TEXT, PG_EXCEPTION_DETAIL` → `processing_error` + `processing_error_detail`) per PR #43
3. The `RAISE WARNING` for operator debug visibility
4. The ERRCODE `P9002` for unknown stream_type (I had used `P9001`)
5. `clock_timestamp()` for `processed_at` (I had used `now()`)

Each item would have appeared "fine" in plpgsql_check + would have deployed cleanly to dev — but Phase 1 + PR #43 invariants would silently regress on prod.

**Resolution pattern**: query Mgmt API SQL endpoint with
```sql
SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = '<schema>' AND p.proname = '<func>';
```
BEFORE writing a CREATE OR REPLACE. Copy the deployed body verbatim, then add the minimal targeted change.

This is the kind of pitfall that should fold into `infrastructure/supabase/CLAUDE.md` post-Phase-2 ship — but it's premature now (one discovery; need 2-3 instances to confirm it's a real recurring pattern, not just my first-pass error).

## Chunking strategy + architect-review cadence (Stage C)

Chunks chosen by complexity + dependency boundaries:

| Chunk | Steps | Why grouped |
|---|---|---|
| 1 | 1-3 | Schema cluster — all CREATE TABLE / RLS / index together |
| 2 | 4.0 + 4 + 5 | Event-processing cluster — helper + router + dispatcher must land together |
| 3 | 6 + 7 + 7b | Gates cluster — 2 validation helpers + new permission seed |
| 4 | 8 | Largest single RPC; alone for focus |
| 5 | 9 + 10 | Revoke flow — single-event + multi-event partial-failure |
| 6 | 11-15 | 5 VAR lifecycle RPCs (homogeneous batch); includes Step 13 cascade-revoke |
| 7 | 16 + 17 | Read RPC + COMMENT tags (light wrap-up) |

Architect review fires after each chunk per Phase 1 sub-decision 3. Default verdict for non-blocking findings = "APPROVE WITH IN-PR FIXES" with same-day fold-in (memory `feedback-no-deferral-to-cards.md`).

## Phase 1 codified pitfalls — all apply to Phase 2

Per `infrastructure/supabase/CLAUDE.md` (post-PR-#70 state):
1. **PG ARE `\b` silently fails on hosted Supabase PG → use `\y`**. Step 17 + smoke probe 9 use `\y` for tag-extraction assertions.
2. **`pg_description.description` multi-line bodies → use psql `-R '<<<A4C_ROW>>>'` row-separator**. Reachability matrix regen at Stage E uses this codegen.
3. **`ANY((SELECT array_col FROM CTE))` is scalar subquery → use EXISTS form with column reference**. Watch for this in `api.create_access_grant` body (the INTERSECT computation + grant_role_templates lookup may tempt this pattern).
4. **`EXCEPTION WHEN unique_violation` is dead code under `process_domain_event` → use `IF NOT EXISTS ... THEN INSERT` precondition guard**. Applies to ALL 5 inline handlers in Step 4 router.

## Plan agent risk callouts (Stage C drafting watchlist)

- **`UNIQUE (partner_org_id, provider_org_id)` blocks re-establishing terminated partnership** — Step 1 architect-review topic. Three resolution paths to consider:
  - (a) Full UNIQUE per ADR (DBA intervention for re-establishment)
  - (b) Partial UNIQUE `WHERE status NOT IN ('terminated')`
  - (c) Business rule: re-establishment requires new partner_org_id (rare)
  Default to ADR (option a) unless architect prefers otherwise.

- **`api.create_access_grant` INTERSECT semantics**: confirm template ∩ override semantics produces NARROWING only (never widening). Smoke probe 17 + 18 explicitly verify this.

- **JWT staleness window during `revoke_permission_across_grants` partial failure**: ops alert via `audit.high_risk_action.logged` event emit. Smoke probe 20 verifies envelope shape; architect review of Step 10 confirms the audit-event emit happens BEFORE the partial-failure envelope returns.

- **Comment-tag regression on Phase 1 RPCs**: Phase 2 adds 9 new tagged RPCs (5 VAR + 3 grant + 1 read). Verify M3 + matrix CI gates don't regress (0-untagged); smoke probe 10 confirms.

## Unverified ADR claims (verify during Stage C)

- ADR L255: `api.get_grant_role_templates(p_authorization_type text) RETURNS TABLE("template_name" text, "permission_name" text, "default_terms" jsonb)` — confirm this signature matches `api.get_role_permission_templates` shape on dev before drafting.
- ADR L317-330: var_partnership AsyncAPI sketch shows 6 messages including `VarPartnershipExpired` — Phase 2 ships 5 (no `expired` per user decision 1). Verify ADR is the SOURCE OF TRUTH for the 5 we ship + that the sixth deferred message gets a docblock noting deferral.

## Chunk 6 carry-forward (2026-06-08) — Step 12 PATCH NULL-clear gap

S1 architect fold-in from Chunk 6 review documented in-code. Action: `api.update_var_partnership` cannot clear nullable fields back to NULL via the current PATCH builder pattern (`IF p_X IS NOT NULL THEN v_event_data := v_event_data || jsonb_build_object('X', p_X)` — no null pass-through). Affected nullable mutable fields: `contract_number`, `contract_end_date`, `revenue_share_percentage`, `support_level`. Use case: converting a fixed-term contract to open-ended by clearing `contract_end_date`.

**Resolution path** (future follow-up card, NOT Phase 2 scope):
1. Add `p_clear_fields text[] DEFAULT '{}'` parameter to `api.update_var_partnership`.
2. For each member of `p_clear_fields`, set `v_event_data := v_event_data || jsonb_build_object(<field>, NULL)`.
3. Update handler at `process_var_partnership_event.sql § var_partnership.updated arm` to use key-presence semantics: `CASE WHEN p_event.event_data ? 'X' THEN safe_jsonb_extract_*(...) ELSE current_value END` instead of `COALESCE(safe_jsonb_extract_*(...), current_value)`.
4. Validate that `p_clear_fields` only contains nullable column names (whitelist).

**Phase 2 impact**: workaround = terminate + recreate (wrong audit trail for the use case). Documented as a deliberate limitation in the migration RPC docblock.

## Chunk 5 architect review (2026-06-08) — new event family + precedent

**F1 fold-in lock**: Step 10 emits a NEW event family `audit.high_risk_action_logged` on `stream_type='platform_admin'`. This is the FIRST emitter of any `audit.*` event family AND the first emitter on `platform_admin` (the dispatcher type was defined in baseline but never had an emitter). The 2-level naming form (`audit.high_risk_action_logged`) was chosen over 3-level (`audit.high_risk_action.logged`) to match `organization.direct_care_settings_updated` precedent and stay within the documented CLAUDE.md § "Event type naming convention" 2-level rule. This becomes the precedent for ALL future cross-grant / cross-tenant high-risk audit events.

**Stage D carry-forward (MUST land before PR merge per Chunk 5 architect F1 dependency)**:

- **AsyncAPI registration** for the new event family. Two options:
  - (a) Extend existing admin schema with audit subtree, OR
  - (b) NEW `infrastructure/supabase/contracts/asyncapi/domains/audit.yaml` with `AuditHighRiskActionLogged` message. Payload keys per emit body: `action, permission_name, override_reason, failed_grant_id, applied_event_ids[], failure_index, processing_error`.
- **Wire `audit` family into top-level `asyncapi.yaml`** (channel + stream_type enum already covered by `platform_admin`, but message naming needs registration to avoid AnonymousSchema generation).
- **Update `infrastructure/supabase/CLAUDE.md` § "Event type naming convention"** to add an addendum noting that 3-level form is reserved for the documented `contact.user.*` junction-event carve-out; `audit.*` family uses the 2-level form per this precedent.

**Multi-caller race callout (architect Chunk 5 § 16)**: concurrent platform-admin invocations of `api.revoke_permission_across_grants` on OVERLAPPING permission names use **last-emit-wins** semantics at the projection (handler REPLACES `permissions` jsonb, not merges). Operational pattern: serial invocation. Document in Step 10 header in a future polish (not folded in Chunk 5; small risk surface — platform-only caller pool). Carry to Step 17 COMMENT ON FUNCTION text.

## Cosmetic carry-forwards from Chunk 4 architect review (2026-06-08)

Two nits left undeferred for this PR; not folded inline because they're presentation-only and the diff cost outweighs the readability benefit at Phase 2 scale:

- **N1 (Chunk 4)**: `api.create_access_grant` success envelope returns `grantedAt: v_now` (RPC-side timestamp) but the handler stamps `granted_at := p_event.created_at` (the `domain_events.created_at` from the trigger). They are typically equal but can drift by microseconds. Forward-fix: either drop `grantedAt` from the envelope (caller fetches via `get_access_grant` read RPC when needed) or read it back from the projection inside Pattern A v2. **Stage E probe** should verify the drift is bounded (< 1ms in practice). Carry to Phase-2 PR cohesion review if Stage E surfaces user-visible discrepancy.

- **N2 (Chunk 4)**: envelope shape across all SCOPE_NOT_FOUND / CLIENT_DISCHARGED / TEMPLATE_NOT_FOUND / EMPTY_PERMISSION_SET / NOT_IMPLEMENTED / AUTHORIZATION_VALIDATION_FAILED / PROCESSING_FAILED branches duplicates `error` and `errorDetails.code`. The PR #44 `api.modify_user_roles` envelope dropped `code` from `errorDetails` once it matched `error`. Phase 2 RPCs keep the duplication intentionally for forward-compat with extended `errorDetails` payloads (e.g., field-level validation surfacing). Document at the M3 tag wave (Step 17) if the duplication stays.

## Stale content nominees (verify, do not auto-fix)

- `documentation/architecture/data/provider-partners-architecture.md` L376-433 — PR #68 cohesion review flagged stale "Authorization Type Patterns" code blocks. Verify fix landed in PR #68 or fold-in needed during Stage D.
