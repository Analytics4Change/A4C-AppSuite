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
// frontend/src/pages/users/UsersManagePage.tsx:929 (line refs refreshed 2026-07-29)
onEmailBlur={() => {
  // Email lookup integration - for now just mark as touched
  formViewModel.touchField('email');
}}
```
It calls `touchField('email')` but **not** `checkEmailStatus(email)`, so `formViewModel.emailLookupResult` stays `null` and the `EmailLookupFeedback` panel never mounts.

## What already exists (just not wired)

> **Line refs refreshed 2026-07-29 after PR A.** PR A rewrote the service method and
> reshaped the types, so the pre-PR-A refs below were stale.

- **Lookup method**: `UsersViewModel.ts:779` `checkEmailStatus(email)` → `SupabaseUserQueryService.ts:816-936` calls `check_user_org_membership` (derives `is_active ? 'active_member' : 'deactivated'`), `check_pending_invitation`, `check_user_exists`. **Both RPCs are now tenancy-guarded** — see the backend-dependency section below.
- **Status types** (reshaped by PR A): `types/user.types.ts:458` `EmailLookupVerdict` = the six real answers; `:481` `EmailLookupStatus` = those plus `lookup_failed`. `EmailLookupResult` is now a **discriminated union** — the `lookup_failed` variant carries no `userId`/`invitationId`/name fields at all, so leaking identity for a failed lookup is a compile error rather than a review catch.
- **UI config**: `components/users/UserFormFields.tsx:176` (`EMAIL_STATUS_CONFIG`) — per-status message, panel color, optional action button, and `shouldDisableFields` (`:419`: only `active_member`/`pending` lock the form). Deactivated → gray panel, *"This user was deactivated."*, **no** action button (PR A removed it: a standalone Reactivate would skip the roles the admin just selected). `lookup_failed` → orange panel, no button — PR B should add the "Try again" label **and** its handler together.

## Proposed
Replace the stub with a debounced lookup that populates `emailLookupResult` (and toggles `isCheckingEmail`). Reuse the existing `useDebounce`/`useSearchDebounce` hook + `TIMINGS.debounce` per `frontend/CLAUDE.md`. Fail-closed on lookup error (show nothing, never block submit). No new UI needed — the feedback component + config already exist.

## Decisions to make
- ~~**Trigger**: onBlur vs debounced onChange.~~ **RESOLVED (PR A planning, 2026-07-29): onBlur.** One lookup is up to 3 sequential RPCs, and post-guard those are membership probes we do not want firing per keystroke. Reuses the `onEmailBlur` prop + `handleEmailBlur` that already exist. This **reverses** the §Proposed recommendation above (debounced) — noted here so the reversal is deliberate, not lost.
- ~~**Fail-closed on lookup error (show nothing)**.~~ **RESOLVED (PR A, 2026-07-29): show an orange "couldn't check" panel instead.** Showing nothing is indistinguishable from "not looked up yet"; the panel says plainly that the check failed and that submit still works. Follows `MedicationStatusIndicator.tsx:63-68`. Also a reversal of §Proposed.
- **Submit-button relabel**: keep static "Send Invitation", or relabel per status? (Backend routing is authoritative either way; this is UX honesty.) NOTE (updated for PR B): `onSuggestedAction` IS wired, but for **retry only**. `pending` / `expired` / `active_member` / `deactivated` / `other_org` all carry `actionLabel: undefined` — resend needs id-parameterised handlers, View User needs discard semantics, `addUserToOrganization` is a not-implemented stub, and a standalone Reactivate would skip the selected roles. Seeded separately.
- **Perf**: 3 RPCs per lookup — acceptable on blur.

## ⚠️ Backend dependency added by PR A (2026-07-29)

`api.check_user_org_membership` and `api.check_pending_invitation` are now
**tenancy-guarded** (`20260729184125_guard_email_lookup_rpcs.sql`). Before that
migration both were callable by `anon` — verified live, the publishable key
returned `{"user_id":…,"is_active":true}` for an arbitrary email/org pair.

**What this means for the UI work**: the lookup now depends on the caller being
recognised as a member of `p_org_id` via `users.accessible_organizations`. That
branch is **the one path not yet exercised end-to-end** — the service-role
(Edge Function) and anon-denied paths were both probed post-apply. PR B (#105)
replaced the stub, so this path is now **reachable and awaiting its first real
exercise**.

**Diagnostic if it is broken**: a denied caller gets RETURN-empty, not an error.
So membership returns `[]`, pending returns `[]`, and the unguarded
`check_user_exists` still matches — meaning **every email in your own org would
render as "This user exists but is not in this organization"** (`other_org`).
If the S1–S6 run shows that, suspect the guard's member branch, not the mapping
logic.

## Verification

> **⚠️ Fix the fixtures first.** `lars.tice+uat-deactivated@gmail.com` currently has
> `is_active = true`, so the S3 `deactivated` assertion passes vacuously against an
> `active_member` verdict. See `dev/active/stale-uat-fixture-users-without-auth-identity.md`.

- Enter each fixture email (S1–S6 set) → correct panel renders (new/pending/deactivated/active-member/other-org), `active_member`+`pending` disable fields, others don't.
- **Guard member-branch check (new)**: an `active_member` fixture must render as `active_member`, NOT `other_org`. See the diagnostic above.
- Lookup failure → orange "couldn't check" panel, submit still works, retry re-runs. Reachable in mock mode via a `lookupfail@…` address.
- **Whitespace / mixed-case fixture (NEW, dbc PR #105 F1)**: paste `"  <active-member-address>  "` with surrounding spaces. Must render `active_member`, NOT the blue "New user" panel. `validateEmail` trims before validating so there is no field error to warn you, and the RPCs compare with bare `=` — PR B trims the probe key and **PR C (`20260730032132`) made all three RPCs compare `lower(email) = lower(btrim(p_email))`** with matching functional indexes, so both halves are now handled server-side. Verified live: `TROY@…`, `Troy@…` and `"  troy@…  "` all resolve to the same member, and the tenancy guard still returns `[]` for anon.
- **Keyboard focus on retry (NEW, dbc PR #105 F2)**: tab to "Try again", activate by keyboard, confirm focus is NOT lost to `<body>` and the button disables in place rather than unmounting.
- `npm run typecheck && npm run lint && npm run build` green; add a ViewModel unit test for the lookup → status mapping.

## Status
- **PR A SHIPPED** (#103, `deeff7b5`, 2026-07-29) — service tier: `apiRpc`/api-schema fix, correlation-id threading, `lookup_failed` failure channel, Edge Function 503 fence, RPC tenancy guard. Shipped dead.
- **PR B SHIPPED** (#105, 2026-07-30) — the wireup. `onEmailBlur` now calls `UserFormViewModel.checkEmailStatus`; lookup state consolidated onto the form VM; staleness + prefilled-name revert; always-mounted live region; retry wired. `onSuggestedAction` IS now wired (retry only).
- **REMAINING: the UAT below.** That is the whole residual risk — see the fixture list.

## ⚠️ Email casing is NOT solved (added 2026-07-30, PR #106 review)

PRs #105/#106 normalized the **three lookup RPCs**. The architect's trace found at
least **five** further case-sensitive email comparisons, two of them worse than a
lookup miss:

- an **RLS policy** on `invitations_projection` that makes a mixed-case invitation
  invisible to its own invitee (authorization-visibility failure)
- `accept-invitation:534`, which can 500 `"Inconsistent auth state"` and
  **permanently wedge** an invitation
- `api.get_invitation_by_org_and_email` — still bare `=`, and the org-bootstrap
  **idempotency guard**, so it now disagrees with `check_pending_invitation` and a
  cased retry creates a duplicate

Tracked in `dev/active/normalize-email-at-the-source.md`. Do not read the UAT
fixture below as covering the problem space.
