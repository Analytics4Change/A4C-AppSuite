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

## Stale content nominees (verify, do not auto-fix)

- `documentation/architecture/data/provider-partners-architecture.md` L376-433 — PR #68 cohesion review flagged stale "Authorization Type Patterns" code blocks. Verify fix landed in PR #68 or fold-in needed during Stage D.
