---
status: current
last_updated: 2026-07-01
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
| **Failure** | `role="alert"` (assertive), persistent until dismissed or superseded. **Owns the one announcement.** | Rendered **`aria-hidden="true"`**, `duration: Infinity`, click-to-dismiss. **Visual scroll-independence only — never announced.** |

**Why the failure toast is silent to screen readers**: the installed Sonner (`<Toaster>` at `frontend/src/App.tsx`) announces **politely** via a single container `aria-live="polite"` region and never assertively (verified against `sonner` v2.0.7, 2026-07-01 — pinned; re-verify on upgrade). Errors deserve an *assertive* interrupt, which only our own `role="alert"` banner can provide. So the **banner owns the announcement** and the toast is a purely visual echo. Announcing both would double-speak — the defect this standard eliminates.

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
        + aria-hidden toast echo (visual, duration: Infinity)
        └── Is the failure form-blocking (user must fix this page)?
            └── YES → also move focus to the banner (useEffect, never setTimeout)
```

Modals are **reserved** for the narrow "error requires a decision" case — never the default (they interrupt flow and force dismissal on every transient/retryable error).

## Accessibility contract

Invariants that MUST hold for every command outcome:

- **INV-1 — single announcement**: exactly one ARIA live region announces per outcome. On failure that is the `role="alert"` banner; the toast echo is always `aria-hidden="true"`.
- **INV-2 — no orphan speech**: the toast echo contains no focusable, non-`aria-hidden` descendant. Dismiss is a click target only; the Sonner toaster is already out of the tab order (`tabIndex=-1`, hotkey-only), so an `aria-hidden` toast does **not** create the "hidden focusable control" defect.
- **INV-3 — durability**: every failure stays visible until the user dismisses it or issues the next command on that surface. Banners never auto-vanish; failure toasts use `duration: Infinity`.

**Focus**: on a *form-blocking* failure, move focus to the banner container on the next paint via `useEffect` keyed on the error — **never `setTimeout`** (see [frontend/CLAUDE.md](../../../frontend/CLAUDE.md) focus rules). Non-blocking failures (e.g. a list-row action) do **not** steal focus; the assertive banner announces in place.

**Dismissal**: dismissing the banner clears the ViewModel error state **and** dismisses the paired toast (`toast.dismiss(id)`) so the two surfaces never desync.

**Reduced motion**: neutralize `[data-sonner-toast]` transitions under `@media (prefers-reduced-motion: reduce)`. Banners never animate.

## Error-message sanitization

`api.*` envelopes can leak handler internals (`Event processing failed: <constraint>`, PG error codes). These MUST NOT reach the UI. A display-layer sanitizer sits *after* the SDK-boundary PII mask (`unwrapApiEnvelope`/`apiRpcEnvelope`) as a third, presentation-tier guard consistent with the three-layer PII model:

- Strip known handler-internal prefixes; substitute a friendly, actionable fallback when the raw string looks internal.
- **Never** interpolate identifiers/constraint names into the displayed text.
- The **caller renders only the sanitized `display` string** and **must `log.warn` the raw error** with the `correlation_id`. When a correlation id is present, pair with `ErrorWithCorrelation` (`frontend/src/components/ui/ErrorWithCorrelation.tsx`) so users get a support reference without seeing internals.

## Components & abstraction

Banners are already the house style (~15 pages drive `role="alert"`/`role="status"` from ViewModel state). This standard formalizes them and adds the failure toast echo. Reference points:

- `<Toaster richColors position="top-right" />` — `frontend/src/App.tsx`
- `UsersErrorBanner` — `frontend/src/components/users/UsersErrorBanner.tsx` (the tri-priority error banner this standard generalizes)
- `ErrorWithCorrelation` — `frontend/src/components/ui/ErrorWithCorrelation.tsx`

> **Planned (Phase 2 — not yet implemented)**: a shared `useCommandFeedback()` hook (drives the `aria-hidden` failure toast echo + sanitization + focus-to-banner), a pure `sanitizeCommandError(raw)` util, and a generalized `<CommandFeedbackBanner>` promoted from `UsersErrorBanner`. These centralize INV-1..3 so call sites can't reintroduce a double-announce. The hook **orchestrates presentation only** — writes stay on the ViewModel path (no dual-write, no bypass of the VM). Test the **ViewModel** and the **pure sanitizer**, not the hook (a one-caller hook extracted only for a test seam is an anti-pattern — see the seed card below).

## data-testid requirements

Stable testids are mandatory (extend today's `users-error-banner` / `invite-success-${action}`):

- banner container: `command-feedback-banner`
- banner dismiss control: `command-feedback-banner-dismiss`
- failure toast echo: `command-feedback-toast-error`

## Definition of Done (per command feedback site)

- [ ] Success → `role="status"` banner; failure → `role="alert"` banner + `aria-hidden` toast echo (INV-1)
- [ ] Displayed error is sanitized; raw error `log.warn`'d with correlation id
- [ ] Form-blocking failure moves focus to the banner via `useEffect` (no `setTimeout`)
- [ ] Banner dismiss also dismisses the paired toast; VM error cleared
- [ ] Required `data-testid`s present
- [ ] `@axe-core/playwright` clean + a manual NVDA/VoiceOver pass confirms a single announcement

## Adoption status

- ✅ **Phase 1** — standard defined (this doc).
- ⏳ **Phase 2** — reference implementation: `useCommandFeedback` + `sanitizeCommandError` + `<CommandFeedbackBanner>`, migrating `UsersManagePage` (fixes 3 unmanaged double-announce sites, removes the inconsistent `clearError()` workaround, and closes the invite success/failure asymmetry).
- ⏳ **Phase 3+** — progressive-enhancement rollout to the other command-feedback pages (Roles, Organizations, Org-Units, Schedules, Clients, Assignments, Auth), batched by area. Existing banners already surface every failure, so partial rollout is never broken — only less uniform.

## Related Documentation

- [ui-patterns.md](ui-patterns.md) — general UI component patterns (banners, dialogs)
- [danger-zone-pattern.md](danger-zone-pattern.md) — destructive-action confirmation (the modal case)
- [rpc-readback-vm-patch.md](rpc-readback-vm-patch.md) — how command results reach the ViewModel
- [adr-rpc-readback-pattern.md](../../architecture/decisions/adr-rpc-readback-pattern.md) — the `api.*` return-error envelope this standard sanitizes
- [frontend/CLAUDE.md](../../../frontend/CLAUDE.md) — accessibility (WCAG 2.1 AA), focus, MobX rules
