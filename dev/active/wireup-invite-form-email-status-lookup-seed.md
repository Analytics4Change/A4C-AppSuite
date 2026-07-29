---
status: seed
last_updated: 2026-07-29
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
- ~~**Trigger**: onBlur vs debounced onChange.~~ **RESOLVED (PR A planning, 2026-07-29): onBlur.** One lookup is up to 3 sequential RPCs, and post-guard those are membership probes we do not want firing per keystroke. Reuses the `onEmailBlur` prop + `handleEmailBlur` that already exist. This **reverses** the §Proposed recommendation above (debounced) — noted here so the reversal is deliberate, not lost.
- ~~**Fail-closed on lookup error (show nothing)**.~~ **RESOLVED (PR A, 2026-07-29): show an orange "couldn't check" panel instead.** Showing nothing is indistinguishable from "not looked up yet"; the panel says plainly that the check failed and that submit still works. Follows `MedicationStatusIndicator.tsx:63-68`. Also a reversal of §Proposed.
- **Submit-button relabel**: keep static "Send Invitation", or relabel per status? (Backend routing is authoritative either way; this is UX honesty.) NOTE: `onSuggestedAction` is NOT wired in PR A — the `other_org` and `deactivated` action labels were removed (`addUserToOrganization` is a not-implemented stub; a standalone "Reactivate" would skip the roles the admin just selected).
- **Perf**: 3 RPCs per lookup — acceptable on blur.

## ⚠️ Backend dependency added by PR A (2026-07-29)

`api.check_user_org_membership` and `api.check_pending_invitation` are now
**tenancy-guarded** (`20260729184125_guard_email_lookup_rpcs.sql`). Before that
migration both were callable by `anon` — verified live, the publishable key
returned `{"user_id":…,"is_active":true}` for an arbitrary email/org pair.

**What this means for the UI work**: the lookup now depends on the caller being
recognised as a member of `p_org_id` via `users.accessible_organizations`. That
branch is **the one path not yet exercised end-to-end** — the service-role
(Edge Function) and anon-denied paths were both probed post-apply, but the
authenticated-member path is unreachable until this card's stub is replaced.

**Diagnostic if it is broken**: a denied caller gets RETURN-empty, not an error.
So membership returns `[]`, pending returns `[]`, and the unguarded
`check_user_exists` still matches — meaning **every email in your own org would
render as "This user exists but is not in this organization"** (`other_org`).
If the S1–S6 run shows that, suspect the guard's member branch, not the mapping
logic.

## Verification
- Enter each fixture email (S1–S6 set) → correct panel renders (new/pending/deactivated/active-member/other-org), `active_member`+`pending` disable fields, others don't.
- **Guard member-branch check (new)**: an `active_member` fixture must render as `active_member`, NOT `other_org`. See the diagnostic above.
- Lookup failure → orange "couldn't check" panel, submit still works, retry re-runs. Reachable in mock mode via a `lookupfail@…` address.
- `npm run typecheck && npm run lint && npm run build` green; add a ViewModel unit test for the lookup → status mapping.

## Status
- **PR A SHIPPED-pending-push (2026-07-29)** — service tier: `apiRpc`/api-schema fix, correlation-id threading, `lookup_failed` failure channel, Edge Function fence, RPC tenancy guard (applied to dev). Ships dead; the stub below is untouched.
- **PR B NOT STARTED** — the actual wireup. Origin stub still at `UsersManagePage.tsx` `onEmailBlur`. Low-MED priority.
