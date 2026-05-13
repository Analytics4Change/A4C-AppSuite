# Tasks — eligibility-rpc-pgtap-coverage (parked)

**Activate this card when a trigger condition fires.** See `plan.md` § Trigger conditions.

## Activation checklist

- [ ] Confirm the activation trigger (one of the three documented conditions) actually fired
- [ ] Move card from `dev/parked/` to `dev/active/`
- [ ] Decide test harness (pg_tap / plpgunit / node-pg / Management API SQL) — see plan.md § Open questions
- [ ] Decide seed-data shape

## Implementation (once activated)

- [ ] Set up the chosen test harness (likely a new GitHub Actions workflow + a Supabase container spin-up step)
- [ ] Write the 7 test scenarios listed in plan.md § Suggested test scenarios:
  - [ ] C4a super_admin → eligible=true
  - [ ] C4b future-dated → eligible=true
  - [ ] C4b expired → eligible=true
  - [ ] C4c deactivated org → eligible=true
  - [ ] Negative: active provider role → cross_provider_invitation_blocked
  - [ ] target_not_found
  - [ ] greenfield eligible
- [ ] Verify all pass against current dev DB
- [ ] CI integration: tests run on every PR that touches `api.check_invitation_acceptance_eligibility` or `api.check_user_exists`
- [ ] Tighten wiring-test docblock in `_shared/__tests__/check-invitation-eligibility.test.ts` to reference the new SQL-level coverage

## Out of scope

- Broader investment in SQL test infrastructure (separate card if needed)
