# Tasks — Fix phone emit index preservation

## Current Status

**Phase**: Implementation complete — pending PR open + CI green
**Status**: 🟢 ACTIVE
**Priority**: Medium

## Tasks

- [x] Card filed (2026-04-29) — origin: PR #41 architect review Issue 2
- [x] Phase 0 — Read `handle_user_phone_added`; confirmed Resolution A (sentinel) is safe
- [x] Phase 0b — Architect review (software-architect-dbc) — APPROVE WITH CHANGES, all 5 CRs incorporated
- [x] Phase 1 — Implement sentinel on phone emit failure; update helper to handle null slots
- [x] Phase 2 — Update auto-select fallback to filter null slots
- [x] Phase 3 — Decided NO (per Q2 architectural finding — sub-entity flows use `console.error`, not failure events)
- [x] Phase 4 — Add Deno unit tests (per-Edge-Function pattern established); 9 cases passing
- [x] Phase 5 — Skipped per plan (tests verify logic; PR #41 smoke covered the happy path)
- [ ] Phase 6 — Manual deploy to dev, source-verify v20, commit + push + open PR + watch CI

## Cross-references

- Origin: PR #41 architect review Issue 2 (`software-architect-dbc` adjudication "Issue 2 Risk Re-check")
- Authoritative plan: `/home/lars/.claude/plans/does-phase-0-warrant-humble-whale.md`
- Related: `dev/parked/edge-function-deno-test-harness/` (test harness; this card establishes the per-Edge-Function pattern, partially de-scoping that parked card)
- Related: `dev/archived/fix-invitation-phone-id-resolution/` (PR #41; introduced the helper that this card extends)
