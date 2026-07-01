# Codify Frontend Feedback + Testing Standards — Seed Findings

## Source

`software-architect-dbc` review of PR #37 (notification-prefs save toast fix), 2026-04-24.
[Review comment](https://github.com/Analytics4Change/A4C-AppSuite/pull/37#issuecomment-4316544213) under "Standards worth codifying (post-merge, not this PR)".

The architect deferred two cross-cutting standards to post-merge codification rather than blocking the (small, focused) UX fix on a documentation refactor.

---

## S1: Toast + persistent-banner double-surface convention — LOW / DOCUMENTATION

> **⚠️ Revisited 2026-07-01 (software-architect-dbc).** S1's premise below is **inverted** by the codebase: banners are the house style (~35 sites/15 files), not toasts; and the installed Sonner v2 announces **politely** (container `aria-live="polite"`), never assertively — so rule #4 ("toast is `alert` → demote the banner") is backwards. Resolved standard: **Banner-authoritative, toast-as-visual-echo** — success → polite banner; failure → assertive banner (single announcement) + `aria-hidden` toast echo. Now documented at [`documentation/frontend/patterns/command-feedback.md`](../../documentation/frontend/patterns/command-feedback.md) (**Phase 1 doc shipped**). Phase 2 (UsersManagePage reference impl + `useCommandFeedback`/`sanitizeCommandError`/`<CommandFeedbackBanner>`, fixing the 3 double-announce sites) and Phase 3 (progressive rollout) pending. **S2 below still stands.** Archive this card once Phase 2 lands.

**Pattern**: Successful and failed command results in the frontend are surfaced via two parallel mechanisms — a transient Sonner `toast.success/error` AND a page-local persistent banner (typically `role="alert"`). The convention is now de facto at three call sites:

- `frontend/src/pages/auth/ResetPasswordPage.tsx:144` — toast only (page redirects, no banner)
- `frontend/src/viewModels/organization/OrganizationFormViewModel.ts:514` — toast on bootstrap-failure path; VM `error` also bannered by consumer pages
- `frontend/src/pages/users/UsersManagePage.tsx` (post PR #37) — toast for notification-prefs save; VM `error` cleared on this path to avoid double aria-live

**Problem**: Three call sites, three slightly different policies. New contributors have no canonical guidance:
- When does toast suffice vs require a banner?
- When does the banner double-announce alongside the toast (both are `role="alert"`) and how should we resolve that?
- Are toast colors (richColors `success`/`error`) authoritative for command outcomes, or just one option?

**Target document**: New section in `frontend/CLAUDE.md` ("User Feedback on Command Results") OR new file `documentation/frontend/patterns/command-feedback.md`.

**Proposed content sketch** (for the codification PR):

1. **Default**: success → `toast.success(<short verb-noun message>)`; error → `toast.error(<sanitized user-friendly message>)`.
2. **Add a persistent banner** when the failure prevents the user from continuing on the same page (e.g. `viewModel.error` bannered on a form they must fix). Don't double up — clear the banner if the toast already announced.
3. **Sanitization rule**: error envelopes from `api.*` RPCs may contain handler internals (`Event processing failed: <constraint name>`). Strip the prefix and substitute a friendly fallback for the toast / banner; keep the raw form in `log.warn`.
4. **Aria-live** — ~~Default toast is `alert`, so demote any concurrent banner.~~ **CORRECTED 2026-07-01**: Sonner v2 toasts announce **politely** (container `aria-live="polite"`), never `alert`. So the **banner owns the single announcement** (`role="alert"`) and the concurrent failure toast is `aria-hidden="true"` (visual echo only). See `command-feedback.md`.

**Recommendation**: Single doc-only PR; ~30 minutes; refactor existing ad-hoc comments into this canonical doc and add a forward-link from `frontend/CLAUDE.md`.

---

## S2: "Extract-to-hook-to-test" as anti-pattern — LOW / DOCUMENTATION

**Pattern**: PR #37's `2ca9d951` commit (subsequently reverted) extracted a 30-line `useCallback` save handler from `UsersManagePage` into a standalone `useNotificationPreferencesSave` hook + a pure `performNotificationPreferencesSave` function, primarily so the toast emission could be unit-tested without rendering the page.

**Why it's an anti-pattern**:

- The hook had exactly one caller and one call site → violates root `CLAUDE.md`'s "three similar lines is better than a premature abstraction".
- The "test coverage" actually covered the pure helper, not the hook — `useState` + `useCallback` had zero direct coverage.
- The motivation (`@testing-library/react` not installed) is itself fixable: install the harness, don't redesign the production code around the absence of one.
- Routing through a bespoke hook bypassed `UsersViewModel.updateNotificationPreferences()` — the canonical write path that owns Pattern A v2 in-place projection patches and `isSubmitting` semantics. Architect flagged this as the same dual-write CQRS-compliance regression class already cleaned up once (see `memory/remediation-history-2026-feb-mar.md`).
- `useCallback([params])` with `params` as a fresh-object-literal-each-render defeated memoization — silently wasteful, not incorrect.

**Target document**: New "Testing Patterns" section in `frontend/CLAUDE.md`, near the existing MobX testing notes.

**Proposed content sketch**:

> **Test ViewModels as the unit of MobX logic.** A page handler that wraps a VM call is rarely worth its own test — test the VM. Do NOT extract a page-level `useCallback` into a custom hook (or worse, a pure helper called from a hook) purely to reach a test seam. If the project's existing test harness (`@testing-library/react`, `renderHook`) is missing, install it; do not redesign production code around the absence.

> **Antithesis flag**: a hook with one caller, in one file, whose only justification is "now I can unit-test it" — re-evaluate whether the test would be better written against the VM, the service, or a Playwright UAT.

**Tie-in**: Two existing hook test files (`useFocusAdvancement.test.tsx`, `useKeyboardNavigation.test.tsx`) had latent broken `renderHook` imports until PR #37 installed `@testing-library/react`. They're now collectible but 13 of 28 cases still fail — separate concern, not blocked by this codification.

**Recommendation**: Same doc-only PR as S1, OR separate small PR; ~20 minutes; add the new section + forward-link from `documentation/frontend/patterns/`.

---

## Suggested execution

Both S1 and S2 are small documentation tasks that can ship as a single PR ("frontend: codify command-feedback + testing patterns"). Estimated effort: 60–90 minutes including AGENT-INDEX entry + cross-links.

After codification, this seed file moves to `dev/archived/` with a "shipped in PR #N" note.
