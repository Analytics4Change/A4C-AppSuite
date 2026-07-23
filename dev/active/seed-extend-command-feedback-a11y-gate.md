---
status: seed
last_updated: 2026-07-22
---

# Seed: Extend the command-feedback F4 a11y gate to all migrated surfaces

**Origin**: `software-architect-dbc` review of PR #95 (org create-flow), finding #2 (Minor, testing) — noted as consistent with every prior Phase-3 page, so this is an **epic-wide** coverage gap, not specific to #95.

## Problem
`frontend/e2e/command-feedback-a11y.spec.ts` (the machine half of the F4 gate — INV-1 single `role="alert"`, INV-2 zero `aria-hidden-focus`, no raw leak, focus-to-banner) only drives the **reference `UsersManagePage`**. The Phase-3 surfaces migrated since — the 4 sibling manage pages (Roles/Orgs/Org-Units/Schedules), the Tier-2 pages (OrphanedDeletions, UserCaseload, ClientIntake, ResetPassword), the settings client-fields tabs, and `OrganizationCreateForm` — are **not** exercised by the gate, so their DoD "single announcement + zero aria-hidden-focus verified" item is CI-unverified (they were checked via tsc/lint/build + unit tests + architect review, not the running-app a11y spec).

## Proposed
- Parameterize `command-feedback-a11y.spec.ts` over the migrated surfaces (each needs: a nav path, a way to force a command failure — `page.route` interception or "Go offline" — and the surface's banner/echo testids), asserting INV-1 (exactly one visible `role="alert"`), INV-2 (0 focusable under `[aria-hidden]`), no raw leak, and (for form-blocking surfaces) focus-to-banner + dismiss-restore.
- Keep it `RUN_A11Y_GATE`-gated so CI stays green without a live app; document the per-surface run in the DoD.
- Testids already exist on most surfaces (`command-feedback-banner`, `command-feedback-toast-error`, `*-submission-error`, `caseload-error-banner`, `org-create-submit-error`, `category-success`/`field-success`, …).

## Verification
- `RUN_A11Y_GATE=1 npx playwright test command-feedback-a11y` green against a live/mock build across the added surfaces.
- No new CI time when the gate is unset (skipped).

## Not started. LOW (coverage/CI). Companion to the shared `sanitizeCommandError` SQLSTATE-heuristic follow-up.
