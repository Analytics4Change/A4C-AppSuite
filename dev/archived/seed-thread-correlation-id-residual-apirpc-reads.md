---
status: seed
last_updated: 2026-07-27
---

# Seed: Thread correlation-id through the residual un-threaded `apiRpc` reads

**Origin**: close-out spot-check after PR #99 (`software-architect-dbc` caveat: "epic fully closed" assumed #94/#98 threaded EVERY `apiRpc` read). The spot-check found otherwise — a small residual pocket of `apiRpc` reads still call `apiRpc<T>(fn, params)` with **no** `{ correlationId }` 3rd arg, so their read-failure logs don't join the server trace. Priority: **LOW** (admin/low-traffic surfaces).

## The un-threaded reads (verified 2026-07-27 on `main` @ `8d66bf00`)

**Schedule management** (`src/services/schedule/SupabaseScheduleService.ts`):
- `listUsersForScheduleManagement` (RPC `list_users_for_schedule_management`, ~:275) — failure log `:286` `{ error }`. Has a VM caller in the schedule user-assignment flow (map it during planning).

**Admin failed-events monitoring** (`src/services/admin/EventMonitoringService.ts`):
- `getFailedEvents` (`get_failed_events`, ~:139)
- `getProcessingStats` (`get_event_processing_stats`, ~:459)
- `getEventsBySession` (`get_events_by_session`, ~:609)
- `getTraceTimeline` (`get_trace_timeline`, ~:781)

**Exclude / decide:** `EventMonitoringService.getEventsByCorrelation` (~:687) already takes a `correlationId` param, but there it is a **search filter** (`p_correlation_id` in the RPC body — "find events matching this id"), NOT a pinned outbound header. Threading a *transport* `X-Correlation-ID` there is optional and semantically distinct — decide during planning whether the dashboard's own request should also carry a fresh trace id.

## Why these were missed

They're `apiRpc` reads outside the four domains #98 swept (users/roles/orgs/org-units/client-fields) and the five services #99 swept (clients/org-details/schedule-templates/client-fields-counts/assignments). Schedule *templates* were threaded in #99, but `listUsersForScheduleManagement` (a different read on the same service) was not; the admin `EventMonitoring` reads were never in scope.

## Proposed

Mirror the shipped `apiRpc` read-path pattern (PR #98): add an optional trailing `correlationId?` to each read (interface → Supabase impl → mock), pass `{ correlationId }` as the 3rd `apiRpc` arg, and have each VM/component caller mint a fresh `generateCorrelationId()` per load and log `{ error, correlationId }` on failure. Mechanism is already in place (`apiRpc` accepts `{ correlationId }`) — this is pure threading. Add per-service `*.correlation.test.ts` mirroring the existing ones.

## Definition of "whole epic closed"

Once this lands, BOTH SDK read helpers (`apiRpc` + `apiRpcEnvelope`) pin the caller's id across **every** read path, and the read-path correlation-id epic is genuinely complete. → related: [[pr-98-close-out]], and the archived parent `surface-transport-correlation-id-into-read-path-logs.md`.
