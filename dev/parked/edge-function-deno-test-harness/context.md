# Edge Function Deno Test Harness — Context

**Type**: Tooling / test infrastructure
**Status**: 🅿️ PARKED — awaiting prioritization
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
