# Frontend Test Stabilization — Seed Findings

## Source

Categorized during PR #51 UAT (2026-05-06), after architect review surfaced "main has 39 failed test files / 56 failed tests." Verified pre-existing on `origin/main` via temporary worktree run — identical numbers, zero regression introduced by PR #51.

This seed extends the testing-related note in [`codify-frontend-feedback-and-testing-standards-seed.md`](./codify-frontend-feedback-and-testing-standards-seed.md) §S2 line 58, which flagged that `useFocusAdvancement.test.tsx` and `useKeyboardNavigation.test.tsx` were "collectible but 13 of 28 cases still fail — separate concern, not blocked by this codification." That separate concern is now broader and characterized below.

---

## TL;DR — 6 root causes, ~3-5 hours

The "39 failed test files" headline is misleading. **34 of those 39 are Playwright spec files vitest is collecting by mistake** (each shows `(0 test)`). Real test failures are concentrated in **5 files / 56 tests / 4 likely root causes**.

| # | Category | Files | Failures | Root Cause Hypothesis | Effort |
|---|---|---|---|---|---|
| 1 | **Vitest collecting Playwright specs** | 34 | 0 real | `vitest.config` `include` glob picks up `e2e/**` and `tests/**` — each shows "(0 test)" because vitest can't run them | **~5 min** |
| 2 | `InvitationAcceptanceViewModel.test.ts` | 1 | 26 | All assertions are `expected undefined to be null/true/false` — ViewModel constructor isn't initializing observables. **One root cause likely fixes all 26.** | 1-2h |
| 3 | `OrganizationFormViewModel.test.ts` | 1 | 4 | Same shape (`expected undefined to be …`) — high probability of being the same root cause as #2 | 0-1h (often free with #2) |
| 4 | `useKeyboardNavigation.test.tsx` | 1 | 7 | `target?.closest is not a function` — `Document` is truthy but lacks `.closest()`; needs `target instanceof Element` guard | 30m-1h |
| 5 | `useFocusAdvancement.test.tsx` | 1 | 6 | Mock spy assertions fail (`expected "focus" to be called at least once`) — likely similar Element-vs-Document target issue or fake-timer mismatch | 1-2h |
| 6 | `scripts/__tests__/logger.test.ts` | 1 | 13 | Asserts on captured log buffers: `expected [] to have a length of 1`. The `scripts/` logger has a separate implementation from `src/utils/logger.ts` (which passes 13/13). Buffer-capture path drifted. | 1-2h |

**Realistic total: ~3-5 hours** if #2/#3 share a fix and #4/#5 share a fix. Worst case: ~7 hours if each is independent.

---

## #1 — Vitest collecting Playwright specs (5-min fix)

```ts
// vitest.config.ts (or vite.config.ts test section)
export default defineConfig({
  test: {
    exclude: [
      'node_modules/**',
      'e2e/**',           // Playwright specs — wrong runner
      'tests/**',         // Playwright specs — wrong runner
      // ... existing
    ],
  },
});
```

Verification after the change:
```bash
cd frontend && npm test -- --run
# Test Files: should drop from 39/20 (59) to 5/20 (25)
```

The 34 Playwright spec files involved (verified during categorization):

