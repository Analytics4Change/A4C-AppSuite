# API RPC Read-back Pattern — Plan

## Executive Summary

Refactor all `api.update_*` RPCs to perform projection read-back and surface handler errors as `RAISE EXCEPTION`. Eliminates silent handler failures and removes the need for every ViewModel to re-implement the post-save recheck pattern.

**Trigger**: Discovered during `client-ou-edit` architect review (finding M3). `api.update_client` is being fixed in that feature's PR 1 as a proof-of-pattern; this feature generalizes the pattern to all other RPCs.

## Scope

- **In scope**: All `api.update_*` / `api.change_*` RPCs except `api.update_client` and `api.change_client_placement` (handled in `client-ou-edit`). Inventory confirmed during Phase 0.
- **Out of scope**: Creation RPCs (already return row), deletion RPCs (separate read-back concern), RPCs in workflow service layer

## Phase Summary

| Phase | Description | Effort | PR |
|-------|------------|--------|----|
| 0 | Inventory all `api.update_*` RPCs via `pg_proc` query; classify | Small | PR 1 |
| 1 | Migration: add read-back + processing_error check to each RPC; migration header enumerates the pattern | Medium | PR 1 |
| 2 | Update frontend service types to include `row` in response | Small | PR 1 |
| 3 | ADR + documentation | Small | PR 1 |
| 4 | Update ViewModels to consume returned row (remove redundant `getX()` calls) — optional follow-up | Medium | PR 2 (optional) |

**PR 1**: Phases 0–3 (backend + type updates + docs)
**PR 2 (optional)**: Phase 4 — ViewModel simplification

## Phase 0: RPC Inventory

Query to generate the list:
```sql
SELECT n.nspname AS schema, p.proname AS name, pg_get_function_arguments(p.oid) AS args,
       pg_get_function_result(p.oid) AS returns
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'api'
  AND p.proname LIKE 'update_%' OR p.proname LIKE 'change_%'
ORDER BY p.proname;
```

For each RPC, classify:
- Already has read-back → skip
- Needs read-back pattern applied → queue for Phase 1
- Complex (batch / multi-projection) → handle case-by-case

Produce a tracking table in this plan doc.

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

- NEW ADR: `documentation/architecture/decisions/adr-rpc-readback-pattern.md`
  - Documents the pattern
  - Contract: all `api.update_*` return `{success, <entity>, processing_error?}`
  - Error codes P9003 (NOT FOUND) and P9004 (handler failure)
  - Migration history
- Update `documentation/infrastructure/patterns/event-handler-pattern.md` with RPC-side contract
- Update AGENT-INDEX.md with new keyword entry `rpc-readback`

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
