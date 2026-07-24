---
status: seed
last_updated: 2026-07-24
---

# Seed: Fix the 30 failing VM test suites red on `main`

**Origin**: surfaced during the PR #95 review (`@software-architect-dbc`, 2026-07-23). **Pre-existing on `main`** — NOT caused by the command-feedback epic (#91–#95); verified by the reviewer as byte-identical to `origin/main` and reproducing with the epic changes stashed. Priority: **the test suite is not green on `main`**, which undercuts the merge gate and masks future regressions. `gh pr checks` reports **no CI checks** on these branches, so nothing automated is catching this today.

## Symptoms (as of 2026-07-24)
- `frontend/src/viewModels/organization/__tests__/InvitationAcceptanceViewModel.test.ts` → **26 failed / 2 passed** (28).
- `frontend/src/viewModels/organization/__tests__/OrganizationFormViewModel.test.ts` → **4 failed / 24 passed** (28).
- Total **30 failing**. Both suites live under `viewModels/organization/__tests__/`.
- Reviewer's read: looks like **test-harness async/mock-wiring drift**, not a product regression — e.g. a `deleteDraft` spy asserted called-once but called **0 times**, and `isSubmitting` timing assertions. The product code (`OrganizationFormViewModel.ts`, `viewModels/invitation/`) is unchanged vs `main`.

## Reproduce
```bash
cd frontend
npx vitest run src/viewModels/organization/__tests__/InvitationAcceptanceViewModel.test.ts \
               src/viewModels/organization/__tests__/OrganizationFormViewModel.test.ts
```

## Investigation plan
1. `git log` the two test files + their VMs — find the commit where they went red (bisect if not obvious). Likely a mock/service-factory or async-timing change the tests weren't updated for (the VMs themselves are stable).
2. For `OrganizationFormViewModel` (only 4/28 fail): isolate the 4 — probably a shared `beforeEach` mock or a `deleteDraft`/`isSubmitting` lifecycle assumption that drifted (note: the command-feedback work touched `OrganizationFormViewModel.submissionError` semantics in #91/#95 — confirm the tests' expectations match the current submit/clear contract).
3. For `InvitationAcceptanceViewModel` (26/28 fail): a near-total failure usually means a broken top-level mock/import or a changed constructor/DI signature — check the mock service wiring first.
4. Fix the tests (or the VM if a real contract bug is found — don't paper over a genuine regression), get both suites green.
5. **Once green, add CI enforcement** so `main` can't go red again silently (the root cause here is no gate).

## Scope note
Test-only remediation expected; escalate to a product fix only if a real contract bug is found. Independent of the command-feedback epic. → related: [[command-feedback-review-lessons]]
