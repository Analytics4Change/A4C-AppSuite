---
status: current
last_updated: 2026-04-24
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

**Date**: 2026-04-23 (initial — Pattern A v1) / 2026-04-23 (revision — Pattern A v2 closes the field-level write-through gap)
**Status**: Implemented (Phase 1+1.6 of `api-rpc-readback-pattern` feature — migrations `20260423060052` (v1) + `20260423065747` (v2) applied to linked dev project; 19 single-event RPCs on v2; `update_role` on COMPLEX-CASE multi-event variant)
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

### Decision 1 — All `api.update_*` and `api.change_*` RPCs MUST perform a post-emit projection read-back (Pattern A v2)

**Decision**: After emitting the domain event, the RPC reads back the corresponding projection row AND verifies the just-emitted event did not carry a `processing_error`. Standard form (Pattern A v2 — see "Pattern A v1 → v2 (Resolved)" section below for why both checks are required):

```sql
v_event_id := api.emit_domain_event(...);  -- capture event_id (RETURNS uuid already)

SELECT * INTO v_row FROM <projection> WHERE id = <key>;

IF NOT FOUND THEN
    -- Defense in depth: catches genuinely-missing-row case
    SELECT processing_error INTO v_processing_error
    FROM domain_events WHERE id = v_event_id;
    RETURN jsonb_build_object(
        'success', false,
        'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown')
    );
END IF;

-- v2: race-safe check on the just-emitted event (catches handler-raised on existing row)
SELECT processing_error INTO v_processing_error
FROM domain_events WHERE id = v_event_id;
IF v_processing_error IS NOT NULL THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', 'Event processing failed: ' || v_processing_error
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
- **2026-04-23** — Migration `20260423065747_api_rpc_readback_v2_event_id_check.sql` upgrades all 19 single-event RPCs from Pattern A v1 (IF NOT FOUND only) to **Pattern A v2** (IF NOT FOUND + race-safe post-emit `WHERE id = v_event_id` check on `processing_error`). Closes the field-level write-through gap documented in the original "Known Limitation" section. `update_role` kept on the COMPLEX-CASE multi-event variant at this point (see next entry for v2 COMPLEX-CASE retrofit).
- **2026-04-23** — Migration `20260423074238_api_rpc_readback_v2_m1_m2_fix.sql` addresses PR #30 review findings M1 + M2 (architect-reviewed, agent `ad2e78383cd378c9f`):
  - **M1** — 6 RPCs (`update_client_address`, `_email`, `_funding_source`, `_insurance`, `_phone`, `update_client`) had a race-prone `ORDER BY created_at DESC LIMIT 1` query in their IF NOT FOUND branch despite `v_event_id` being captured in scope. Rewritten to use `WHERE id = v_event_id` consistently in both the IF NOT FOUND and post-emit branches. All 20 Pattern A v2 single-event RPC definitions now use the race-safe PK lookup in both branches.
  - **M2** — `update_role` (COMPLEX-CASE) switched from wall-clock 5-second-window detection (`created_at > NOW() - INTERVAL '5 seconds'`) to captured-event-id semantics. Each emit (`role.updated`, N × `role.permission.granted`, M × `role.permission.revoked`) appends its UUID to `v_event_ids uuid[]`; the error lookup uses `WHERE id = ANY(v_event_ids) AND processing_error IS NOT NULL`. Race-safe under concurrent role edits; correctly scoped to this RPC's own emits; empty-array no-op case returns `{success: true}` correctly.

- **2026-04-23** — Migration `20260423232531_add_user_phone_pattern_a_v2_readback.sql` extends `api.add_user_phone` to Pattern A v2 (Blocker 3 PR A, `feat/phase4-user-domain-typing`, architect-reviewed `a9dee2ed181895edb`). The read-back SELECT branches on `p_org_id IS NULL` to read from `user_phones` (global) vs `user_org_phone_overrides` (org-scoped) since the handler writes to two different tables. Returns the full phone entity in camelCase via explicit `jsonb_build_object` (not `row_to_json`) so frontend consumers can patch their observable state in place without a shape-normalizer step — see [rpc-readback-vm-patch.md](../../frontend/patterns/rpc-readback-vm-patch.md). Paired with `manage-user` Edge Function v10 which adds `notificationPreferences` to its `update_notification_preferences` response envelope; version-gated via `deployVersion` field.

- **2026-04-24** — `manage-user` Edge Function upgraded v10 → **v11** (`feat/phase4-user-domain-typing`, PR #32 remediation, architect-reviewed `a060ef3faaa5b630c`). **First Edge Function Pattern A v2 adopter**. v10 echoed submitted preferences as "read-back"; v11 performs a genuine two-step check: (1) SELECT `processing_error FROM domain_events WHERE id = eventId` (race-safe PK lookup — `BEFORE INSERT` trigger commits inside the RPC call, so the subsequent Edge Function round-trip always sees the final state), (2) SELECT the 4-column projection row from `user_notification_preferences_projection` (the handler's target table — prior comment block incorrectly cited `user_org_access`). NOT-FOUND on read-back is now tagged `handlerInvariantViolated: true` in the error log since the handler UPSERTs. Event metadata now also includes `organization_id` (audit-compliance fix). See `rpc-readback-vm-patch.md` for the full Edge Function pattern vs SQL RPC pattern comparison. Consumer VMs preserve their existing `!data?.success` short-circuit for error envelopes AND add a belt-and-suspenders contract-violation log (`contractViolation: true`) for the narrow "success without entity" case.

Total RPCs using Pattern A v2: **20 single-event + 1 multi-event (`update_role`)** = 21 definitions across 20 RPCs (one RPC has two overloads). Plus 1 Edge Function operation (`manage-user`'s `update_notification_preferences`, v11+). All race-safe on captured event_id.

### Frontend envelope types — user domain (Blocker 3, 2026-04-23)

Following the Option C pattern established in Phase 4b (client domain) and Blocker 2 (field settings), the user domain narrows its legacy `UserOperationResult` flat union into per-method named types extending `UserRpcEnvelope`:

| Method | Return type |
|--------|-------------|
| `inviteUser` | `InviteUserResult` (populates `invitation`) |
| `updateUser` | `UpdateUserResult` (populates `user` — Pattern A v2) |
| `addUserPhone`, `updateUserPhone` | `UserPhoneResult` (populates `phone` — Pattern A v2) |
| `updateNotificationPreferences` | `UpdateNotificationPreferencesResult` (populates `notificationPreferences` — Edge Function path) |
| `addUserAddress`, `updateUserAddress`, `removeUserAddress` | `UserVoidResult` (PR B TODO — address backend not yet implemented) |
| 12 other methods | `UserVoidResult` (base envelope, no entity) |

Full mapping + consumer usage in [rpc-readback-vm-patch.md](../../frontend/patterns/rpc-readback-vm-patch.md).

## Alternatives considered

### Pattern B — `RAISE EXCEPTION ... USING ERRCODE = 'P9003'/'P9004'`

The original parked-feature plan proposed this. Rejected because RAISE EXCEPTION at the RPC layer rolls back the `domain_events` audit row that the BEFORE INSERT trigger just persisted with `processing_error`, destroying diagnostic evidence (see Decision 2 rationale). PostgREST returns non-2xx with `{message, code, details, hint}` — a different shape than the existing `{success, error}` envelope, requiring a parallel parser in every frontend service. Net loss of audit trail + consumer churn.

### Client-side polling

ViewModels could re-query `domain_events` after every save to check for `processing_error`. Rejected because every new ViewModel would have to re-implement the recheck pattern correctly, and a missed implementation would re-introduce the silent-failure bug. Centralizing at the RPC layer means consumers get a uniform `success` flag.

### Extracting the dual-check into a PL/pgSQL helper

Each Pattern A v2 RPC repeats ~5 lines of boilerplate for the IF NOT FOUND fallback + post-emit `processing_error` check — ~100 lines of duplication across 20 function definitions. PR #30 review (N1) asked whether a helper could eliminate this. Rejected: PL/pgSQL is single-frame — a helper's `RETURN` returns from the helper, not from the caller, so the helper cannot "early-return" the error envelope on the caller's behalf. Possible shapes: (a) helper returns `text` (the `processing_error`), caller still writes the `IF ... THEN RETURN jsonb_build_object(...); END IF;` block — eliminates one `SELECT ... INTO ...` but not the conditional return; (b) a code generator that reads a YAML manifest of RPC metadata and emits the SQL — higher upfront cost than the 20-RPC duplication warrants; (c) accept the duplication as pattern enforcement — each RPC is self-contained and auditable without jumping to a helper definition. Chose (c); if a 21st RPC is added, revisit with (b).

## Pattern A v1 → v2 (Resolved 2026-04-23)

The original Pattern A (now called v1) used `IF NOT FOUND` alone as the failure-detection signal. **Surfaced gap**: `IF NOT FOUND` only catches the case where the projection row is COMPLETELY MISSING. For UPDATE-only handlers — which is the majority — the projection row pre-exists (created by a separate `add_*` / `register_*` RPC). If the handler raises mid-update (NOT NULL violation, type mismatch, RLS denial, NULL deref, missing handler), the dispatcher trigger persists `processing_error` but the projection row remains visible (just stale or partially-updated). The IF NOT FOUND check does NOT fire. The RPC returns `{success: true, <entity>: <stale row>}` — exactly the silent-failure shape Pattern A was meant to eliminate.

This was concretely demonstrated when implementing `api.update_user`: `handle_user_profile_updated` was referenced in the router CASE since 2026-02-17 but had never been created (separate fix in commit `461b4929`). Every call set `processing_error`, but the `users` row pre-existed from signup. Without the handler fix, the v1 IF NOT FOUND check would have returned `{success: true, user: <unchanged row>}`.

**Software-architect-dbc** follow-up review (2026-04-23, agent ID `a26d286c3c12db3d5`) confirmed the gap and recommended Pattern A v2.

### Pattern A v2 — capture event_id + race-safe post-emit check

Two additions to v1:

1. **Capture the emitted event's UUID** by changing `PERFORM api.emit_domain_event(...)` to `v_event_id := api.emit_domain_event(...)`. `api.emit_domain_event(...) RETURNS uuid` already — no signature change required.

2. **After the existing IF NOT FOUND block, add a race-safe post-emit `processing_error` check on the captured event_id**:

```sql
v_event_id := api.emit_domain_event(...);  -- v2: capture instead of PERFORM

