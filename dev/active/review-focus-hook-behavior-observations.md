---
status: seed
last_updated: 2026-07-26
---

# Seed: two focus-hook behaviour observations (decision-gated, low priority)

**Origin**: surfaced during the `fix/failing-vm-test-suites` remediation. Both are test-only-resolved (tests now assert the *current* behaviour); these ask whether the current behaviour is the intended one.

## 1. Initial focus uses `requestAnimationFrame` inside `useEffect`
`useKeyboardNavigation.ts:154-164` and `useFocusAdvancement.ts:159-166` defer focus via `requestAnimationFrame` (double-RAF in the latter). `frontend/CLAUDE.md` says "use `useEffect`/`autoFocus`, **never `setTimeout`** for focus" — RAF is a timer-like deferral in the same spirit. **Decide**: is RAF-deferred focus an accepted exception (it waits for paint/Portal cleanup, which `autoFocus` can't), or should the guideline be clarified / the hooks moved to a layout-effect + ref pattern? If accepted, add a one-line note to the CLAUDE.md focus rules so it's not re-flagged.

## 2. `useFocusAdvancement` target precedence is tabIndex > selector
The hook resolves `targetRef > targetTabIndex > targetSelector` (`useFocusAdvancement.ts:114-120`). The old test's title claimed *selector* takes precedence — the opposite. The tests now assert the actual (tabIndex-first) order. **Decide**: confirm tabIndex-first is intended (it is self-consistent; no spec violated), and document the precedence in the hook's JSDoc so callers relying on `targetSelector` while also passing `targetTabIndex` aren't surprised.

## Priority
Low. No functional/data defect; both are behaviour-clarity / guideline-conformance questions.
