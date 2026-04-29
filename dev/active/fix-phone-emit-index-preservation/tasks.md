# Tasks — Fix phone emit index preservation

## Current Status

**Phase**: F3 amendment in flight — pending PR re-review + CI green
**Status**: 🟢 ACTIVE
**Priority**: Medium

## Tasks

- [x] Card filed (2026-04-29) — origin: PR #41 architect review Issue 2
- [x] Phase 0 — Read `handle_user_phone_added`; confirmed Resolution A (sentinel) is safe
- [x] Phase 0b — Architect review #1 (software-architect-dbc) — APPROVE WITH CHANGES, all 5 CRs incorporated
- [x] Phase 1 — Implement sentinel on phone emit failure; update helper to handle null slots
- [x] Phase 2 — Update auto-select fallback to filter null slots
- [x] Phase 3 — Decided NO new failure event (per Q2 architectural finding)
- [x] Phase 4 — Add Deno unit tests (per-Edge-Function pattern established); 9 cases
- [x] Phase 5 — Skipped per plan (tests verify logic; PR #41 smoke covered the happy path)
- [x] Phase 6 — Open PR #42, deploy v20, watch CI
- [x] Phase 7 — Architect review #2 (PR #42 comment) — verified 5 CRs PASS; identified F3 (HIGH severity, unclosed same-class variant)
- [x] Phase 8 — Architect review #3 — empirical F3 verification; Option A + amend PR #42 + F6 + hardening recommended; all triage decisions made
- [x] Phase 9 — Apply F3 fix: drop frontend filter at `UsersManagePage.tsx:845`; add invariant comment
- [x] Phase 10 — Update `accept-invitation/index.ts` docblock + line-822 hardening + DEPLOY_VERSION v21
- [x] Phase 11 — Add F6 boundary test
- [x] Phase 12 — Pre-push verification (typecheck, lint, deno tests)
- [ ] Phase 13 — Deploy v21 to dev, source-verify
- [ ] Phase 14 — Commit + force-push-with-lease + update PR description
- [ ] Phase 15 — Manual UI smoke (F3 scenario) post-deploy
- [ ] Phase 16 — Watch CI, await re-review
- [ ] Phase 17 — Post-merge: archive card to `dev/archived/`, update MEMORY.md

## Cross-references

- Origin: PR #41 architect review Issue 2 (`software-architect-dbc` adjudication "Issue 2 Risk Re-check")
- Authoritative plan: `~/.claude/plans/does-phase-0-warrant-humble-whale.md`
- Architect F3 deliberation: `~/.claude/plans/does-phase-0-warrant-humble-whale-agent-a0358b4f0d7162ad1.md`
- Related: `dev/parked/edge-function-deno-test-harness/` (test harness; this card establishes the per-Edge-Function pattern)
- Related: `dev/archived/fix-invitation-phone-id-resolution/` (PR #41; introduced the helper)