SELECT * INTO v_row FROM <projection> WHERE id = <key>;
IF NOT FOUND THEN
    -- v1 IF NOT FOUND branch (defense in depth — catches genuinely-missing-row cases)
    SELECT processing_error INTO v_processing_error
    FROM domain_events WHERE id = v_event_id;
    RETURN jsonb_build_object('success', false,
        'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
END IF;

-- v2 race-safe check — catches handler-raised-mid-update on existing row
SELECT processing_error INTO v_processing_error
FROM domain_events WHERE id = v_event_id;
IF v_processing_error IS NOT NULL THEN
    RETURN jsonb_build_object('success', false,
        'error', 'Event processing failed: ' || v_processing_error);
END IF;

RETURN jsonb_build_object('success', true, ...);
```

**Race safety**: `WHERE id = v_event_id` is an indexed PK lookup against the exact row this RPC just emitted. Immune to concurrent emits on the same stream by other sessions. The previous v1 IF NOT FOUND fallback's `ORDER BY created_at DESC LIMIT 1` could find a sibling event's `processing_error` — v2 fixes that.

**Defense in depth**: Both checks coexist. The IF NOT FOUND check catches the rare case where the row is genuinely missing (e.g., RLS-denied projection write that left no row at all). The v2 check catches the common case (handler raised on existing row). Both pass = success.

**`api.update_role`** is intentionally NOT retrofitted to v2 — its existing 5-second-window multi-event check is the appropriate COMPLEX-CASE pattern for its multi-emit semantics (1 role.updated + N role.permission.granted + M role.permission.revoked).

**Migration**: `20260423065747_api_rpc_readback_v2_event_id_check.sql` (applied 2026-04-23) retrofits all 19 single-event RPCs (10 from migration `20260423060052` + 9 pre-existing DONE entries; one of those has 2 overloads = 20 function definitions total) in lockstep.

## Consequences

### Schema & Functions
- 18 `api.update_*` / `api.change_*` RPCs follow Pattern A
- Migration headers reference this ADR (3 migrations: `20260422052825`, `20260423032200`, `20260423060052`)
- New handler `public.handle_user_profile_updated` (closes a 5-month-old gap surfaced by the generalization)

### Frontend
- Service-layer envelope contract `{success, error?, <entity>?}` is uniform across 18 RPCs
- One BREAKING change in `SupabaseDirectCareSettingsService.updateSettings()` (legacy raw-jsonb shape → envelope shape) — handled with backward-compat fallback in the consumer

### Frontend Envelope Types (Phase 4b — 2026-04-23)

The initial PR shipped a `ClientRpcResult` union-of-all-fields type (6 optional entity fields + 7 optional id fields). PR #30 review (finding m4) flagged this as not type-safe: consumers had to know by convention which RPC populates which field. Phase 4b refactored into **separate named types per RPC**, all extending a shared `ClientRpcEnvelope` base — architect-reviewed (software-architect-dbc agent `ad2e78383cd378c9f`) after comparing Option A (generic `<T>`), Option B (single discriminated union), Option C (separate named types). Option C chosen because it maps 1:1 to the flat wire format with zero service-layer adaptation and matches the project's one-concrete-type-per-concern convention (`EffectivePermission`, `JWTPayload`).

**Contract** (in `frontend/src/types/client.types.ts`):

```typescript
export interface ClientRpcEnvelope { success: boolean; error?: string }

export interface ClientUpdateResult     extends ClientRpcEnvelope { client_id?: string;         client?: ClientProjectionRow }
export interface ClientPhoneResult      extends ClientRpcEnvelope { phone_id?: string;          phone?: ClientPhone }
export interface ClientEmailResult      extends ClientRpcEnvelope { email_id?: string;          email?: ClientEmail }
export interface ClientAddressResult    extends ClientRpcEnvelope { address_id?: string;        address?: ClientAddress }
export interface ClientInsuranceResult  extends ClientRpcEnvelope { policy_id?: string;         policy?: ClientInsurancePolicy }
export interface ClientFundingResult    extends ClientRpcEnvelope { funding_source_id?: string; funding_source?: ClientFundingSource }
export interface ClientPlacementResult  extends ClientRpcEnvelope { placement_id?: string }
export interface ClientAssignmentResult extends ClientRpcEnvelope { assignment_id?: string }
export type      ClientVoidResult       = ClientRpcEnvelope;   // remove_* RPCs
```

**Method → return type mapping** (enforced in `IClientService.ts`):

| Method | Return type |
|--------|-------------|
| `registerClient`, `updateClient`, `admitClient`, `dischargeClient` | `ClientUpdateResult` |
| `addClientPhone`, `updateClientPhone` | `ClientPhoneResult` |
| `addClientEmail`, `updateClientEmail` | `ClientEmailResult` |
| `addClientAddress`, `updateClientAddress` | `ClientAddressResult` |
| `addClientInsurance`, `updateClientInsurance` | `ClientInsuranceResult` |
| `addClientFundingSource`, `updateClientFundingSource` | `ClientFundingResult` |
| `changeClientPlacement`, `endClientPlacement` | `ClientPlacementResult` |
| `assignClientContact`, `unassignClientContact` | `ClientAssignmentResult` |
| `removeClient*` (all 5 remove operations) | `ClientVoidResult` |

**Impact**: Consumers accessing e.g. `result.phone_id` on a `ClientEmailResult` get a compile error — the point of the refactor. The legacy `ClientRpcResult` union was deleted after grep confirmed zero external references.

The same pattern should be applied to `RpcResult` in `frontend/src/types/client-field-settings.types.ts` (same anti-pattern with 6 optional fields); tracked as a separate follow-up task.

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
- [adr-edge-function-vs-sql-rpc.md](./adr-edge-function-vs-sql-rpc.md) — When to choose SQL RPC vs Edge Function; Decision 5 of that ADR references the Pattern A v2 contract codified here
- [infrastructure/supabase/CLAUDE.md](../../../infrastructure/supabase/CLAUDE.md) — "RPC functions that read back from projections MUST check for NOT FOUND" guard rail predates this ADR; cross-referenced in that section
- [frontend/src/services/CLAUDE.md](../../../frontend/src/services/CLAUDE.md) — Frontend service envelope contract that this ADR's response shape conforms to
