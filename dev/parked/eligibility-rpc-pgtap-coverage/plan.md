# SQL-level regression coverage for `api.check_invitation_acceptance_eligibility`

**Status**: parked (not yet triggered)
**Priority**: Low (defensive — current behavior is correct; this card hardens regression coverage)
**Origin**: PR #64 architect review finding #4 (2026-05-13)
**Predecessor**: `dev/active/reject-cross-provider-invitations/` (PR #64; will be archived after merge)

## Trigger conditions

Activate this card when ANY of the following becomes true:

1. A similar SQL-only filter branch is added to any `api.*` RPC that the wiring-tier helper tests cannot exercise.
2. pg_tap (or any SQL test harness) is added to the project for an unrelated reason.
3. A bug is discovered in one of the C4a/b/c filter branches (super_admin / future-dated / expired / deactivated-org) that the wiring-tier tests at `infrastructure/supabase/supabase/functions/_shared/__tests__/check-invitation-eligibility.test.ts` did not catch.

If none of the above happens, this card stays parked indefinitely. The wiring-tier coverage shipped in PR #64 is adequate given the SQL branches are tightly-bounded WHERE clauses validated manually via Management API SQL smoke at deploy time.

## Purpose

Add SQL-level regression tests for the C4a/b/c filter branches in `api.check_invitation_acceptance_eligibility`:

- **C4a**: `urp.organization_id IS NOT NULL` — global super_admin rows excluded
- **C4b**: `role_valid_from IS NULL OR role_valid_from <= CURRENT_DATE` — future-dated roles excluded
- **C4b**: `role_valid_until IS NULL OR role_valid_until >= CURRENT_DATE` — expired roles excluded
- **C4c**: `op.is_active = true` — stale roles at deactivated orgs excluded

Each branch produces `eligible=true` from a different cause; PR #64's wiring tests pin EF behavior (`eligible=true` → `{ok:true}`) but do not assert that the SQL filter is actually doing the exclusion.

## Open questions for activation

1. **Test harness choice**: pg_tap vs. plpgunit vs. a node-pg integration harness vs. seed-data-driven test SQL run via Management API. Decide at activation time based on what the project's other testing infrastructure looks like at the time.
2. **Seed-data shape**: synthetic users + role assignments per branch, or use real-but-tagged fixtures? Likely the former (cleaner teardown).
3. **CI integration**: where do these tests run? Likely a new GitHub Actions workflow that spins up a Supabase container and applies all migrations before running the test suite. Reuse the existing `rpc-registry-sync.yml` container if possible.

## Suggested test scenarios

For each C4a/b/c branch, seed data such that the eligibility check sees the relevant row state, then assert the RPC returns `{eligible: true}` (because the filter excluded the row from consideration):

1. **C4a — super_admin**: invitee has `user_roles_projection` row with `organization_id IS NULL`. Assert eligible=true.
2. **C4b — future-dated**: invitee has role with `role_valid_from = CURRENT_DATE + 1`. Assert eligible=true.
3. **C4b — expired**: invitee has role with `role_valid_until = CURRENT_DATE - 1`. Assert eligible=true.
4. **C4c — deactivated org**: invitee has role at an org with `is_active = false`. Assert eligible=true.
5. **Negative**: invitee has an ACTIVE role at a DIFFERENT type='provider' org. Assert eligible=false with `error='cross_provider_invitation_blocked'`.

Plus the existing branches already covered by wiring tests:
6. **target_not_found**: target_org_id doesn't exist.
7. **eligible (greenfield)**: invitee has no `user_roles_projection` rows.

## Files involved (at activation)

- `infrastructure/supabase/supabase/migrations/20260513213831_pr64_closeout.sql` — the RPC body being tested
- New SQL test file (location TBD: `infrastructure/supabase/tests/rpc/`? `infrastructure/supabase/supabase/tests/`?)
- New CI workflow (or extension of `rpc-registry-sync.yml`)

## Out of scope for this card

- Re-architecting how SQL tests run more broadly. This card is narrowly about `check_invitation_acceptance_eligibility`. If the activation triggers a broader investment in SQL test infrastructure, that's a separate card.

## Related cards / PRs

- `dev/active/reject-cross-provider-invitations/` — predecessor; will be archived after PR #64 merge
- PR #64 (`feat/reject-cross-provider-invitations`) — closeout finding #4 seeded this card
