# Tasks — Edge Function Deno Test Harness

## Current Status

**Phase**: PARKED (2026-04-29)
**Status**: 🅿️ DEFERRED — awaiting prioritization
**Priority**: Medium

## Tasks

- [x] Card filed (2026-04-29) — surfaced by software-architect-dbc during PR #41 review
- [ ] Decide test runner (Deno.test vs @std/testing/bdd)
- [ ] Decide CI integration approach (extend existing workflow vs new workflow)
- [ ] Establish test file location convention (colocated *.test.ts vs __tests__/ dir)
- [ ] Author tests for `resolveInvitationPhonePlaceholder` (6 cases per docblock)
- [ ] Document pattern in `infrastructure/supabase/CLAUDE.md` § Edge Function testing
- [ ] Verify a future Edge Function PR can self-serve via the harness

## Cross-references

- Origin: PR #41 (`fix-invitation-phone-id-resolution`) architect review
- First-target helper: `accept-invitation/index.ts:58-163` (`resolveInvitationPhonePlaceholder`)
- CI workflow to extend: `.github/workflows/supabase-edge-functions-lint.yml`
- Convention precedent (3-case minimum): memory `edge-function-sql-rpc-backlog.md` precedents (8)-(11)
