---
status: current
last_updated: 2026-07-22
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Standard for surfacing command/operation results in the UI — success shows a polite persistent banner; failure shows an assertive persistent banner (the single ARIA announcement) plus an `aria-hidden` visual toast echo for scroll-independence. Banner is authoritative; the toast never announces.

**When to read**:
- Adding success/failure feedback to a command on a manage or form page
- Deciding between a toast, a banner, and a modal for an operation result
- Fixing a screen-reader double-announce (toast + banner both speaking)
- Sanitizing an `api.*` error envelope before showing it to the user

**Prerequisites**: [ui-patterns.md](ui-patterns.md), [adr-rpc-readback-pattern.md](../../architecture/decisions/adr-rpc-readback-pattern.md)

**Key topics**: `command-feedback`, `toast-banner`, `aria-live`, `error-surfacing`, `wcag`, `error-sanitization`

**Estimated read time**: 10 minutes
<!-- TL;DR-END -->

# Command-Result Feedback Standard

How the frontend tells the user the outcome of a **command** (a state-changing operation: invite, deactivate, save, delete, submit). This is the canonical convention; new code follows it and reviews enforce it.

> **Scope**: command *results* only. Inline **field-level validation** (`aria-invalid` + `aria-errormessage` on the input) is a separate concern and is unchanged by this standard.

## The model

| Outcome | Banner (authoritative) | Toast (echo) |
|---------|------------------------|--------------|
| **Success** | `role="status"` (polite), persistent, dismissible. **Banner only.** | — none — |
| **Failure** | `role="alert"` (assertive), persistent until dismissed or superseded. **Owns the one announcement.** | Fixed-position **`aria-hidden="true"`** element (`CommandFeedbackEcho`), persistent until cleared, **no focusable content**. **Visual scroll-independence only — never announced.** |

**Why the failure toast is silent to screen readers**: the installed Sonner (`<Toaster>` at `frontend/src/App.tsx`) announces **politely** via a single container `aria-live="polite"` region and never assertively (verified against `sonner` v2.0.7, 2026-07-01 — lockfile-locked at 2.0.7; re-verify on upgrade). Errors deserve an *assertive* interrupt, which only our own `role="alert"` banner can provide. So the **banner owns the announcement** and the echo is a purely visual, non-announcing copy. Announcing both would double-speak — the defect this standard eliminates. The echo is a **non-Sonner** `aria-hidden` element (`CommandFeedbackEcho`), so it removes itself from the a11y tree **and** has no focusable descendant to neutralize (INV-2 by construction) — see INV-2 for why the Sonner-toast echo was rejected.

**Why a toast at all on failure**: many pages scroll; an error rendered only in a top-of-page banner can be missed by a user who doesn't scroll up, who then wrongly assumes success. The `aria-hidden` toast guarantees the failure is *seen* immediately, independent of scroll position, without a second announcement.

## Decision tree

```
Command resolved.
├── Success → banner role="status" (polite), persistent. No toast.
│
└── Failure
    ├── Does resolving it REQUIRE a user decision before continuing?
    │   (e.g. session expired → must re-login; unsaved-conflict → keep/discard)
    │   └── YES → modal dialog (role="dialog", focus-trapped). Rare.
    │
    └── NO (the default) → banner role="alert" (assertive, owns the announcement)
        + aria-hidden echo element (visual, persistent)
        └── Is the failure form-blocking (user must fix this page)?
            └── YES → also move focus to the banner (useEffect, never setTimeout)
```

Modals are **reserved** for the narrow "error requires a decision" case — never the default (they interrupt flow and force dismissal on every transient/retryable error).

## Accessibility contract

Invariants that MUST hold for every command outcome:

