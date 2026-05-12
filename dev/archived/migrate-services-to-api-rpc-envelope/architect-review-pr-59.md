# Architect Review — PR #59 (PR-D Observability Backfill)

**Reviewed**: 2026-05-11
**Reviewer**: Senior Fullstack Software Architect (Claude Opus 4.7)
**Branch**: `refactor/migrate-services-observability-backfill` @ `07934af3`
**Base**: `main` @ `fab581c9`
**PR**: https://github.com/Analytics4Change/A4C-AppSuite/pull/59
**Size**: +329 / -4 across 8 files

## Verdict

**APPROVE WITH IN-PR FIXES (one optional clarifier comment)**

PR-D implements the F1 closure pattern correctly across its stated scope (14 return-contract sites + 4 services). All retrofits are gated on `env.postgrestError`, verb strings are human-meaningful, no contract changes, no anti-patterns introduced, no double-log bugs. Tests pin the boundary contract at all 4 services with verb-correctness assertions + handler-driven negative cases. Lint/typecheck/26 new tests all green.

The only nuance worth flagging is one definitional ambiguity in the PR body — the "14 return-contract envelope call sites left over from PR-B" framing implies completeness against the codebase, but there are several **additional return-contract call sites that gate `log.error` on `env.postgrestError` inline** (SupabaseUserCommandService — 5 methods) which were NOT in PR-A/B's migration wave (they pre-date it / use bespoke shapes) and are NOT silent-failure regressions like F1. They're functionally equivalent to `logIfPostgrestError` but with hand-rolled message strings. PR-D's scope is technically accurate ("F1 closure for PR-A/B regressions"), but a future janitorial pass could consolidate those sites for code-shape uniformity. That's a follow-up consideration, not a blocker.

## Architecture Review Checklist

