---
status: in-progress
last_updated: 2026-07-27
---

# Seed: Surface the transport correlation-id into read-path failure logs (app-wide)

> **PR #94 landed the mechanism + the Users read paths. A follow-up PR (`feat/read-path-correlation-id-rollout`, 2026-07-27) extended it to roles, organizations, org-units, and client-fields.** `supabaseService.apiRpc(fn, params, { correlationId })` pins the caller's id as `X-Correlation-ID` (via the confirmed `PostgrestBuilder.setHeader`, postgrest-js 2.88), overriding `tracingFetch`'s auto-gen. Each read VM generates one id per load op (client-fields REUSES its session id — load→edit→save is one audit trail), threads it through the query interface/impl/mock, and logs it on failure. Tests: `Supabase{User,Role,OrganizationQuery,OrganizationUnit,ClientField}Service.correlation.test.ts`. The `apiRpc(..., { correlationId })` idiom + selection rule (fresh-per-read vs reuse-session-id) + the envelope exception are documented in `frontend/src/services/CLAUDE.md` §4.
>
> **REMAINING (envelope reads — separate follow-up):** `apiRpcEnvelope` does NOT yet forward the header, so these envelope-shape reads are still un-pinned: **schedules** (`list_schedule_templates`/`get_schedule_template`), **`get_organization_details`**, and the client-field usage-count reads (`get_field_usage_count`/`get_category_field_count`). Extending `apiRpcEnvelope` with the same `setHeader` treatment is its own spike — it's ALSO the write-path helper, so touch carefully. Do NOT bolt the envelope change onto a read-path PR.

**Origin**: PR #94 review (`@software-architect-dbc`) — elevating the "correlation-id is a nit" finding. User goal: **end-to-end server traceability** from a frontend read failure. Applies to **all read-path sites**, not just Users (correlation-id is an epic-wide documented standard).

## The actual state (verified 2026-07-22)
- **Transport already carries a correlation id on every read.** `tracingFetch` (`frontend/src/lib/supabase-ssr.ts:94-121`) injects `X-Correlation-ID` + `traceparent` on **every** Supabase request (reads included). The PostgREST pre-request hook maps `X-Correlation-ID` → `app.correlation_id`; `emit_domain_event` persists it. See `documentation/infrastructure/guides/event-observability.md` (§"Automatic tracing", added 2026-02-07) and `frontend/src/services/CLAUDE.md` §4.
- **The gap is frontend-only:** the id is auto-generated *inside* `tracingFetch` and never returned, so VM read-failure logs can't print the id that hit the wire. Example sites: `UsersViewModel.ts:444` (`loadUsers`), `:509`/`:515` (`loadUserDetails` warn/exception). They `log.warn`/`log.error` the raw error but **without** a correlation id — unlike the command path (`useCommandFeedback` logs `{ raw, correlationId }`).

## Proposed (own PR, NOT bolted onto a leaf fix)
1. **Chokepoint = `supabaseService.apiRpc` / `apiRpcEnvelope`** (`frontend/src/services/auth/supabase.service.ts:121/162`) — the SDK boundary every query service uses. Generate the correlation id there (or accept a caller-supplied one), force it as the `X-Correlation-ID` header for that call (so it's the id the server logs, not the auto-generated one), and **return it** alongside `{data, error}`.
2. **Thread it up**: read VMs log the returned `correlationId` on every failure. Start with `UsersViewModel` (the 3 sites above), then the other read VMs (roles, orgs, org-units, schedules, client-fields) since it's an epic-wide standard.
3. **Mock parity**: `MockUserQueryService` (+ sibling mocks) return a correlationId.

## ⚠️ Mechanism risk to spike FIRST
supabase-js/postgrest-js **2.88.0** exposes no clean **per-call** header API — `.schema('api').rpc(fn, params)` has no obvious `setHeader`. Options to verify:
- a per-call `setHeader` on the builder (confirm it exists in 2.88 before relying on it);
- a per-call request context (e.g. module-scoped/AsyncLocalStorage-style var) that `tracingFetch` reads instead of auto-generating;
- capturing the auto-generated id back out of `tracingFetch` (response-side) and returning it.
Do NOT ship a version-fragile header hack; pick the mechanism the spike proves robust.

## Verification
- Force a read failure; confirm the VM log line's `correlationId` == the `app.correlation_id` on the server event (`SELECT ... FROM domain_events WHERE correlation_id = '<id>'`).
- `tsc`/`eslint`/`build`/tests green; mock + real service parity.

## Scope note
Bigger than PR #94 (which correctly shipped only the Users load-path *sanitization* + the `users-error-banner-message` testid). This is app-wide observability infra on a HIPAA-sensitive boundary — own PR, own review. → related: [[command-feedback-review-lessons]]
