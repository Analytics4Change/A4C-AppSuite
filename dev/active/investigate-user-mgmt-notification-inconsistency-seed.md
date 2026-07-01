---
status: seed
last_updated: 2026-07-01
---

# Seed: Investigate toast vs inline-banner notification inconsistency (User Management)

> **✅ SUPERSEDED 2026-07-01 — folded into the command-feedback standard.** `software-architect-dbc` resolved this: it is **not** an ad-hoc inconsistency to "converge to one paradigm" but (mostly) the intended pattern, now formalized as **Banner-authoritative, toast-as-visual-echo** in [`documentation/frontend/patterns/command-feedback.md`](../../documentation/frontend/patterns/command-feedback.md). The concrete `UsersManagePage` fixes (3 double-announce sites, the `clearError()` workaround, invite success/failure asymmetry) are tracked as **Phase 2** of that standard's rollout. Retained for evidence/history only.

**Origin**: Observed during PR #85 invite-user routing UAT (scenarios S1–S5, 2026-07-01). Success outcomes appeared as transient floating pop-ups; the S5 failure appeared as an anchored, persistent banner. See `dev/active/uat-pr85-invite-user-routing/runbook.md`.

## Problem
The User Management page surfaces operation results through **two different, inconsistently-applied mechanisms**, so the same action's success and failure look like different UI paradigms:

1. **Floating Sonner toast** — transient, top-right, auto-dismiss.
   - Global mount: `frontend/src/App.tsx:65` `<Toaster richColors position="top-right" />`.
   - Invite **success**: `pages/users/UsersManagePage.tsx:371` `toast.success(<span data-testid={`invite-success-${action}`}>…)`.
   - Deactivate/reactivate/delete/notification-prefs **success AND failure**: `toast.success` / `toast.error` (e.g. lines 423/430/459/466/593/613/642/651).
2. **Persistent inline `role="alert"` red banner** — anchored inside the form, stays until dismissed/navigated.
   - Invite **failure**: `pages/users/UsersManagePage.tsx:782-787` (*"Failed to send invitation"*), driven by `operationError` / `setOperationError(...)`.
   - Also: resend/revoke/load-detail errors set `operationError` (lines 268/500/504/535/539); a second banner at line ~1090 (*"Failed to update"*).

**Net inconsistency**: invite **success → floating toast**, invite **failure → persistent anchored banner** — two paradigms for the two outcomes of one action. Other user ops use toasts for *both* outcomes. The dual mechanism is known to overlap: comments at lines ~627/652 exist specifically to stop the `role="alert"` banner from **double-announcing alongside the toast**.

## Why it matters
- Inconsistent UX: users can't form a stable mental model of "where does feedback appear."
- A11y: two live-region strategies (Sonner's internal live region vs an inline `role="alert"`) risk double or missed announcements — the existing suppression comments confirm this is already a live concern.
- Persistence mismatch: transient success can be missed; persistent failure banner can linger stale after the form is reused.

## Proposed investigation / decision
- **Pick one canonical pattern** for transactional operation feedback on this page. Candidate: Sonner toasts for *both* success and failure of an operation (consistent with deactivate/reactivate/delete), reserving inline `role="alert"` banners for **field/validation** errors that must stay pinned to the form.
- Audit every `operationError`/`setOperationError` site vs every `toast.*` site; decide per-case which paradigm applies and converge.
- Resolve the a11y double-announce properly (single live region) rather than via ad-hoc suppression comments.
- Confirm behavior is consistent across all six invite-routing outcomes (S1–S6) and the other user lifecycle ops.

## Verification
- Re-run the invite success + failure paths; confirm both use the chosen paradigm and dismiss/persist consistently.
- Screen-reader pass (NVDA/VoiceOver): exactly one announcement per outcome, no double-speak.
- `npm run typecheck && npm run lint && npm run build` green.

## Not started. Low-MED priority — UX/a11y consistency; no functional/data defect (all UAT outcomes are correct).
