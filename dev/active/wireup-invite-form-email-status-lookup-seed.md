---
status: seed
last_updated: 2026-07-01
---

# Seed: Wire up the invite-user form's email status-lookup (built-but-disconnected)

**Origin**: Uncovered during PR #85 invite-user routing UAT (scenario S3, deactivated-user re-run, 2026-07-01). See `dev/active/uat-pr85-invite-user-routing/runbook.md`. Orthogonal to PR #85 — the backend routing works; this is a pre-existing frontend UX gap.

## Problem
The invite-user form has a **complete email status-lookup feature that is never invoked**, so it renders **no** pre-submit feedback for any email (new / pending / expired / active-member / deactivated / other-org). The routing decision is invisible until the post-submit toast; testers (and real admins) get zero signal about who they're inviting or what will happen.

Root cause — the blur handler is a placeholder stub:
```tsx
// frontend/src/pages/users/UsersManagePage.tsx:820-823
onEmailBlur={() => {
  // Email lookup integration - for now just mark as touched
  formViewModel.touchField('email');
}}
```
It calls `touchField('email')` but **not** `checkEmailStatus(email)`, so `formViewModel.emailLookupResult` stays `null` and the `EmailLookupFeedback` panel never mounts.

## What already exists (just not wired)
- **Lookup method**: `UsersViewModel.ts:763` `checkEmailStatus(email)` → `SupabaseUserQueryService.ts:777-910` calls `check_user_org_membership` (derives `is_active ? 'active_member' : 'deactivated'`), `check_pending_invitation`, `check_user_exists`.
- **Status union**: `types/user.types.ts:458-464` — `not_found | pending | expired | active_member | deactivated | other_org`.
- **UI config**: `components/users/UserFormFields.tsx:176-234` (`EMAIL_STATUS_CONFIG`) — per-status message, panel color, action button, and `shouldDisableFields` (lines 388-393: only `active_member`/`pending` lock the form). Deactivated → gray panel, *"This user was deactivated."*, "Reactivate User" button, fields NOT disabled.

## Proposed
Replace the stub with a debounced lookup that populates `emailLookupResult` (and toggles `isCheckingEmail`). Reuse the existing `useDebounce`/`useSearchDebounce` hook + `TIMINGS.debounce` per `frontend/CLAUDE.md`. Fail-closed on lookup error (show nothing, never block submit). No new UI needed — the feedback component + config already exist.

## Decisions to make
- **Trigger**: onBlur vs debounced onChange (min length + `@` present). Debounced-onChange gives live feedback; onBlur is cheaper.
- **Submit-button relabel**: keep static "Send Invitation", or relabel per status ("Reactivate & Add" / "Add to Organization")? (Backend routing is authoritative either way; this is UX honesty.) Coordinate with the `suggestedAction` wiring already present at `UsersManagePage.tsx:824+`.
- **Perf**: 3 RPCs per lookup — acceptable on blur/debounce; confirm no N+1 on rapid typing (debounce covers it).

## Verification
- Enter each fixture email (S1–S6 set) → correct panel renders (new/pending/deactivated/active-member/other-org), `active_member`+`pending` disable fields, others don't.
- Lookup failure → no panel, submit still works.
- `npm run typecheck && npm run lint && npm run build` green; add a ViewModel unit test for the debounced-lookup → status mapping.

## Not started. Low-MED priority — pure UX/defense-in-depth; backend routing already correct and confirmed by UAT.
