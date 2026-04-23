---
status: current
last_updated: 2026-04-23
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: All `api.update_*` and `api.change_*` RPCs MUST perform a post-emit projection read-back guard and surface handler failures via the return-error envelope (`{success: false, error: 'Event processing failed: <processing_error>'}`). RAISE EXCEPTION is forbidden for handler-driven failures because it rolls back the `domain_events` audit row that the BEFORE INSERT trigger just persisted.

**When to read**:
- Adding a new `api.update_*` or `api.change_*` RPC
- Debugging why an RPC returns `{success: false, error: 'Event processing failed: ...'}`
- Writing a frontend service consumer for an update RPC
- Investigating a missing `processing_error` in the admin event-failures dashboard
- Reviewing whether a new pattern should `RAISE EXCEPTION` or return an error envelope

**Prerequisites** (optional per [AGENT-GUIDELINES.md](../../AGENT-GUIDELINES.md), but recommended): [event-handler-pattern.md](../../infrastructure/patterns/event-handler-pattern.md), [event-sourcing-overview.md](../data/event-sourcing-overview.md)

**Key topics**: `adr`, `rpc-readback`, `processing-error`, `projection-guard`, `api-contract`

**Estimated read time**: 10 minutes
<!-- TL;DR-END -->

# ADR: API RPC Read-back Pattern

**Date**: 2026-04-23
**Status**: Implemented (Phase 1 of `api-rpc-readback-pattern` feature — migration `20260423060052` applied to linked dev project; 11 RPCs refactored)
**Deciders**: Lars (architect), software-architect-dbc (review), Claude (implementation)

## Context

In an event-sourced/CQRS codebase like A4C-AppSuite, every projection mutation flows through a domain event:

1. RPC validates input and emits a domain event via `api.emit_domain_event()` (or raw `INSERT INTO domain_events`).
2. PostgreSQL `BEFORE INSERT/UPDATE` trigger `process_domain_event()` routes the event to a handler that updates the projection synchronously.
3. RPC returns to the caller.

The trigger's catch-all `EXCEPTION WHEN OTHERS` block (see `infrastructure/supabase/handlers/trigger/process_domain_event.sql:9-58`) is load-bearing for the observability surface: when a handler fails, the trigger catches the exception and stores it in the `NEW.processing_error` column without re-raising. The `domain_events` row INSERTs successfully with the failure trace preserved. Admin dashboards (`/admin/events`), the `api.retry_failed_event()` recovery RPC, and queries like "show me events with `processing_error`" all depend on this row committing.

Before this pattern, RPCs would emit and return `{success: true, <id>}` immediately. If the handler set `processing_error`, the caller had no way to detect it short of a follow-up query. This caused a class of silent-failure bugs documented in [event-observability.md](../../infrastructure/guides/event-observability.md):

- User invited but no role assigned
- Organization created but bootstrap incomplete
- Invitation accepted but status not updated