- **INV-1 — single announcement per command surface**: for a given command surface, exactly one ARIA live region announces an outcome. On failure that is the `role="alert"` banner; the toast echo is always `aria-hidden="true"`. When independent surfaces coexist on one page (e.g. a `role="status"` success banner and a `role="alert"` failure banner both mounted), the **assertive failure supersedes** — mounting a failure banner clears/replaces any concurrent success banner on that surface, so at most one region announces at a time.
- **INV-2 — no focusable content under `aria-hidden`** (WCAG 4.1.2; axe-core `aria-hidden-focus`): an `aria-hidden` subtree must contain no focusable descendant. The failure echo is a plain, non-Sonner `aria-hidden` `<div>` (`CommandFeedbackEcho`) containing text only, so this holds **by construction** — nothing to neutralize. *(A Sonner-toast echo was evaluated and rejected: Sonner v2 renders each toast as `<li tabIndex=0>` + a focusable close button; neutralizing those via a `MutationObserver` proved fragile — it couples to React-reconciliation internals and mismatched the class-carrying node — so the standard uses a static element instead.)*
- **INV-3 — durability**: every failure stays visible until the user dismisses it or issues the next command on that surface. Banners never auto-vanish; the failure echo persists as component state until cleared (no auto-dismiss timer).

**Focus**: on a *form-blocking* failure, move focus to the banner container on the next paint via `useEffect` keyed on the error — **never `setTimeout`** (see [frontend/CLAUDE.md](../../../frontend/CLAUDE.md) focus rules). Non-blocking failures (e.g. a list-row action) do **not** steal focus; the assertive banner announces in place. This covers **all** form-blocking failure banners, not just the plain-message one: a rich/composed error banner (e.g. `UsersErrorBanner`'s role-violation / partial-failure variants) is equally form-blocking and MUST be focusable (`forwardRef` + `tabIndex={-1}`) and receive focus too. Key focus on an observable that is set **only by the submit path** — **never** a shared error observable that background loads also set, or navigation-time load failures will steal focus. *(Exercised by the reference `UsersManagePage` as of Phase 3 / PR-N4: the invite and edit submit banners are the shared `CommandFeedbackBanner`, keyed on `formViewModel.submissionError`; the rich `UsersErrorBanner` is focused by a `useEffect` keyed on `lastRoleViolations`/`lastRolePartialFailure` — set only by `modifyRoles`, which runs only through the submit, so it is inherently submit-scoped, whereas the banner's generic `viewModel.error` variant, which `loadUserDetails` also sets, is deliberately **not** focused.)*

