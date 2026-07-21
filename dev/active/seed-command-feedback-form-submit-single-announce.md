---
status: seed
last_updated: 2026-07-21
---

# Seed: Route UsersManagePage form-submit failure through the command-feedback standard (N4)

**Origin**: `software-architect-dbc` re-review of PR #88 (command-feedback Phase 2), finding **N4** (LOW, pre-existing — not introduced by #88). See `documentation/frontend/patterns/command-feedback.md` and [[pr-85-close-out]]-adjacent frontend work.

## Problem
The invite/edit **form-submit** failure path on `UsersManagePage` is the one command-feedback surface **not** yet routed through the Phase-2 standard:

- It surfaces `formViewModel.submissionError` via **two hand-rolled `role="alert"` banners** (invite `~:804`, edit `~:1105`) — not the shared `<CommandFeedbackBanner>` / `showCommandFailure` path.
- Those `role="alert"` banners can **theoretically co-mount** with `UsersErrorBanner` (also `role="alert"` on `operationError`) if a stale `operationError` from a prior list-row action survives into a form submit → **two announcing live regions** (the exact INV-1 double-announce class this epic exists to kill). The window is narrow today (`selectAndLoadUser` clears `operationError` at `:241`), so it's low-risk, but it's structurally unguarded.
- The form-submit failure also does **not** fire the `aria-hidden` echo (it bypasses `showCommandFailure`), so it lacks the scroll-independent visual cue the rest of the page now has.

## Proposed (Phase 3)
Route `formViewModel.submissionError` through the same single-announcement discipline:
- Replace the two hand-rolled banners with `<CommandFeedbackBanner kind="error">` (or feed `submissionError` into `showCommandFailure` so it drives the shared banner + echo + sanitizer + focus-to-banner).
- This is also the **form-blocking failure** case the standard calls out for **focus-to-banner** (`useEffect` on the error) — wire that here (the `<CommandFeedbackBanner>` `forwardRef` already exists for it).
- Confirm exactly one `role="alert"` at a time (extend the F4 axe spec's INV-1 assertion to the form path).

Sanitization is already done (PR #88 F5 wrapped both banners in `sanitizeCommandError`); this card is about **unifying the mechanism**, not the leak.

## Verification
- F4 axe/AT gate extended to the invite-failure path (single announcement + focus moves to banner).
- `tsc`/`eslint`/`build` green.

## ✅ DONE — Phase-3 PR 1 (`feat/command-feedback-phase3-n4-n2`, 2026-07-21)

- Both hand-rolled `submissionError` `role="alert"` banners (invite/edit) replaced with the shared `<CommandFeedbackBanner kind="error">` (testids `invite-submission-error` / `edit-submission-error`), fed by `sanitizeCommandError(..., '<op fallback>')`.
- `handleSubmit` failure branch now clears the stale page-level `operationError` and fires the `aria-hidden` echo (`reportFailure`) for scroll-independence + `log.warn`.
- Page-level `UsersErrorBanner` guarded with `!formViewModel?.submissionError` → at most one `role="alert"` mounts (INV-1). Rich role-violation/partial variants unaffected (they suppress `submissionError` by construction).
- Form-blocking **focus-to-banner** wired via `useEffect` keyed on `formViewModel.submissionError` → `CommandFeedbackBanner`'s `forwardRef`/`tabIndex={-1}` (no `setTimeout`).
- F4 spec (`e2e/command-feedback-a11y.spec.ts`) invite-failure test extended: asserts banner focused + echo fires (aria-hidden) + single alert, via testids (echo now shares banner text).