```
e2e/autocomplete-enter-behavior.spec.ts
e2e/category-selection-debug.spec.ts
e2e/category-selection-diagnostics.spec.ts
e2e/category-selection-direct.spec.ts
e2e/category-selection-final.spec.ts
e2e/category-selection-keyboard-navigation.spec.ts
e2e/category-selection-keyboard-simplified.spec.ts
e2e/check-dosage-fields.spec.ts
e2e/check-page.spec.ts
e2e/client-field-settings.spec.ts
e2e/client-intake.spec.ts
e2e/focus-diagnosis.spec.ts
e2e/focus-trap-comparison.spec.ts
e2e/medication-entry.spec.ts
e2e/medication-lorazepam-test.spec.ts
e2e/mobx-debug.spec.ts
e2e/multi-select-dropdown.spec.ts
e2e/organization-manage-page.spec.ts
e2e/organization-unit-crud.spec.ts
e2e/role-management.spec.ts
e2e/searchable-dropdown-debug.spec.ts
e2e/searchable-dropdown-issues.spec.ts
e2e/searchable-dropdown-pra-test.spec.ts
e2e/searchable-dropdown-proper-flow.spec.ts
e2e/searchable-dropdown-working.spec.ts
e2e/space-key-fix-verification.spec.ts
e2e/space-key-verification-final.spec.ts
e2e/test-isolated-context.spec.ts
e2e/test-medication-flow.spec.ts
e2e/verify-medication-tab-order.spec.ts
tests/focus-intent-pattern.spec.ts
tests/invitation-acceptance.spec.ts
tests/organization-creation.spec.ts
```

Note: there's a **separate dual-directory smell** here — Playwright specs live in BOTH `e2e/` and `tests/` with no obvious split rationale. Memory documents that the project's Playwright `testDir` is `./e2e` while a few specs sit in `./tests/` and aren't on the gated path today. Worth investigating as a side concern, but not blocking the vitest exclude fix.

---

## #2 — InvitationAcceptanceViewModel (26 failures, biggest cluster)

**Symptom**: Every test starts with `expected undefined to be null` / `to be false` / `to be true`. Examples:

```
InvitationAcceptanceViewModel > Initialization > should initialize with null invitation data
  → expected undefined to be null

InvitationAcceptanceViewModel > Initialization > should not be loading initially
  → expected undefined to be false // Object.is equality

InvitationAcceptanceViewModel > Token Validation > should validate a valid token
  → expected "spy" to be called with arguments: [ 'valid-token-123' ]
  Received:
```

**Hypothesis**: The ViewModel's observable getters return `undefined` instead of their declared initial values. Most likely cause:

- A recent MobX upgrade dropped a decorator transform (e.g., `@observable` getter not running), OR
- An `@observable` annotation got moved to a constructor field assignment that runs after the test reads it, OR
- The mock factory for the ViewModel skips the constructor entirely (jest.mock without `actual` import).

**Fix scope**: Single-file fix to either the ViewModel itself, its mock factory, or the test setup. **One change likely flips all 26 tests green at once**, so this is a high-leverage entry point.

**Investigation steps**:
1. Read `src/viewModels/organization/InvitationAcceptanceViewModel.ts` — identify how observables are declared (constructor assign vs class field vs `makeObservable`/`makeAutoObservable`).
2. Read the test file — check imports, mocks, and whether it's instantiating directly or through a factory.
3. Look at `git log -p -- src/viewModels/organization/InvitationAcceptanceViewModel.ts` for recent decorator/MobX changes.

---

## #3 — OrganizationFormViewModel (4 failures, likely same cause as #2)

Same `expected undefined to be …` pattern. High probability the fix that resolves #2 also resolves these 4. If so, total effort for the ViewModel pair is ~1-2 hours, not 1-2h × 2.

---

## #4 — useKeyboardNavigation (7 failures)

**Stack trace**: `src/hooks/useKeyboardNavigation.ts:272:36`:
```typescript
const inDropdown = target?.closest('[data-focus-context="open"…')
```

Tests dispatch on `document`, which makes `event.target = Document`. `Document` doesn't have `.closest()`. The `?.` only handles null/undefined, not "method missing on truthy value."

**Fix**:
```typescript
const inDropdown = target instanceof Element
  ? target.closest('[data-focus-context="open"…')
  : null;
```

Same fix needed at `useKeyboardNavigation.ts:384` (same call pattern). Verify by re-running the affected tests; expect 7/7 green.

---

## #5 — useFocusAdvancement (6 failures)

**Symptoms** (mock spy assertions):
```
expected "focus" to be called at least once
expected "spy" to be called 1 times, but got 0
expected "warn" to be called with arguments: [ Array(1) ]
expected "preventDefault" to be called at least once
```