**Dismissal**: dismissing the banner clears the ViewModel error state **and** clears the echo (via the hook's `clear()`) so the two surfaces never desync. Because a form-blocking failure moved focus *to* the banner, dismiss MUST also **restore focus** to the control that triggered the submit, rather than letting focus drop to `<body>` when the banner unmounts. Restoration must be **armed only when a banner actually took focus**: capture the trigger at submit time as a *candidate*, promote it to the live restore target inside the focus `useEffect` (and disarm it in that effect's cleanup when the banner leaves), then consume-and-clear it on dismiss. This guarantees a banner the user never had focus moved into (e.g. a background-load error) can never restore focus to a stale trigger. *(Exercised by `UsersManagePage`: `handleSubmit` records `document.activeElement` as the candidate; each focus effect promotes it to `restoreTargetRef` and disarms on cleanup; every banner's `onDismiss` calls `restoreFocusToTrigger()`, which is a no-op unless armed and DOM-present.)*

**Reduced motion**: the echo has no transition/animation (reduced-motion-safe by construction); banners never animate.

## Error-message sanitization

`api.*` envelopes can leak handler internals (`Event processing failed: <constraint>`, PG error codes). These MUST NOT reach the UI. A display-layer sanitizer sits *after* the SDK-boundary PII mask (`unwrapApiEnvelope`/`apiRpcEnvelope`) as a third, presentation-tier guard consistent with the three-layer PII model:

- Strip known handler-internal prefixes; substitute a friendly, actionable fallback when the raw string looks internal.
- **Never** interpolate identifiers/constraint names into the displayed text.
- The **caller renders only the sanitized `display` string** and **must `log.warn` the raw error** with the `correlation_id`. When a correlation id is present, pair with `ErrorWithCorrelation` (`frontend/src/components/ui/ErrorWithCorrelation.tsx`) so users get a support reference without seeing internals.

## Components & abstraction

Banners are already the house style (most manage pages drive `role="alert"`/`role="status"` from ViewModel state). This standard formalizes them and adds the failure echo. Reference points:

- `<Toaster richColors position="top-right" />` — `frontend/src/App.tsx`
- `UsersErrorBanner` — `frontend/src/components/users/UsersErrorBanner.tsx` (the tri-priority error banner this standard generalizes)
- `ErrorWithCorrelation` — `frontend/src/components/ui/ErrorWithCorrelation.tsx`

> **Implemented (Phase 2, PR #88)**: `useCommandFeedback()` (`frontend/src/hooks/useCommandFeedback.ts`) sanitizes + `log.warn`s and drives the echo state; the pure `sanitizeCommandError(raw)` util (`frontend/src/utils/sanitizeCommandError.ts`); `<CommandFeedbackBanner>` and the non-Sonner `<CommandFeedbackEcho>` (`frontend/src/components/ui/`). These centralize INV-1..3 so call sites can't reintroduce a double-announce. The hook **orchestrates presentation only** — writes stay on the ViewModel path (no dual-write, no bypass of the VM). Tests cover the **pure sanitizer** and the **echo component** (INV-2); the hook itself is deliberately not unit-tested (it's a multi-caller abstraction for the Phase-3 rollout, not a one-caller test-seam extraction).

> **Implemented (Phase 3, PR #91)**: `useCommandFeedbackFocus()` (`frontend/src/hooks/useCommandFeedbackFocus.ts`) — the sanctioned focus primitive for form-blocking banners. It captures the submit trigger, moves focus to the banner via `useEffect` (no `setTimeout`), and restores focus to the trigger on dismiss — armed only when the banner actually took focus, so a background-load-error banner can never restore to a stale trigger (the "airtight restoration" contract). One instance per form-blocking banner; unit-tested (`useCommandFeedbackFocus.test.ts`) for the arm/restore/consume/disarm contract.

## data-testid requirements

Stable testids are mandatory (extend today's `users-error-banner` / `invite-success-${action}`):

- banner container: `command-feedback-banner`
- banner dismiss control: `command-feedback-banner-dismiss`
- failure toast echo: `command-feedback-toast-error`

## Definition of Done (per command feedback site)

- [ ] Success → `role="status"` banner; failure → `role="alert"` banner + `aria-hidden` toast echo (INV-1)
- [ ] Displayed error is sanitized; raw error `log.warn`'d with correlation id
- [ ] Form-blocking failure moves focus to the banner via `useEffect` (no `setTimeout`) — **every** form-blocking banner on the surface, including rich/composed variants
- [ ] Banner dismiss also dismisses the paired toast; VM error cleared; **focus restored** to the submit trigger (not dropped to `<body>`)
- [ ] Required `data-testid`s present
- [ ] Single announcement + zero `aria-hidden-focus` verified — via the `RUN_A11Y_GATE` Playwright spec (`frontend/e2e/command-feedback-a11y.spec.ts`) or deployed DevTools (console query + Accessibility-tree "not exposed" on the echo); manual NVDA/VoiceOver pass when audio is available
- [ ] Focus move **and** dismiss-restoration asserted in the `RUN_A11Y_GATE` spec for each form-blocking banner (plain + rich)

## Adoption status

- ✅ **Phase 1** — standard defined (this doc).
- ✅ **Phase 2 (SHIPPED — PR #88, merged `a22bcab5`)** — reference implementation: `useCommandFeedback` + `sanitizeCommandError` + `<CommandFeedbackBanner>` + non-Sonner `<CommandFeedbackEcho>`; `UsersManagePage` migrated (fixes the 3 double-announce sites, removes the notif-prefs `clearError()`-to-suppress-the-banner double-aria-live hack — `clearError()` itself is retained in the helpers for success/failure mutual exclusion — closes the invite success/failure asymmetry, sanitizes the invite/edit submission banners). **F4 a11y gate verified on the deployed build 2026-07-02** — INV-1 (one `role="alert"`) + INV-2 (zero `aria-hidden-focus`) + no raw leak, via DevTools on `a4c.firstovertheline.com`; manual audio AT pass optional.
- 🔄 **Phase 3 (in progress)** — progressive-enhancement rollout to the other command-feedback pages, batched by area. Existing banners already surface every failure, so partial rollout is never broken — only less uniform.
  - **PR-N4 + N2** (reference page hardening): the `UsersManagePage` invite/edit **form-submit** failure now routes through the shared `CommandFeedbackBanner` + `showCommandFailure` echo + focus-to-banner, and the page-level `UsersErrorBanner` is guarded so exactly one `role="alert"` region can mount (closes the last INV-1 co-mount gap). The write-only `UsersViewModel.successMessage` observable + setters were removed (the page-level `showCommandSuccess` banner is the authoritative success surface). Focus handling was completed to the full contract: the rich `UsersErrorBanner` (role-violation / partial-failure variants) is now focusable (`forwardRef` + `tabIndex={-1}`) and receives focus on a submit failure via a `useEffect` keyed on the submit-only `lastRoleViolations`/`lastRolePartialFailure` observables, and every banner's dismiss restores focus to the submit trigger (armed only when a banner actually took focus, so a background-load error banner can't restore to a stale trigger) instead of dropping to `<body>`. The `RUN_A11Y_GATE` spec now asserts both the focus move and the dismiss-restoration for the plain **and** rich banners.
  - **Sibling manage pages** (Roles, Organizations, Org-Units, Schedules): migrated to the standard — each now drives a `role="status"` success banner + `role="alert"` failure banner (guarded `!submissionError` for INV-1) + `aria-hidden` echo, with all mutations (create/update/deactivate/reactivate/delete, plus Organizations' contact/address/phone sub-entities) routed through `showCommandSuccess`/`showCommandFailure`, and the previously-**raw** `submissionError` form banners now sanitized + focus-managed via the extracted `useCommandFeedbackFocus` hook. Folded in: dropped the `OrganizationFormViewModel` bootstrap `toast.error` (it already set `submissionError` → Sonner-polite + banner double-surface).
  - **Tier-2 surfaces (partial)**: `OrphanedDeletionsPage` (admin) — sanitized `role="alert"` banner + `role="status"` success + echo on retry (was a raw string with no `role` and no success; also fixed a retry-error-wiped-by-refresh bug); `UserCaseloadPage` (assignments) — added success + failure banner + echo for assign/unassign (previously **no** feedback; the VM swallows the raw error, so failures show a generic op fallback); `ClientIntakePage` — failure surfaces sanitized (success navigates to the client detail page, so no same-page success banner); `ResetPasswordPage` — `submitError` sanitized + the assertive-downgrading `aria-live="polite"` removed; the success `toast.success` is **kept as the documented navigation-away exception** (the page redirects to `/login` immediately, so a persistent banner would never be seen).
  - **Settings client-fields tabs** (`CategoriesTab`/`CustomFieldsTab`): migrated — each per-item CRUD op now sets a specific `successMessage` (new VM observable, distinct from the batch-save `saveSuccess`) rendered as a top-of-tabpanel `role="status"` banner guarded on `!<its errors>` (INV-1); the six contextual `role="alert"` error displays are now sanitized in place (kept contextual — **not** consolidated); the two silent `deactivate*` methods gained success + failure feedback. Echo left out of scope (errors sit next to the action).
  - **Load-path sanitization** (done): the page-level VM error (`viewModel.error`/`listVM.error`) is now sanitized before display on every command-feedback page — siblings inline (PR #91), and `UsersManagePage` via the `UsersErrorBanner` `error` prop.
  - **Organizations *create* flow** (`OrganizationCreateForm`): migrated — the raw `submissionError` banner is now the shared `<CommandFeedbackBanner kind="error">` (sanitized) + `aria-hidden` echo + focus-to-banner via `useCommandFeedbackFocus`; success navigates to the bootstrap status page (no same-page success banner, like `ClientIntakePage`). No correlation_id is surfaced (the bootstrap workflow client generates it per-request internally).
  - Remaining target (seeded follow-up): the shared **`sanitizeCommandError` SQLSTATE heuristic** false-positive (a field name like `A1234` trips `\b[A-Z]\d{4}\b`).

## Related Documentation

- [ui-patterns.md](ui-patterns.md) — general UI component patterns (banners, dialogs)
- [danger-zone-pattern.md](danger-zone-pattern.md) — destructive-action confirmation (the modal case)
- [rpc-readback-vm-patch.md](rpc-readback-vm-patch.md) — how command results reach the ViewModel
- [adr-rpc-readback-pattern.md](../../architecture/decisions/adr-rpc-readback-pattern.md) — the `api.*` return-error envelope this standard sanitizes
- [frontend/CLAUDE.md](../../../frontend/CLAUDE.md) — accessibility (WCAG 2.1 AA), focus, MobX rules
