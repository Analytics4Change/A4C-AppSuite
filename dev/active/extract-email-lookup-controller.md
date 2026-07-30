---
status: seed
last_updated: 2026-07-30
---

# Seed: extract an `EmailLookupController` out of `UserFormViewModel`

**Origin**: `software-architect-dbc` review of PR #105, finding F17 (INFO — explicitly
"seed it; don't do it here").

**Priority**: Low. Pure structure; no behaviour change.

## Problem

`UserFormViewModel.ts` is ~1370 lines against `frontend/CLAUDE.md`
§Code Organization's ~300-line guidance, and now holds **three** concerns:

1. form state + validation
2. submit orchestration
3. the email-lookup state machine

The overrun is pre-existing and PR #105's additions are cohesive with what was
already there — which is why the review did not block. But the lookup is the
cleanest seam in the file.

## Proposed

An `EmailLookupController`, owned by the form VM, carrying:

- `emailLookupResult`, `isCheckingEmail`
- `inFlightFor`, `lastLookedUpEmail`, `prefilledNameFromLookup`
- `lookupKey`, the value-keyed staleness guard, the repeat-blur memo
- `checkEmailStatus(queryService)`, `clearEmailLookup`, `revertLookupPrefilledNames`

`UserFormViewModel` keeps `canSubmit` / `suggestedAction` / `submit()` and delegates.

**This is NOT the §S2 anti-pattern.** §S2 forbids extracting a one-caller hook
*purely to reach a test seam*. This is a cohesive state machine with five fields and
its own invariants, the tests would still target a VM-side object directly, and no
production path is rerouted around a canonical VM method.

## Watch out for

- The prefilled-name revert writes `formData.firstName`/`lastName`, so the controller
  needs a reference back to the form data — that coupling is the main design question
  and is the reason this isn't trivial.
- `canSubmit` reads `isCheckingEmail` and `emailLookupResult`, so the delegation must
  stay observable (MobX) or the Send button stops reacting.
- If `dev/active/normalize-email-at-the-source.md` lands first, `lookupKey` may
  disappear entirely rather than move — normalizing at the write path removes the
  reason for a client-side key.
- Depending on the outcome of the RPC-widening follow-up, `prefilledNameFromLookup`
  and the revert may be **deleted** rather than moved — the deployed service returns
  `firstName: null` on every branch today. Check that before extracting.

## Verification

Behaviour-preserving refactor: the 31 VM + 30 component tests must pass unchanged,
and `npm run typecheck && lint && test && build` clean. If any test needs editing,
the refactor changed behaviour — stop and re-examine.