The first remediation landed in `api.update_client` (PR 1 of the `client-ou-edit` feature, migration `20260422052825`) as a proof-of-pattern. The second landed in `api.change_client_placement` (PR #27 review remediation, migration `20260423032200`). This ADR formalizes and generalizes the pattern across all in-scope `api.update_*` and `api.change_*` RPCs.

## Decisions

### Decision 1 — All `api.update_*` and `api.change_*` RPCs MUST perform a post-emit projection read-back

**Decision**: After emitting the domain event, the RPC reads back the corresponding projection row and surfaces a handler failure to the caller. Standard form:

```sql
PERFORM api.emit_domain_event(...);

SELECT * INTO v_row FROM <projection> WHERE id = <key>;

IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error
    FROM domain_events
    WHERE stream_id = <stream_id> AND event_type = '<event_type>'
    ORDER BY created_at DESC LIMIT 1;

    RETURN jsonb_build_object(
        'success', false,
        'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown')
    );
END IF;

RETURN jsonb_build_object(
    'success', true,
    '<entity_id>', <key>,
    '<entity>', row_to_json(v_row)::jsonb
);
```

**Rationale**: Without the read-back, every silent-failure path the team has been bitten by (catalogued in [event-observability.md](../../infrastructure/guides/event-observability.md)) re-emerges with each new RPC. Centralizing the check at the RPC layer means consumers (ViewModels, Edge Functions, scripts) get a uniform `success` flag and don't have to re-implement the post-save processing_error query.

**Exceptions** (do NOT apply this pattern):
- Creation RPCs (`api.create_*`, `api.register_*`) — the projection row didn't exist before the event; standard pattern would always trigger NOT FOUND on first creation. Use existing creation contract (returns the new id).
- Deletion RPCs — soft-delete + hard-delete have their own concerns (separate read-back guard via `FOUND` check on the SELECT-before-delete; not in this pattern's scope).
- RPCs that RETURN `void` (e.g. `api.update_user_access_dates`) — no projection row to read back. Per-event `processing_error` surfacing is still desirable but does not require this pattern.
- RPCs in the workflow service layer (Edge Functions, Temporal activities) — separate orchestration tier; failures surface via workflow saga compensation.

### Decision 2 — Audit-trail preservation (load-bearing): handler-driven failures MUST use return-error envelope, NOT `RAISE EXCEPTION`

**Decision**: When the read-back returns NOT FOUND (handler-driven failure), the RPC MUST `RETURN jsonb_build_object('success', false, 'error', ...)`. `RAISE EXCEPTION` is **forbidden** for this code path.

**Rationale**: PostgreSQL transaction semantics. The `process_domain_event()` trigger's `WHEN OTHERS` catch persists the handler exception text to the NEW row's `processing_error` column without re-raising — but the row itself is still mid-INSERT, inside the calling transaction. If the RPC subsequently `RAISE EXCEPTION`s, the transaction rolls back, including the just-inserted `domain_events` row carrying `processing_error`. The diagnostic evidence vanishes:

- The `processing_error` text identifying the failing handler — gone.
- The `event_data`/`event_metadata` payload that triggered the failure — gone.
- The `correlation_id` linking the failure to the lifecycle — gone.
- The ability to retry via `api.retry_failed_event()` — nothing to retry.

This is not theoretical. Migration `20260220185837_fix_event_routing.sql` (fix F) recovered johnltice@yahoo.com / Live for Life data after a routing bug *because* the failed events had been preserved with `processing_error`. Without that, recovery would have required replaying from the workflow tier.

**Validation**: `infrastructure/supabase/handlers/trigger/process_domain_event.sql:9-58` is the catch-and-persist mechanic this ADR is built around. Migration `20260423060052` consistently uses `RETURN` for handler-driven failures across all 11 refactored RPCs.

**Software-architect-dbc** review (2026-04-23) endorsed this constraint as load-bearing — "the dispatcher's catch-and-record mechanic only makes sense if callers honor it. RAISE EXCEPTION at the RPC layer would functionally undo the trigger's careful preservation of `processing_error`."

### Decision 3 — Caller-driven failures may use either pattern (preserve existing per-RPC behavior)

**Decision**: Caller-driven failures (permission denial, entity-not-found pre-emit, validation errors) happen BEFORE event emission, so no audit trail to preserve. They may use either:
- `RETURN jsonb_build_object('success', false, ...)` — consistent envelope; preferred for new RPCs
- `RAISE EXCEPTION` — surfaces as PostgREST 4xx with `{message, code, details, hint}`; existing RPCs that use this pattern continue to do so

Each refactored RPC preserves its existing pre-emit pattern. Only post-emit handler failures fall under Decision 2.

**Rationale**: Consistency with the existing per-RPC behavior avoids breaking consumers. The two patterns coexist but with strict scope boundaries:
- Pre-emit failures → either pattern OK
- Post-emit handler failures → return-error only

### Decision 4 — Response shape: success returns `{success: true, <entity>}`; failure returns `{success: false, error: '...'}`

**Decision**: On successful read-back, the response includes the projection row under a typed field name (e.g. `'address'`, `'phone'`, `'role'`, `'organization'`). For COMPLEX-CASE RPCs that compose joined data, use explicit `jsonb_build_object` to enumerate the response shape.

```sql
-- Standard case (single projection row):
RETURN jsonb_build_object('success', true, '<entity_id>', <key>, '<entity>', row_to_json(v_row)::jsonb);

-- COMPLEX-CASE (e.g. update_role composes role + permission_ids):
RETURN jsonb_build_object(
    'success', true,
    'role', row_to_json(v_role_row)::jsonb,
    'permission_ids', to_jsonb(v_perm_ids_array)
);
```

HTTP status: always 200 OK. The PostgREST response shape is `{success, ...}`; consumers parse `success` to branch.

**Rationale**: Frontend services across the codebase already follow the `{success, error?}` envelope contract per [`frontend/src/services/CLAUDE.md`](../../../frontend/src/services/CLAUDE.md) Section 1. Using a uniform shape across all refactored RPCs avoids per-RPC contract divergence.

### Decision 5 — Telemetry convention: parse `error` prefix, NOT PostgREST `code` field

**Decision**: Frontend telemetry distinguishes silent-handler-failure responses by parsing `result.error` for the prefix `"Event processing failed: "`. ViewModels surface this via a dedicated `processingError` state (vs. generic `error`) so admin-facing UIs can offer a "View event in audit log" link querying `domain_events WHERE processing_error IS NOT NULL`.

**Why not the PostgREST `code` field**: The original n2 telemetry note from PR #29 review proposed using PostgreSQL `ERRCODE` (e.g. P9003 / P9004) surfaced via PostgREST's response `code` field. That would only work under Pattern B (`RAISE EXCEPTION ... USING ERRCODE = ...`), which Decision 2 forbids for handler-driven failures. Under Pattern A, PostgREST always returns 200 OK with `{success, error}`, so there is no `code` field to read.

**Software-architect-dbc** drafted the recommended ViewModel convention: `if (response.error?.startsWith('Event processing failed: ')) { /* surface as processingError, offer audit-log link */ } else { /* generic error */ }`.

## Contract

### Request → Response shapes

| Scenario | RPC behavior | Response | HTTP |
|---|---|---|---|
| Success | Event emitted, handler updated projection, read-back found row | `{success: true, <entity_id>: <key>, <entity>: <row>}` | 200 |
| Handler failure (silent) | Event emitted, handler raised, trigger caught + persisted `processing_error`, read-back returns NOT FOUND | `{success: false, error: 'Event processing failed: <processing_error text>'}` | 200 |
| Caller-driven failure (pre-emit) | Permission/validation/not-found check failed; event NOT emitted | `{success: false, error: '...'}` (preferred) OR PostgREST 4xx if existing RPC uses RAISE | 200 (preferred) or 4xx |

### Error codes

NO custom PostgreSQL `ERRCODE`s for handler-driven failures (P9003/P9004 from the parked plan are NOT used). The `error` string is the contract; admin tooling parses the prefix.

For caller-driven failures that do use `RAISE EXCEPTION`, existing ERRCODEs are preserved (e.g. `P0002` for not-found, `42501` for access-denied — both established Postgres conventions).

## Rollout history

- **2026-04-22** — Migration `20260422052825_client_ou_placement_and_edit_support.sql` adds Pattern A read-back to `api.update_client` as proof-of-pattern (PR 1 of `client-ou-edit` feature, M3 architect finding remediation).
- **2026-04-23** — Migration `20260423032200_client_transfer_enforcement_and_same_day_placement.sql` extends Pattern A read-back to `api.change_client_placement` (PR #27 review remediation).
- **2026-04-23** — Migration `20260423060052_api_rpc_readback_pattern.sql` generalizes Pattern A to 10 NEEDS-PATTERN RPCs + 1 COMPLEX-CASE (`api.update_role`):
  - 5 client sub-entity: `update_client_address`, `_email`, `_funding_source`, `_insurance`, `_phone`
  - 1 organization (BOTH 3-arg + 4-arg overloads): `update_organization_direct_care_settings` (BREAKING response shape; frontend consumer fixed in companion commit)
  - 3 user: `update_user`, `_phone`, `_notification_preferences`
  - 1 schedule: `update_schedule_template`
  - 1 role (COMPLEX-CASE composing role + permissions): `update_role`
- **2026-04-23** — Migration `20260423062426_add_user_profile_updated_handler.sql` adds the missing `handle_user_profile_updated` handler that the read-back surfaced as never-implemented dead code.

Total RPCs now using Pattern A: **18** (7 already-DONE pre-2026-04-23 + 11 shipped in `20260423060052`).

## Alternatives considered

### Pattern B — `RAISE EXCEPTION ... USING ERRCODE = 'P9003'/'P9004'`

The original parked-feature plan proposed this. Rejected because RAISE EXCEPTION at the RPC layer rolls back the `domain_events` audit row that the BEFORE INSERT trigger just persisted with `processing_error`, destroying diagnostic evidence (see Decision 2 rationale). PostgREST returns non-2xx with `{message, code, details, hint}` — a different shape than the existing `{success, error}` envelope, requiring a parallel parser in every frontend service. Net loss of audit trail + consumer churn.

### Client-side polling

ViewModels could re-query `domain_events` after every save to check for `processing_error`. Rejected because every new ViewModel would have to re-implement the recheck pattern correctly, and a missed implementation would re-introduce the silent-failure bug. Centralizing at the RPC layer means consumers get a uniform `success` flag.

## Known limitation

`IF NOT FOUND` only catches the case where the projection row is COMPLETELY MISSING. For UPDATE-only handlers (most refactored RPCs target rows created by separate `add_*` or `register_*` RPCs), a handler that raises mid-update sets `processing_error` but the row remains visible (just stale). The current implementation matches the existing pre-2026-04-23 DONE-RPC pattern (IF NOT FOUND only) for consistency.

A future enhancement could add an explicit `processing_error` check on the just-emitted event after the IF NOT FOUND check:

```sql
SELECT * INTO v_row FROM <projection> WHERE id = <key>;
IF NOT FOUND THEN
    -- ... (current behavior)
END IF;

-- Future addition: also catch handler-raised on existing row
SELECT processing_error INTO v_processing_error
FROM domain_events
WHERE stream_id = <stream_id> AND event_type = '<event_type>'
ORDER BY created_at DESC LIMIT 1;

IF v_processing_error IS NOT NULL THEN
    RETURN jsonb_build_object('success', false,
        'error', 'Event processing failed: ' || v_processing_error);
END IF;

RETURN jsonb_build_object('success', true, ...);
```

If pursued, the enhancement should land across ALL 18 refactored RPCs in lockstep to maintain pattern consistency. `api.update_role` already includes a 5-second-window variant of this check for its multi-event partial-success case.

## Consequences

### Schema & Functions
- 18 `api.update_*` / `api.change_*` RPCs follow Pattern A
- Migration headers reference this ADR (3 migrations: `20260422052825`, `20260423032200`, `20260423060052`)
- New handler `public.handle_user_profile_updated` (closes a 5-month-old gap surfaced by the generalization)

### Frontend
- Service-layer envelope contract `{success, error?, <entity>?}` is uniform across 18 RPCs
- `ClientRpcResult` type extended with optional read-back entity fields (`phone`, `email`, `address`, `policy`, `funding_source`)
- One BREAKING change in `SupabaseDirectCareSettingsService.updateSettings()` (legacy raw-jsonb shape → envelope shape) — handled with backward-compat fallback in the consumer

### Observability
- `processing_error` continues to populate on `domain_events` failures (no transaction rollback at RPC layer)
- Admin dashboard at `/admin/events` and `api.retry_failed_event()` recovery RPC remain functional
- Frontend ViewModels can detect handler-driven failures via `result.error?.startsWith('Event processing failed: ')` and surface to admin-facing UIs with audit-log link affordance

### Performance
- One additional indexed PK lookup per refactored RPC call. Negligible.
- No additional DB roundtrips (read-back happens within the same RPC call).

## Related Documentation

- [event-handler-pattern.md](../../infrastructure/patterns/event-handler-pattern.md) — Projection Read-Back Guard section codifies this pattern at the handler-architecture layer; this ADR formalizes the contract decision
- [event-observability.md](../../infrastructure/guides/event-observability.md) — Failed-event monitoring; `processing_error` query examples; `/admin/events` dashboard reference
- [event-sourcing-overview.md](../data/event-sourcing-overview.md) — CQRS architecture; why the read-side / write-side split makes the read-back pattern necessary
- [adr-client-ou-placement.md](./adr-client-ou-placement.md) — Decision 2 Enforcement section is the proof-of-pattern application; this ADR generalizes that decision to all RPCs
- [infrastructure/supabase/CLAUDE.md](../../../infrastructure/supabase/CLAUDE.md) — "RPC functions that read back from projections MUST check for NOT FOUND" guard rail predates this ADR; cross-referenced in that section
- [frontend/src/services/CLAUDE.md](../../../frontend/src/services/CLAUDE.md) — Frontend service envelope contract that this ADR's response shape conforms to
