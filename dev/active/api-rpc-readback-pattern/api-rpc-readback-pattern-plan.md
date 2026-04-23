# API RPC Read-back Pattern — Plan

## Executive Summary

Refactor all `api.update_*` RPCs to perform projection read-back and surface handler errors as `RAISE EXCEPTION`. Eliminates silent handler failures and removes the need for every ViewModel to re-implement the post-save recheck pattern.

**Trigger**: Discovered during `client-ou-edit` architect review (finding M3). `api.update_client` is being fixed in that feature's PR 1 as a proof-of-pattern; this feature generalizes the pattern to all other RPCs.

## Scope

- **In scope**: All `api.update_*` / `api.change_*` RPCs except `api.update_client` and `api.change_client_placement` (handled in `client-ou-edit`). Inventory confirmed during Phase 0.
- **Out of scope**: Creation RPCs (already return row), deletion RPCs (separate read-back concern), RPCs in workflow service layer

## Phase Summary

| Phase | Description | Effort | Branch / PR |
|-------|------------|--------|-------------|
| 0 | Inventory all `api.update_*` and `api.change_*` RPCs; classify | Small | `chore/activate-api-rpc-readback-pattern` (PR #29 — this branch) |
| 1 | Migration: add read-back + processing_error check to each in-scope RPC; migration header enumerates the pattern | Medium | `feat/api-rpc-readback-pattern` (PR 1 of implementation) |
| 2 | Update frontend service types to include `row` in response | Small | `feat/api-rpc-readback-pattern` (PR 1 of implementation) |
| 3 | ADR + documentation (sub-phases 3a–3f per `api-rpc-readback-pattern-tasks.md`) | Small | `feat/api-rpc-readback-pattern` (PR 1 of implementation) |
| 4 | Update ViewModels to consume returned row (remove redundant `getX()` calls) | Medium | Optional follow-up PR (post-PR-1 of implementation) |

**This branch (PR #29)**: Phase 0 only — activation + inventory tracking table.
**Implementation PR 1** (`feat/api-rpc-readback-pattern`): Phases 1–3.
**Implementation PR 2 (optional)**: Phase 4 — ViewModel simplification.

## Phase 0: RPC Inventory

Query to generate the list:
```sql
SELECT n.nspname AS schema, p.proname AS name, pg_get_function_arguments(p.oid) AS args,
       pg_get_function_result(p.oid) AS returns
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'api'
  AND (p.proname LIKE 'update_%' OR p.proname LIKE 'change_%')
ORDER BY p.proname;
```

### Inventory Tracking Table — populated 2026-04-23 (revised after PR #29 review)

22 distinct `api.update_*` / `api.change_*` RPCs identified via grep across `infrastructure/supabase/supabase/migrations/` using two patterns: the unquoted `api\.(update|change)_` (covers post-baseline migrations) and the quoted-identifier `"api"\."(update|change)_` (covers `20260212010625_baseline_v4.sql`). The first pattern alone missed 3 baseline-only RPCs surfaced by PR #29 review (M1) — `api.update_role`, `api.update_user`, `api.update_user_access_dates` — now included below. DB inspection still deferred to Phase 1 implementation branch (MCP supabase token expired during initial inventory); classifications are based on migration grep + spot-check; refine in Phase 1 by reading each function's live `pg_get_functiondef`.

Classification key:
- **EXCLUDED** — handled elsewhere or no projection row to read back; do not touch
- **DONE** — already has post-emit projection read-back guard (NOT FOUND check after event emission)
- **NEEDS-INSPECTION** — function exists; current state unknown; verify on Phase 1 implementation branch
- **NEEDS-PATTERN** — confirmed missing read-back; apply standard `%ROWTYPE` pattern
- **COMPLEX-CASE** — read-back required but the response composes joined data (role+permissions, contact+phone, etc.); standard `%ROWTYPE` pattern won't compose — needs explicit `jsonb_build_object` aggregation. Route through Phase 1b.

| RPC | Latest migration | Classification | Notes |
|-----|------------------|----------------|-------|
| `api.update_client` | `20260422052825_client_ou_placement_and_edit_support.sql` | **EXCLUDED** | Proof-of-pattern shipped in client-ou-edit PR 1; do NOT modify |
| `api.change_client_placement` | `20260423032200_client_transfer_enforcement_and_same_day_placement.sql` | **EXCLUDED** | Read-back broadened in PR #27 review remediation; do NOT modify |
| `api.update_organization_unit` | `20260221173821_fix_org_unit_create_and_projection_guards.sql` | **DONE** | NOT FOUND guard added Part C of that migration; verify via `pg_get_functiondef` in Phase 1 |
| `api.update_client_address` | `20260406222857_client_api_functions.sql` | **NEEDS-INSPECTION** | Original definition; spot-check in Phase 1 |
| `api.update_client_email` | `20260406222857_client_api_functions.sql` | **NEEDS-INSPECTION** | Original definition; spot-check in Phase 1 |
| `api.update_client_funding_source` | `20260406222857_client_api_functions.sql` | **NEEDS-INSPECTION** | Original definition; spot-check in Phase 1 |
| `api.update_client_insurance` | `20260406222857_client_api_functions.sql` | **NEEDS-INSPECTION** | Original definition; spot-check in Phase 1 |
| `api.update_client_phone` | `20260406222857_client_api_functions.sql` | **NEEDS-INSPECTION** | Original definition; spot-check in Phase 1. Note: may have been touched by `20260408000351_fix_client_api_architecture_review.sql` (Major M5 — added read-back guards to "sub-entity add RPCs") |
| `api.update_field_definition` | `20260408023403_client_field_config_enhancements.sql` | **NEEDS-INSPECTION** | First defined in `20260327212247_client_field_api_functions.sql`, then patched in `20260408023403`; check both for diff during Phase 1 (m3 from PR #29 review) |
| `api.update_field_category` | `20260408023403_client_field_config_enhancements.sql` | **NEEDS-INSPECTION** | Spot-check in Phase 1 |
| `api.update_organization` | `20260226002002_organization_manage_page_phase1.sql` | **NEEDS-INSPECTION** | Spot-check in Phase 1. **Possibly-COMPLEX**: response may join contact/phone projections — confirm response shape and route through Phase 1b if joined (n1 from PR #29 review). |
| `api.update_organization_address` | `20260226002002_organization_manage_page_phase1.sql` | **NEEDS-INSPECTION** | Spot-check in Phase 1. **Possibly-COMPLEX**: sub-entity update; confirm whether response is just the address row or includes the parent organization aggregate. |
| `api.update_organization_contact` | `20260226002002_organization_manage_page_phase1.sql` | **NEEDS-INSPECTION** | Spot-check in Phase 1. **Possibly-COMPLEX**: same caveat as `_address`. |
| `api.update_organization_phone` | `20260226002002_organization_manage_page_phase1.sql` | **NEEDS-INSPECTION** | Spot-check in Phase 1. **Possibly-COMPLEX**: same caveat as `_address`. |
| `api.update_organization_direct_care_settings` | baseline `20260212010625_baseline_v4.sql` | **NEEDS-INSPECTION** | Defined in baseline; not touched since. Two overloads exist in baseline (3-arg and 4-arg with `p_reason`) — verify which is current on Phase 1 branch. |
| `api.update_role` | baseline `20260212010625_baseline_v4.sql` | **COMPLEX-CASE** | 4-arg `(p_role_id, p_name, p_description, p_permission_ids uuid[])` returning jsonb. Response composes role + permissions (join). Standard `%ROWTYPE` read-back insufficient; needs explicit `jsonb_build_object` aggregation. Pre-flag for Phase 1b. *(Added 2026-04-23 per PR #29 review M1.)* |
| `api.update_schedule_template` | `20260217231405_add_event_metadata_to_schedule_rpcs.sql` | **NEEDS-PATTERN** | Confirmed via grep: has pre-emit existence check (`IF NOT FOUND` after `SELECT ... INTO v_template`) but NO post-emit projection read-back guard |
| `api.update_user` | baseline `20260212010625_baseline_v4.sql` | **NEEDS-INSPECTION** | 4-arg `(p_user_id, p_org_id, p_first_name, p_last_name)` returning jsonb. Used by `frontend/src/services/users/SupabaseUserCommandService.ts`. Spot-check on Phase 1 branch. *(Added 2026-04-23 per PR #29 review M1.)* |
| `api.update_user_access_dates` | baseline `20260212010625_baseline_v4.sql` | **EXCLUDED** | RETURNS void — no projection row to read back via this RPC's contract. Caller-side success is the absence of an exception; per-event `processing_error` surfacing is still desirable, but does not require the standard read-back pattern. *(Added 2026-04-23 per PR #29 review M1.)* |
| `api.update_user_notification_preferences` | baseline `20260212010625_baseline_v4.sql` | **NEEDS-INSPECTION** | Defined in baseline; not touched since |
| `api.update_user_phone` | baseline `20260212010625_baseline_v4.sql` | **NEEDS-INSPECTION** | Defined in baseline; not touched since |
| `api.update_user_schedule` | DROPPED in `20260217211231_schedule_template_refactor.sql` | **EXCLUDED** | Function dropped during schedule template refactor; replaced by template-based assignment model |

**Phase 0 follow-up tasks for Phase 1 implementation branch**:
1. On the `feat/api-rpc-readback-pattern` branch, run `pg_get_functiondef(oid)` for each NEEDS-INSPECTION row and refine classification.
2. Verify EXCLUDED-as-dropped (`update_user_schedule`) is genuinely absent from live DB.
3. Confirm `api.update_organization_unit`'s NOT FOUND guard is the **post-emit** kind (not just a pre-emit existence check) — both kinds use `IF NOT FOUND` so source-code grep can mislead.
4. Possible additions if grep missed any — re-run the `pg_proc` query against the live DB on Phase 1 branch and reconcile.

**Out-of-grep RPCs investigation — RESOLVED 2026-04-23 (PR #29 review M1)**:
- `api.update_role`, `api.update_user`, `api.update_user_access_dates` — all confirmed defined in baseline `20260212010625_baseline_v4.sql` using quoted-identifier syntax (`"api"."update_*"`). Now promoted into the inventory table above with appropriate classifications.
- `api.update_user_profile` — does NOT exist; closest match is `api.update_user` (which the original parked-feature scope was probably referring to under a different name). No further investigation needed.

For each in-scope RPC after Phase 1 refinement, classify:
- Already has read-back → skip
- Needs read-back pattern applied → queue for Phase 1 standard-pattern
- Complex (batch / multi-projection) → handle case-by-case

## Phase 1: Migration

Single migration: `supabase migration new api_rpc_readback_pattern`

For each in-scope RPC, apply the standard pattern:

```sql
CREATE OR REPLACE FUNCTION api.update_foo(p_id uuid, p_changes jsonb, ...)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_event_id uuid;
  v_row foo_projection%ROWTYPE;
  v_processing_error text;
BEGIN
  -- existing permission / validation logic ...

  -- Emit event
  INSERT INTO domain_events (...) RETURNING id INTO v_event_id;

  -- Read back projection (trigger has fired synchronously)
  SELECT * INTO v_row FROM foo_projection WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Update failed to apply to projection' USING ERRCODE = 'P9003';
  END IF;

  -- Check processing_error on the event we just emitted
  SELECT processing_error INTO v_processing_error
  FROM domain_events WHERE id = v_event_id;

  IF v_processing_error IS NOT NULL THEN
    RAISE EXCEPTION 'Handler failure: %', v_processing_error USING ERRCODE = 'P9004';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'foo', row_to_json(v_row)
  );
END;
$$;
```

### 1a: Standard RPCs (apply pattern directly)
Enumerate after Phase 0 inventory.

### 1b: Complex RPCs (case-by-case)
Batch updates, multi-projection writes, conditional read-backs.

### 1c: Handler reference file updates
After migration applies, refresh any handler ref files affected.

## Phase 2: Frontend Service Type Updates

For each refactored RPC:
- Update TypeScript response type to include `row` field (or entity-specific name like `unit`, `role`)
- Services keep backward-compat: `const data = response.row || response.unit || ...` (fallback)
- Update tests accordingly

## Phase 3: Documentation

Compliance source: `documentation/AGENT-GUIDELINES.md` + `.claude/skills/documentation-writing/SKILL.md`. Detailed checklist with the per-file requirements lives in `api-rpc-readback-pattern-tasks.md` Phase 3 (sub-phases 3a–3f). High-level deliverables:

- **3a — NEW ADR** `documentation/architecture/decisions/adr-rpc-readback-pattern.md` — frontmatter, full TL;DR (Summary + specific When-to-read + Prerequisites + Key topics + read time), Context / Decision / Contract / Rollout / Alternatives / Consequences sections, Related Documentation backlinks. Contract spec: `{success, <entity>, ...}`; error codes P9003 (NOT FOUND), P9004 (handler failure).
- **3b — Update** `documentation/infrastructure/patterns/event-handler-pattern.md` Projection Read-Back Guard section: invert the "Affected RPCs" list (currently lists only org-unit RPCs as exceptions) into "All `api.update_*` and `api.change_*` MUST follow this pattern; exceptions: …", link to new ADR. Bump `last_updated`.
- **3c — Update** `documentation/AGENT-INDEX.md`: keyword table row + Document Catalog entry. Verify TL;DR Key topics matches AGENT-INDEX keywords (else navigation breaks).
- **3d — Update** `infrastructure/supabase/CLAUDE.md` (and `infrastructure/CLAUDE.md` if touched): the existing "RPC functions that read back ... MUST check for NOT FOUND" rule pre-dates this ADR — add a forward-link to the new ADR.
- **3e — Cross-link** in `documentation/architecture/decisions/adr-client-ou-placement.md` Decision 2 Enforcement subsection: forward-link the new ADR (proof-of-pattern → general pattern).
- **3f — Validation**: manual frontmatter + link audit (no CI gate for `documentation/` after `430e1c7d` removed `Validate Documentation` workflow); `npm run docs:check` for frontend; AGENT-GUIDELINES anti-pattern audit.

## Phase 4: ViewModel Simplification (PR 2 — OPTIONAL)

For ViewModels that currently call `getX()` after updates as a workaround:
- Remove the redundant fetch
- Consume the `row` from the update response
- Simplify error handling (exceptions now propagate from RPC)

This phase is optional and can be done incrementally; existing `getX()` calls remain safe.

## Success Criteria

- ✅ All in-scope `api.update_*` RPCs read back projection and check processing_error
- ✅ RAISE EXCEPTION on handler failure (no silent failures)
- ✅ Frontend services updated to consume new response shape
- ✅ ADR + pattern doc published
- ✅ `client-ou-edit`'s `api.update_client` remains consistent with the pattern

## Rollback Plan

Forward-only migrations. If a regression surfaces, create a new migration that reverts the specific RPC via `CREATE OR REPLACE FUNCTION` to its prior definition. Each RPC is independent.

## Out-of-Band Fixes Bundled

None anticipated. If Phase 0 inventory surfaces other RPC bugs, park or scope them.