The hook's side-effects (calling `.focus()`, `console.warn`, `preventDefault()`) are not firing in tests.

**Hypotheses**:
1. Same Element-vs-Document target-typing issue as #4 — the hook may early-return when `target` doesn't meet a type guard.
2. Vitest fake timers swallowing `setTimeout`-based focus advancement.
3. The hook reads from a ref that's `null` in the test setup.

**Investigation steps**:
1. Read `src/hooks/useFocusAdvancement.ts` — look for early-return guards on `target`/`event`.
2. Check the test file for `vi.useFakeTimers()` without matching `vi.runAllTimers()` after the action.
3. Compare to #4's fix — if the target-typing fix unblocks event dispatch, the spy assertions may resolve as a side effect.

---

## #6 — scripts/ logger (13 failures, independent)

The `scripts/` directory has its own logger (`scripts/lib/logger.ts` or similar — separate from `src/utils/logger.ts`, which passes 13/13).

**Symptoms**: every test fails with `expected [] to have a length of N` — the captured log buffer is always empty.

**Hypothesis**: A recent refactor changed where the script-side logger writes its output, but the test's hook into the buffer didn't follow. Possibilities:

- Logger writes via `console.log` directly, but test mocks a different sink.
- Logger has multiple output targets (`console`, `memory`, etc.) and the default is no longer `memory` for tests.
- The `process.env.NODE_ENV === 'test'` check that wires the buffer is missing or wrong.

**Investigation steps**:
1. Read `scripts/lib/logger.ts` (or wherever the script-side logger lives) — identify output target wiring.
2. Read the test file — confirm what sink it's spying on.
3. Reconcile.

This is fully independent of #2-#5; can be tackled in parallel by a different person.

---

## Suggested execution order

1. **Quick win first**: ship #1 (vitest exclude) as a one-line commit; **5 minutes** plus PR overhead. This alone takes the headline from `39 failed / 20 passed (59)` to `5 failed / 20 passed (25)` and dramatically improves CI signal-to-noise.

2. **Investigate #2/#3 together** (the ViewModel pair). A single PR; ~1-2 hours.

3. **Investigate #4/#5 together** (the hook pair). A single PR; ~1-2 hours.

4. **Investigate #6 independently** (script logger). Can run in parallel with #2/#3 or #4/#5; ~1-2 hours.

Total stabilization effort: **3-5 hours** if hypotheses hold; **~7 hours** worst case if no fixes share root causes.

---

## Decision points (for whoever picks this up)

- **Should #1 be its own PR?** Recommended yes — it's safe, narrow, mechanical, and unblocks better CI signal immediately. Don't bundle it with the substantive fixes.
- **Bundle #2-#5 into one PR or four?** Lean toward one PR per "pair" (#2+#3, #4+#5) since each pair likely shares a root cause. If a pair turns out to NOT share a cause mid-investigation, split.
- **Frontend `npm test` in CI**: Currently no CI workflow runs frontend unit tests on PR. Adding one would prevent regressions in this area, but only after #1-#6 are all green (otherwise CI blocks every PR). Not in scope for this card.

## Out of scope

- Adding frontend unit tests to CI (separate card; gated on stabilization complete).
- Splitting/consolidating the `e2e/` vs `tests/` Playwright spec dirs (separate concern surfaced during categorization; relevant to PR #46's UAT plan but not to test stabilization).
- Migrating any of these tests to Playwright or removing redundant tests — the goal is stabilization at current scope.

## Tie-in to existing seeds

This card complements:
- [`codify-frontend-feedback-and-testing-standards-seed.md`](./codify-frontend-feedback-and-testing-standards-seed.md) §S2 — that codification card flags the existence of broken hook tests; this card characterizes them and gives an actionable plan.

After execution, archive both seed files together with shipped-PR pointers in the deprecation banners.
