# API RPC Read-back Pattern — Context

**Feature**: Enforce projection read-back + processing_error surfacing for all `api.update_*` RPCs
**Status**: 🟢 ACTIVE (Phase 0 in progress)
**Parked**: 2026-04-22
**Activated**: 2026-04-23 (per `client-ou-edit` Phase 9, after PR 1 merged as commit `e80de9bd`)
**Origin**: Surfaced by `software-architect-dbc` during review of `client-ou-edit` feature (Major finding M3); proof-of-pattern landed in `api.update_client` (migration `20260422052825`) and `api.change_client_placement` (migration `20260423032200`, PR #27 review remediation)

## Problem Statement

All `api.update_*` RPCs in the codebase emit a domain event and return `{success: true, <id>}` immediately — they do NOT read back the projection after the event trigger runs. Consequences:

1. **Silent handler failure**: If the event handler sets `processing_error` (e.g., column drift, RLS denial, constraint violation), the RPC caller has no way to detect it without a follow-up query.
2. **Stale UI state**: Frontend ViewModels that merge server data optimistically can render out-of-sync values.
3. **No surfacing of projection-level validation**: Handlers may apply business rules (e.g., soft-delete guards) whose failure is invisible to the client.

The `client-ou-edit` feature mitigates this at the ViewModel level (calling `getClient()` after save and checking `processing_error`). That mitigation works for one VM but does not scale — every new VM has to re-implement the pattern correctly.

## Scope

### In scope (RPCs to refactor)
All `api.update_*` and `api.change_*` RPCs that emit events and return only a success flag. Inventory (to be confirmed during Phase 0 of implementation):

- `api.update_organization_unit`
- `api.update_role`
- `api.update_user_profile`
- `api.update_schedule_template`
- `api.update_insurance` (sub-entity)
- `api.update_funding` (sub-entity)
- `api.update_contact` (sub-entity)
- Other `api.update_*` discovered via `pg_get_functiondef` audit

**Note**: `api.update_client` is handled separately in `client-ou-edit` PR 1 as a proof-of-pattern. This feature generalizes the pattern to all other RPCs.

### Out of scope
- `api.*_create` / `api.*_register` RPCs (creation already returns the new row in most cases)
- `api.*_delete` RPCs (soft-delete pattern has its own read-back via `FOUND` check — separate concern)
- `api.change_client_placement` (scoped into `client-ou-edit` PR 1)

## Key Design Question

**Two possible patterns**:

### Pattern A — RPC reads back and returns full row
```sql
-- After event emission:
SELECT * INTO v_row FROM x_projection WHERE id = p_id;
IF NOT FOUND THEN
  RAISE EXCEPTION 'Update failed to apply' USING ERRCODE = 'P9003';
END IF;

-- Check for processing error on the event we just emitted:
IF v_row.last_event_id = v_event_id THEN
  -- OK, projection updated
ELSE
  -- Handler may have errored — query domain_events
  SELECT processing_error INTO v_err FROM domain_events WHERE id = v_event_id;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'Handler failed: %', v_err USING ERRCODE = 'P9004';
  END IF;
END IF;

RETURN jsonb_build_object('success', true, 'row', row_to_json(v_row));
```

### Pattern B — Client polls + checks processing_error itself
Status quo. Require every client to query after update.

**Recommended**: Pattern A — shift responsibility to the RPC so clients get consistent behavior.

## Considerations

- **Synchronous vs async triggers**: Current event triggers are `BEFORE INSERT/UPDATE` on `domain_events` — synchronous. Projection IS updated by the time the RPC continues. Read-back is always safe.
- **Performance**: One additional projection SELECT per update. Negligible (indexed PK lookup).
- **Backward compat**: Response shape changes from `{success, id}` to `{success, id, row}`. Frontend services must be updated to accept the new shape. Can be phased: include `row` optionally first, then make it authoritative.
- **Error surfacing**: `processing_error` on `domain_events` is currently the primary signal. RPC read-back converts silent failure into a RAISE EXCEPTION so PostgREST returns non-200.
- **Concurrency**: If two clients update simultaneously, each sees its own read-back. This is a win (clients see latest state).

## Related Work

- `client-ou-edit` PR 1 (2026-04-22+) — adds read-back to `api.update_client` as a proof-of-pattern
- Prior migration `20260221173821_fix_org_unit_rpc_guards.sql` — added read-back guards to 4 of 5 org unit RPCs (delete handler was the 5th, fixed 2026-02-23)
- ADR (to be created): `documentation/architecture/decisions/adr-rpc-readback-pattern.md`

## Important Constraints

- **Do NOT touch `api.change_client_placement` or `api.update_client`**: Already handled in `client-ou-edit` PR 1.
- **Must preserve RPC param signatures**: Existing callers must not break. Add return fields only.
- **Must run against live DB with existing data**: Projections cannot be rebuilt; read-back must not mutate.
- **Respect idempotency**: Migrations use `CREATE OR REPLACE FUNCTION` — safe to re-run.

## Reference Materials

- `infrastructure/supabase/supabase/migrations/20260221173821_fix_org_unit_rpc_guards.sql` — prior read-back pattern example
- `documentation/infrastructure/patterns/event-handler-pattern.md` — handler conventions
- `software-architect-dbc` review of `client-ou-edit` (M3 finding) — motivating context
- `dev/active/client-ou-edit-*.md` — the feature that surfaced this pattern

## Implementation Lessons

### N3 — Heredoc truncation bug in Phase 1.6 v2 migration (2026-04-23)

**What happened**: Phase 1.6 shipped migration `20260423065747_api_rpc_readback_v2_event_id_check.sql` as an 1820-line file containing 20 CREATE OR REPLACE FUNCTION definitions. The initial write used a heredoc that truncated silently at ~1100 lines due to an unescaped `$$` sequence inside an inner plpgsql block (heredoc terminator collision). The resulting migration file applied partially — 14 RPCs retrofitted, 6 truncated away. `supabase db push --linked` succeeded because the CREATE OR REPLACE statements that were present compiled cleanly; the missing 6 RPCs were silently absent from the migration.

**How we detected it**: Post-apply `supabase db dump --linked --schema=api` showed only 14 of the 20 expected `WHERE id = v_event_id` post-emit checks. Cross-checking the migration file line count (1820 lines expected, ~1100 actual in the first write) confirmed the truncation.

**Recovery**: `supabase migration repair --linked --status reverted 20260423065747` → rewrote the migration file as 20 separate CREATE OR REPLACE blocks (no nested heredoc) → `supabase db push --linked` re-applied the corrected complete file. Net result: all 20 function definitions retrofitted in one atomic apply after the repair.

**Takeaways for future large migrations**:

1. **Avoid heredoc-within-heredoc**: Either use a tool-driven write (Write tool enforces byte-accurate content) or stick to the `$$ ... $$` dollar-quote pattern for SQL that contains SQL (no nested heredoc delimiters).
2. **Verify line count after write**: Before `supabase db push`, `wc -l` the migration and cross-check against the expected function count × typical-size. A 1820-line file that writes as 1100 is a red flag.
3. **Verify via post-apply dump** for migrations touching >5 functions: `supabase db dump --linked --schema=<schema>` then grep for per-function signatures. Don't rely on `supabase db push` exit code alone — it only catches syntax errors, not missing definitions.
4. **`supabase migration repair --status reverted` is the right recovery** when a migration applied partially — it lets you re-push the corrected file without duplicate-history errors.

**Where this note goes on merge**: This file (`api-rpc-readback-pattern-context.md`) moves to `dev/archived/api-rpc-readback-pattern/` on PR #30 merge per the project's dev-doc lifecycle. The postmortem travels with the feature folder; it is NOT duplicated into the ADR (which is decision-record, not implementation war story) or handler reference files (which are code).
