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

### Inventory Tracking Table — populated 2026-04-23 (revised after PR #29 review; refined 2026-04-23 via live `supabase db dump`)

22 distinct `api.update_*` / `api.change_*` RPCs identified via grep across `infrastructure/supabase/supabase/migrations/` using two patterns: the unquoted `api\.(update|change)_` (covers post-baseline migrations) and the quoted-identifier `"api"\."(update|change)_` (covers `20260212010625_baseline_v4.sql`). The first pattern alone missed 3 baseline-only RPCs surfaced by PR #29 review (M1) — `api.update_role`, `api.update_user`, `api.update_user_access_dates` — now included below.

**Phase 1 refinement** (2026-04-23, on branch `feat/api-rpc-readback-pattern`): MCP supabase token still unavailable, so refinement performed by `supabase db dump --linked --schema=api` (saved to `/tmp/api_schema_dump.sql`, 442 KB) and inspecting each function body. All 13 prior NEEDS-INSPECTION rows are now definitively classified; the "Possibly-COMPLEX" hints from PR #29 review n1 were resolved (none of the org-* RPCs return joined data — they all read back the single sub-entity row only).

Final tally (post-refinement): **EXCLUDED 4** (do not modify), **DONE 7** (already have post-emit read-back guards), **NEEDS-PATTERN 10** (apply standard `%ROWTYPE` pattern), **COMPLEX-CASE 1** (`update_role` — multiple events + joined permissions). Total 22.

Classification key:
- **EXCLUDED** — handled elsewhere or no projection row to read back; do not touch
- **DONE** — already has post-emit projection read-back guard (NOT FOUND check after event emission)
- **NEEDS-INSPECTION** — function exists; current state unknown; verify on Phase 1 implementation branch
- **NEEDS-PATTERN** — confirmed missing read-back; apply standard `%ROWTYPE` pattern
- **COMPLEX-CASE** — read-back required but the response composes joined data (role+permissions, contact+phone, etc.); standard `%ROWTYPE` pattern won't compose — needs explicit `jsonb_build_object` aggregation. Route through Phase 1b.