| Item | Status | Notes |
|------|--------|-------|
| CQRS Standards | PASS | No CQRS boundary changes. All retrofits add observability inside existing command-side service methods. |
| Naming Conventions | PASS | Verbs follow `<action> <noun-phrase>` matching codebase precedent (`update role`, `delete organization unit`, etc.). Q2 verb-from-rpcName transform mirrors PR-B's `create_organization_contact` → `'create organization contact'` precedent. |
| Design Patterns | PASS | SDK-boundary helper pattern (PR #58 F1) propagated correctly. Q2 architect-revised wrapper-level verb derivation eliminates verb-drift risk that 9 per-caller strings would introduce. |
| data-testid Attributes | N/A | No UI changes. |
| AsyncAPI Event Registration | N/A | No new events. |
| Type Generation / No Anonymous Types | PASS | Test files use `vi.hoisted` factory pattern; no inline anonymous types introduced. `logIfPostgrestError` signature is declared with the `ApiEnvelope<Record<string, unknown>>` named generic. |
| Observability, Tracing & Monitoring | PASS | This IS the observability backfill. PostgREST-shape failures now emit error-level structured log at the SDK boundary across all 4 services. Handler-driven failures correctly continue to emit warn-level only (verified in 4/4 negative-case tests). Both-log coexistence pattern (error for transport plumbing + warn for service-level outcome) is independently filterable at the log aggregator. |
| Error Surfacing to UI | PASS | No contract changes. Return statements still return `{success: false, error: env.error, errorDetails: ...}` identically; UI mapping (RoleOperationResult, OrganizationUnitOperationResult) is unchanged. |

## Findings

### F1 — VERIFIED (P0, PASS) — Discrimination correctness

`logIfPostgrestError` continues to gate exclusively on `env.postgrestError`. All 14 retrofit sites call the helper immediately before the existing `log.warn(...)` and the failure return. No site has accidentally introduced an unconditional `log.error` or bypassed the discrimination. Verified by code inspection + the 4 handler-driven negative-case tests (`does NOT emit log.error on handler-driven envelope failure`) in `SupabaseOrganizationCommandService.test.ts`, `SupabaseOrganizationEntityService.test.ts`, `SupabaseOrganizationUnitService.test.ts:80`, `SupabaseRoleService.test.ts:78`.

### F2 — VERIFIED (P0, PASS) — Coverage of stated scope (14 sites)

| Service | Methods retrofitted | Count |
|---|---|---|
| SupabaseOrganizationCommandService | update / deactivate / reactivate / delete organization | 4 |
| SupabaseOrganizationUnitService | create / update / deactivate / reactivate / delete organization unit | 5 |
| SupabaseOrganizationEntityService | callEntityRpc wrapper (covers 9 callers via single insertion) | 1 (covers 9) |
| SupabaseRoleService | update / deactivate / reactivate / delete role | 4 |
| **Total** | | **14** |

All sites verified at HEAD. `SupabaseRoleService.createRole` correctly skipped per the existing `[DIAG:createRole:RPC_ERROR]` instrumentation (PR #56 NT-1) which carries richer fields (`code`, `details`, `hint`) than the SDK-boundary helper would emit.

### F3 — VERIFIED (P0, PASS) — Verb-from-rpcName transform (Q2)

The architect-revised Q2 decision (derive verb from `rpcName.replace(/_/g, ' ')` inside the wrapper) is correctly implemented at `SupabaseOrganizationEntityService.ts:129`. The 9-RPC sweep test in `SupabaseOrganizationEntityService.test.ts:120-145` proves every entity-CRUD verb derives correctly (`create organization contact`, `update organization address`, etc.). The transform is structurally guaranteed by the M3 registry — the `rpcName: EnvelopeRpcs` parameter type means the static-literal name is the source of truth for both the RPC call and the verb. Zero verb-drift risk over time.

Note for memory: The Q2 verb-from-rpcName pattern is a generalizable design — for any wrapper that calls multiple registry-named RPCs, deriving the log verb from the rpcName via snake→space is a single-source-of-truth alternative to per-caller verb strings. This applies wherever a "private callXyzRpc(rpcName, params)" indirection wraps the SDK call (currently 1 site; the pattern is replicable).

### F4 — VERIFIED (P1, PASS) — Test discipline

PR-D adds +26 tests across 4 files. The test pattern is consistent across all 4 retrofitted services:

- One PostgREST-failure case per method (asserting the exact verb-prefixed message string `'Failed to <verb>'` and `{error: env.error}` payload)
- One handler-driven-failure negative case per service (asserting `mockLogError` NOT called)

`mockLogError` is hoisted via `vi.hoisted` so the mock factory runs before the module under test is imported. The `Logger.getLogger()` mock returns a fresh logger with `error: mockLogError` plus stubbed `warn/info/debug` — this is necessary because both `logIfPostgrestError` (error-level) and the existing `log.warn` fire on the same code path, and the test must not accidentally pick up the warn-level emission.

The 9-RPC sweep in `SupabaseOrganizationEntityService.test.ts` is a strong test artifact — every future RPC added to `callEntityRpc`'s 9-caller set will have its verb correctness pinned automatically without per-caller test updates (the test iterates over the wrapper's surface).

### F5 — VERIFIED (P1, PASS) — No throw-contract sites accidentally retrofitted

Audit query: `grep -n "throwIfPostgrestError\|logIfPostgrestError" frontend/src/services/**/*.ts` confirms zero double-helper sites. `SupabaseClientFieldService` (11 throw-contract sites) remains untouched with `throwIfPostgrestError`. `SupabaseClientService` lifecycle methods (PR #58) remain on `logIfPostgrestError`. No site has both helpers.

### F6 — VERIFIED (P1, PASS) — No read-contract sites accidentally retrofitted

Read-contract calls go through `apiRpc<T>` (not `apiRpcEnvelope<T>`). The PR diff touches only `apiRpcEnvelope<T>` call sites. Read-contract files (`getRoles`, `getOrganizations`, `listFieldDefinitions`, etc.) are untouched.

### F7 — VERIFIED (P1, PASS) — No anti-patterns introduced

- Zero `as` casts added (the existing `as ClientUpdateResult` casts on success paths are PR-B inheritance).
- Zero `// eslint-disable` introduced.
- Zero conditional skips of `logIfPostgrestError` on specific verbs.
- Zero duplicated log emission (the existing `log.warn` at every retrofit site is intentional and complementary, per the PR body's both-log coexistence rationale; the two emissions fire on different conditions when isolating PostgREST failures, and on the same condition when both fire — which is *desired* because warn level captures the service-level outcome while error level captures the boundary plumbing signal).

### NT-1 — INFORMATIONAL (no action required) — Inventory completeness clarifier

The PR body says PR-D "applies the F1 closure pattern to the remaining 14 return-contract envelope call sites" — verified within its stated scope. However, a sweep of the broader codebase identifies additional return-contract `apiRpcEnvelope` sites where `log.error` already fires inline gated on `env.postgrestError`:

**Inventory of return-contract sites NOT in PR-D scope** (functionally equivalent to `logIfPostgrestError` but not consolidated):

| Site | File / Line | Pattern |
|---|---|---|
| `updateUser` | `SupabaseUserCommandService.ts:574-580` | `if (env.postgrestError) { log.error('RPC error updating user', ...); return ... }` |
| `addUserPhone` | `SupabaseUserCommandService.ts:907-914` | `if (env.postgrestError) { log.error('Failed to add user phone via RPC', ...); return ... }` |
| `updateUserPhone` | `SupabaseUserCommandService.ts:1013-1020` | `if (env.postgrestError) { log.error('Failed to update user phone via RPC', ...); return ... }` |
| `removeUserPhone` | `SupabaseUserCommandService.ts:1102-1109` | `if (env.postgrestError) { log.error('Failed to remove user phone via RPC', ...); return ... }` |
| `updateNotificationPreferences` | `SupabaseUserCommandService.ts:1254-1265` | `if (env.postgrestError) { log.error('RPC error in updateNotificationPreferences', ...); return ... }` |

These are NOT silent-failure regressions like F1 — they already log error-level on PostgREST failures. They were preserved as inline code during PR-A/B because their message strings differ from the `'Failed to <verb>'` shape (`'RPC error updating user'`, `'Failed to add user phone via RPC'`, etc.).

**Why this is informational, not a finding**: PR-D's stated scope is "F1 closure regressions from PR-A/B" — these are not regressions. Consolidating them to `logIfPostgrestError` would (a) change the log message strings (potentially breaking dashboard queries that match on the literal strings), (b) exceed PR-D's scope, and (c) is a separate "code-shape uniformity" body of work.

For the migration card's "Completed Work" note: PR-D **does not** make every PostgREST failure log go through the SDK-boundary helper. It makes every PR-A/B-introduced regression go through the helper. If a future janitorial pass wants the stronger invariant (zero inline `log.error('... <verb> ...')` on PostgREST gates), it would refactor SupabaseUserCommandService + EventMonitoringService's 4 unconditional-log sites + possibly the 3 throw-contract services (SupabaseScheduleService, SupabaseAssignmentService, SupabaseDirectCareSettingsService) to use `throwIfPostgrestError`.

**Optional in-PR clarifier**: amend the PR body or commit message to scope the "14 sites" claim more precisely — "14 return-contract sites that lost their pre-migration `log.error('Failed to <verb>')` emission during the PR-A/B migrations" rather than "the remaining 14 return-contract envelope call sites." The current phrasing reads as "all return-contract sites are now centralized," which is not strictly true.

### NT-2 — INFORMATIONAL — Cross-service throw-contract consolidation opportunity

Out of scope for PR-D. Future tidy-up could migrate the throw-contract services that already use the same inline pattern to `throwIfPostgrestError`:

- `SupabaseScheduleService` (8 methods): each has `if (!env.success) { log.error('Failed to <verb>', { error }); throw new Error('Failed to <verb>: ${env.error}'); }`
- `SupabaseAssignmentService` (3 methods): same pattern
- `SupabaseDirectCareSettingsService.updateSettings`: same pattern

This is structurally identical to what `throwIfPostgrestError` already does (logs `Failed to <verb>` at error level + throws). Migrating would (a) consolidate the pattern, (b) gain the PR #58 discrimination (only PostgREST fires the error log; handler-driven flow through as throws but at info/warn level), (c) reduce ~30 LOC. Worth carding as a follow-up tidy-up *only* if the migration card stays open after PR-D merges.

## Design by Contract — Helper Invariant

`logIfPostgrestError(env, verb): void`:
- **Precondition**: `env: ApiEnvelope<Record<string, unknown>>`, `verb: string`
- **Postcondition**: emits `log.error('Failed to ${verb}', { error: env.error })` IFF `!env.success && env.postgrestError != null`. No throw. No mutation of `env`. Returns `void`.
- **Invariant**: handler-driven envelope failures (where `env.postgrestError` is undefined) NEVER trigger an error-level log. This is the PR #58 F1 contract; it survives intact in every PR-D retrofit site.

PR-D adds neither a new contract nor a new helper. It propagates the F1 contract correctly across 14 call sites and 1 wrapper. Caller contracts (return shapes, error envelopes, errorDetails mappings) are byte-equivalent before and after.

## Memory-Worthy Architectural Notes

1. **Q2 verb-from-rpcName** is a generalizable pattern for wrapper-style services. When a private wrapper takes a registry-typed `rpcName: EnvelopeRpcs | ReadRpcs` and forwards to N callers, deriving the log verb from `rpcName.replace(/_/g, ' ')` is a single-source-of-truth alternative to per-caller verb strings. Eliminates verb-drift over time. The pattern is replicable wherever an `if (!env.success)` branch wants to fire `logIfPostgrestError` from inside a generic wrapper.

2. **PR-D closes "the F1 regression class" but not the broader "centralize all PostgREST-error logs at the SDK boundary" invariant.** The card's close-out language should be precise: every PR-A/B return-contract regression is fixed. Future code-shape consolidation work (SupabaseUserCommandService inline log.error, throw-contract services using inline log.error + throw) is a separate body of work not covered by PR-D.

3. **The `both-log coexistence pattern`** (error-level for PostgREST plumbing + warn-level for envelope failure outcome) is now codified across 4 services. The two levels are independently filterable at log aggregation; no double-count risk because they fire at different levels even when both fire. This is a deliberate observability design choice worth memorializing — `env.postgrestError` failures fire BOTH error and warn (because they ARE envelope failures); handler-driven failures fire ONLY warn.

## Recommended Verdict Path

**APPROVE WITH IN-PR FIXES**: optional clarifier on the "14 sites" framing in the PR body / commit message (NT-1). No code changes required. Merge when ready.

If the author chooses not to amend the PR body, the verdict remains APPROVE — the substantive review (F1-F7) all pass; NT-1 is documentation-only.

After PR-D merges, the migration card `dev/active/migrate-services-to-api-rpc-envelope/` should be archived — the F1 regression class is closed across the codebase. Any future consolidation work (NT-1 inventory, NT-2 throw-contract sites) is a separate card.
