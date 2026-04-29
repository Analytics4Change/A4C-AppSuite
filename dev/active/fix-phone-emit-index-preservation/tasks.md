# Tasks — Fix phone emit index preservation

## Current Status

**Phase**: 0 — pending prioritization
**Status**: 🟢 ACTIVE
**Priority**: Medium

## Tasks

- [x] Card filed (2026-04-29) — origin: PR #41 architect review Issue 2
- [ ] Phase 0 — Read `handle_user_phone_added` to confirm Resolution A doesn't break consumers
- [ ] Phase 1 — Implement sentinel on phone emit failure; update helper to handle null slots
- [ ] Phase 2 — Update auto-select fallback to filter null slots
- [ ] Phase 3 — Decide on `user.phone.add_failed` event emission (optional)
- [ ] Phase 4 — Add Deno unit tests (depends on `dev/parked/edge-function-deno-test-harness/`)
- [ ] Phase 5 — Smoke test or fault injection
- [ ] Phase 6 — Open PR + verify CI green

## Cross-references

- Origin: PR #41 architect review Issue 2 (`software-architect-dbc` adjudication "Issue 2 Risk Re-check")
- Related: `dev/parked/edge-function-deno-test-harness/` (test harness; soft dependency for Phase 4)
- Related: `dev/active/fix-invitation-phone-id-resolution/` (PR #41; introduced the helper that this card extends)
