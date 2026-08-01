# Edge Function Deno Test Harness — Context

**Type**: Tooling / test infrastructure
**Status**: ACTIVE (un-parked 2026-07-30) — RE-SCOPED, see the note at the bottom before reading anything above
**Priority**: Medium — unblocks unit testing of pure helpers in Edge Functions
**Origin**: Recommended by `software-architect-dbc` during PR #41 review (`fix-invitation-phone-id-resolution`).

## Capability target

Establish a Deno test harness for `infrastructure/supabase/supabase/functions/` so that pure helpers extracted in Edge Function fixes can ship with unit tests instead of relying on manual UI smoke tests for verification.

## Why now (concrete trigger)

PR #41's `resolveInvitationPhonePlaceholder` is a perfectly pure function with a docblock that enumerates 6 cases. Each case maps 1:1 to a unit test. PR #41 shipped without those tests because the harness doesn't exist; the architect explicitly flagged this as "should not be optional" — track explicitly so the next Edge Function fix lands with tests.

The PR #39 precedent for SQL RPCs (precedents 8-11 in `~/.claude/projects/-home-lars-dev-A4C-AppSuite/memory/edge-function-sql-rpc-backlog.md`: "envelope-contract unit tests, minimum three cases per extraction") set a 3-case-minimum bar for RPCs. The spirit applies to Edge Function pure helpers — and PR #41's helper enumerates 6 cases that should be tests.

## Trigger to start

Start when:
- A second Edge Function fix is in flight that would benefit from test coverage on a pure helper, OR
- Someone has bandwidth to invest a half-day in tooling that pays off across all subsequent Edge Function PRs

## Out of scope

- Integration tests against a running Supabase project (different concern; the existing `infrastructure/supabase/supabase/migrations/`-style local-supabase + plpgsql_check pattern covers DB-side; this card is for Edge Function helpers only).
- Refactoring existing Edge Functions to be more testable (separate exercise).
- Mocking the Supabase admin client / fetch APIs (separate exercise; pure helpers are the highest-leverage target first).

## References

- PR #41 architect review: identifies `resolveInvitationPhonePlaceholder` as the first target.
- `~/.claude/projects/-home-lars-dev-A4C-AppSuite/memory/edge-function-sql-rpc-backlog.md` precedents (8)-(11) for the 3-case-minimum convention for envelope-contract tests.
- `infrastructure/supabase/supabase/functions/_shared/` — most-leverage targets for the harness (any future shared helper benefits from tests).
- `infrastructure/supabase/supabase/functions/accept-invitation/index.ts:58-163` — `resolveInvitationPhonePlaceholder` first-target helper.

---

## ⚠️ RE-SCOPED 2026-07-30 (user request during PR D) — the original premise is now FALSE

**The basic harness exists and has for a while.** `Deno.test` is in use across 10
suites under `functions/**/__tests__/`, and
`.github/workflows/supabase-edge-functions-test.yml` runs them on every PR that
touches `functions/**`. PR D added three more suites (120 → 133 tests) with no
tooling work at all. Phases 0–2 of `plan.md` are effectively done; do not
re-execute them.

**What is actually still missing**, in priority order:

### 1. Nothing exercises the wire (the real gap)

Every existing suite tests pure helpers against hand-rolled client stubs. Per
codified pitfall 10, *local Deno mocks cannot model the PostgREST exposed-schemas
allowlist* — which is exactly how PR #60 and PR #61 both shipped broken and only
failed in UAT.

PR D inherits the limit directly: `readProcessingError` is well covered
(fail-closed, arg shape, clean/dirty), but **no test proves
`api.get_event_processing_error` resolves over the wire** under a service_role
client. That is why probe P3 has to be run by hand against deployed dev, and why
PR E is gated on it rather than on the test suite.

Target: a harness that can run a function against a real or containerized
Supabase — `supabase functions serve` plus a seeded local DB, or a tagged
integration lane that runs against the dev project with cleanup.

### 2. `deno lint` is still not a PR gate

`supabase-edge-functions-lint.yml` only enforces the ADR-citation rule for NEW
function files. It does not run `deno lint`. Consequence observed in PR D: a
`no-unused-vars` error had been sitting in `_shared/emit-event.ts` (unused `Span`
import) undetected. Fixed inline there, but nothing stops the next one.

This overlaps `dev/active/gate-prs-on-edge-function-deno-lint.md` — that card owns
the gate; this one should stop claiming the lint gap.

### 3. Coverage of the *branching* in `index.ts`, not just extracted helpers

PR D could unit-test `findAuthUserByEmail` and `readProcessingError` because both
were extracted. The three `invite-user` read-back call sites — the actual
behaviour change — are only reachable through `serve()` and are covered by
nothing but probe P3. Either the request handler needs to be decomposed enough to
test, or item 1 has to land.

**Local note**: Deno is not installed on this machine by default. PR D installed
it to `~/.deno/bin/deno` to run the suites before pushing. Worth adding to
onboarding docs when this card is executed.
