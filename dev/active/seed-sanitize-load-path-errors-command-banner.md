---
status: seed
last_updated: 2026-07-22
---

# Seed: Sanitize load-path errors before the command-feedback banner

**Origin**: `software-architect-dbc` review of PR #91 (command-feedback Phase 3 siblings), finding **#2** (LOW, **pre-existing** — not introduced by #91).

> **Update 2026-07-22 (PR #91 follow-up review, S1)**: the 4 migrated sibling pages the PR already touched — `roles`, `organizations`, `organization-units`, `schedules` — now sanitize the page-level `viewModel.error`/`listVM.error` inline (`sanitizeCommandError(viewModel.error, '<friendly load fallback>').display`). **Remaining scope: `UsersManagePage` only** — the raw error flows through the `UsersErrorBanner` component (out of scope for #91), where the decision is whether to sanitize inside the component or at the prop. Narrow this card to that one surface.

## Problem
The command-feedback page banners render `{viewModel.error || operationError}` (Users uses `UsersErrorBanner`'s `{error || operationError}`). `operationError` is now always sanitized (it flows through `showCommandFailure` → `reportFailure` → `sanitizeCommandError`), but **`viewModel.error` / `listVM.error` is raw** — a VM *load/query* failure (e.g. `loadAll`, `loadDetails`, `refresh`) can put handler-internal text (`Event processing failed: …`, PG SQLSTATE) straight into the standard banner, bypassing the display-layer sanitizer.

This is identical on the reference `UsersManagePage` and all 4 migrated siblings, so it should be fixed **uniformly in one pass** (not per-page) to keep them consistent.

PR #91 already fixed the one per-page raw seed it introduced into scope (`OrganizationsManagePage` load-failure `setOperationError(newFormVM.submissionError …)` → now wrapped in `sanitizeCommandError`).

## Proposed
- Wherever a page banner renders a raw VM error, sanitize it: `sanitizeCommandError(viewModel.error).display` (or route VM load errors through a shared helper). Prefer sanitizing at the single render site per page.
- Pages: `users/UsersManagePage.tsx` (via `UsersErrorBanner` — decide whether to sanitize inside the component or at the prop), `roles`, `organizations`, `organization-units`, `schedules`.
- Confirm friendly VM errors still pass through unchanged (sanitizer only rewrites internal-looking strings).

## Verification
- Force a VM load failure (offline / injected 500) and confirm the banner shows the friendly fallback, not `Event processing failed:`/`ERRCODE`/constraint text.
- `grep -rnE 'viewModel\.error \|\| operationError|error \|\| operationError' frontend/src/pages` — every hit sanitized or routed.
- `tsc`/`eslint`/`build` green.

## ✅ DONE

- **Siblings** (Roles, Organizations, Org-Units, Schedules): sanitized inline in PR #91 (`32ecc1fc`).
- **Users** (`feat/command-feedback-users-load-path`, 2026-07-22): the last surface. `UsersManagePage` now sanitizes the `error` prop passed to `UsersErrorBanner` — `error={viewModel.error ? sanitizeCommandError(viewModel.error, 'Something went wrong. Please try again.').display : null}` — closing the raw load-error path (notably `UsersViewModel` L520 interpolates a raw `errorMessage` into `this.error`). The `operationError` prop was already sanitized (via `showCommandFailure`); the rich role-violation / partial-failure variants render structured messages and are out of scope. The success-banner `!viewModel.error` guard is a boolean check (unaffected).
- `tsc`/`eslint`/`build` green; UsersErrorBanner + users VM tests pass (17).