| RPC | Latest migration | Classification | Read-back projection | Notes |
|-----|------------------|----------------|---------------------|-------|
| `api.update_client` | `20260422052825_client_ou_placement_and_edit_support.sql` | **EXCLUDED** | n/a | Proof-of-pattern shipped in client-ou-edit PR 1; do NOT modify |
| `api.change_client_placement` | `20260423032200_client_transfer_enforcement_and_same_day_placement.sql` | **EXCLUDED** | n/a | Read-back broadened in PR #27 review remediation; do NOT modify |
| `api.update_user_access_dates` | baseline `20260212010625_baseline_v4.sql` | **EXCLUDED** | n/a | RETURNS void — no projection row to read back. Caller-side success = absence of exception. Could be enhanced in a separate Phase to surface `processing_error`, but not in this feature's scope. |
| `api.update_user_schedule` | DROPPED in `20260217211231_schedule_template_refactor.sql` | **EXCLUDED** | n/a | Function dropped during schedule template refactor; replaced by template-based assignment model |
| `api.update_organization_unit` | `20260221173821_fix_org_unit_create_and_projection_guards.sql` | **DONE** | `organization_units_projection` | NOT FOUND guard added Part C of that migration. Confirmed via dump: post-emit `SELECT * INTO v_result` + IF NOT FOUND + processing_error query. ✅ |
| `api.update_field_definition` | `20260408023403_client_field_config_enhancements.sql` | **DONE** | `client_field_definitions_projection` | First defined in `20260327212247_client_field_api_functions.sql`, then patched in `20260408023403`. Confirmed via dump: has post-emit read-back. ✅ |
| `api.update_field_category` | `20260408023403_client_field_config_enhancements.sql` | **DONE** | `client_field_categories_projection` | Confirmed via dump: has post-emit read-back. ✅ |
| `api.update_organization` | `20260226002002_organization_manage_page_phase1.sql` | **DONE** | `organizations_projection` | Confirmed via dump: post-emit `SELECT * INTO v_result FROM organizations_projection WHERE id = p_org_id` + IF NOT FOUND + processing_error query. ✅ |
| `api.update_organization_address` | `20260226002002_organization_manage_page_phase1.sql` | **DONE** | `addresses_projection` | Confirmed via dump: standard pattern. n1's "Possibly-COMPLEX" hint resolved — response is the single address row only, not a joined aggregate. ✅ |
| `api.update_organization_contact` | `20260226002002_organization_manage_page_phase1.sql` | **DONE** | `contacts_projection` | Confirmed via dump: standard pattern. n1's "Possibly-COMPLEX" hint resolved — single contact row only. ✅ |
| `api.update_organization_phone` | `20260226002002_organization_manage_page_phase1.sql` | **DONE** | `phones_projection` | Confirmed via dump: standard pattern. n1's "Possibly-COMPLEX" hint resolved — single phone row only. ✅ |
| `api.update_client_address` | `20260406222857_client_api_functions.sql` | **NEEDS-PATTERN** | `client_addresses_projection` (confirmed via grep) | Confirmed via dump: emits `client.address.updated` then returns immediately — no post-emit read-back. Apply standard `%ROWTYPE` pattern. |
| `api.update_client_email` | `20260406222857_client_api_functions.sql` | **NEEDS-PATTERN** | `client_emails_projection` (confirmed via grep) | Confirmed via dump: emits `client.email.updated`, no post-emit read-back. |
| `api.update_client_funding_source` | `20260406222857_client_api_functions.sql` | **NEEDS-PATTERN** | `client_funding_sources_projection` (confirmed via grep) | Confirmed via dump: emits `client.funding_source.updated`, no post-emit read-back. |
| `api.update_client_insurance` | `20260406222857_client_api_functions.sql` | **NEEDS-PATTERN** | `client_insurance_policies_projection` (confirmed via grep) | Confirmed via dump: emits `client.insurance.updated`, no post-emit read-back. |
| `api.update_client_phone` | `20260406222857_client_api_functions.sql` | **NEEDS-PATTERN** | `client_phones_projection` (confirmed via grep) | Confirmed via dump: emits via `api.emit_domain_event(...)`, no post-emit read-back. |
| `api.update_organization_direct_care_settings` | baseline `20260212010625_baseline_v4.sql` | **NEEDS-PATTERN** | `organizations_projection` | Two overloads in baseline (3-arg without reason and 4-arg with `p_reason`) — confirm via `pg_proc` which is current on apply. Confirmed via dump: emits but no post-emit read-back. |
| `api.update_schedule_template` | `20260217231405_add_event_metadata_to_schedule_rpcs.sql` | **NEEDS-PATTERN** | `schedule_templates_projection` | Confirmed via dump: pre-emit existence check exists (`SELECT * INTO v_template`) but NO post-emit read-back guard. The pre-emit check is informational; standard pattern still required. |
| `api.update_user` | baseline `20260212010625_baseline_v4.sql` | **NEEDS-PATTERN** | `users` (base table, not `_projection`) | Confirmed via dump: uses raw `INSERT INTO domain_events (...)` (not `api.emit_domain_event(...)`) + manual stream_version calc + `RETURNING id INTO v_event_id`, then returns. No read-back. **Caveats**: (1) preserve manual stream_version contract; (2) read back from `users` (handler `handle_user_profile_updated` writes to that base table — `users` predates the projection-suffix convention). |
| `api.update_user_phone` | baseline `20260212010625_baseline_v4.sql` | **NEEDS-PATTERN** | `user_phones` OR `user_org_phone_overrides` | Confirmed via dump: emits `user.phone.updated`. **Caveat**: function reads from one of two tables based on `p_org_id` (NULL → `user_phones`, NOT NULL → `user_org_phone_overrides`). Read-back must mirror the same branching to read from the right table. |
| `api.update_user_notification_preferences` | baseline `20260212010625_baseline_v4.sql` | **NEEDS-PATTERN** | `user_notification_preferences_projection` (confirmed via grep) | Confirmed via dump: emits `user.notification_preferences.updated` + returns immediately. No post-emit read-back. |
| `api.update_role` | baseline `20260212010625_baseline_v4.sql` | **COMPLEX-CASE** | `roles_projection` + `role_permissions_projection` | 4-arg `(p_role_id, p_name, p_description, p_permission_ids uuid[])` returning jsonb. Confirmed via dump: emits 1-N events (`role.updated`, `role.permission.granted`, `role.permission.revoked`) and returns just `{success: true}`. Read-back must compose role row + array of permission_ids; needs explicit `jsonb_build_object` + `array_agg`, not `%ROWTYPE`. **Phase 1b case-by-case treatment.** |

**Phase 0 follow-up tasks — RESOLVED 2026-04-23 on `feat/api-rpc-readback-pattern` branch**:
1. ✅ `supabase db dump --linked --schema=api --schema=public` saved to `/tmp/api_schema_dump.sql` (442 KB); each NEEDS-INSPECTION row inspected and reclassified.
2. ✅ `update_user_schedule` confirmed absent from dump (no `CREATE OR REPLACE FUNCTION "api"."update_user_schedule"` block).
3. ✅ `update_organization_unit` post-emit read-back confirmed via dump body inspection (not just pre-emit existence check).
4. ✅ `pg_proc` query equivalent run via dump's full function inventory; no missing RPCs surfaced beyond the 22 already catalogued.
5. ⚠️ **Pending verification on apply**: projection table names in the NEEDS-PATTERN rows (e.g. `client_addresses_projection`) marked "(confirmed via grep)" — confirm exact names from live `information_schema.tables` when writing each `CREATE OR REPLACE FUNCTION`. Most use the standard `<entity>_projection` suffix but the client sub-entity tables may use plural-then-projection (e.g. `client_addresses_projection`).

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
