# Consolidate email sending onto one sanctioned async (Temporal) path

**Status**: seed (not yet planned)
**Priority**: Medium — architectural debt + unblocks per-event informational emails (e.g. role-assignment notification deferred from the invite-user epic PR 3).
**Origin**: invite-user epic PR 3 (`invite-user-route-existing-users-to-role-assign`, 2026-06-23). PR 3 deferred a "you've been added to {org}" email after discovering email-sending is scattered across two unrelated Resend integrations.

## Problem — two separate Resend implementations, one of them an anti-pattern

A4C's sanctioned pattern for side-effects (email/DNS/webhooks) is **async**: AFTER-INSERT trigger on `domain_events` → `pg_notify('workflow_events')` → Temporal worker → email provider (infra `CLAUDE.md` / Rule 7.2). But email is currently sent two unrelated ways:

| # | Path | Mechanism | Used for |
|---|------|-----------|----------|
| 1 | `infrastructure/supabase/supabase/functions/invite-user/index.ts:297-418` `sendInvitationEmail()` | **Synchronous, inline hand-rolled Resend HTTP client** inside the Edge Function (own template, own fetch to `api.resend.com/emails`). Violates the async side-effect rule. | API-initiated invitations + resends |
| 2 | `workflows/src/activities/organization-bootstrap/send-invitation-emails.ts:188` → `workflows/src/shared/providers/email/ResendEmailProvider` | **Async, sanctioned**: provider factory (Resend primary / SMTP fallback / mock / logging); emits `invitation.email.sent` idempotency event. | Org-bootstrap bulk invitations only |

Consequences:
- The two integrations **share no code** — the EF reimplements the Resend client and the invitation template that already exist in `workflows/`.
- The EF path is synchronous (blocks the request; no Temporal retry/idempotency).
- **Nothing emails on `user.role.assigned`** — no trigger, no workflow. Adding it the EF way would create a *third* inline Resend integration (more scatter); adding it the right way needs the generalized workflow this card builds.

## Goal — single path

One sanctioned async email path for ALL transactional email:

```
domain_events INSERT
  → AFTER-INSERT trigger (event_type in a notify-allowlist)
  → pg_notify('workflow_events', {event_type, stream_id, ...})
  → Temporal worker → generalized NotificationEmail workflow (keyed on event_type)
  → ResendEmailProvider (Resend primary / SMTP fallback / mock / logging)
  → emit '<event>.email.sent' (idempotency, mirroring invitation.email.sent)
```

## Scope

- **(a) Generalized notification workflow + trigger.** A workflow that maps `event_type` → template + recipient resolution, reusing `ResendEmailProvider`. One AFTER-INSERT trigger (or extend the existing notify trigger) with an event-type allowlist. Idempotency via a `*.email.sent` event per send (precedent: `invitation.email.sent`).
- **(b) Migrate `invite-user`'s synchronous `sendInvitationEmail` onto it** and retire the inline Resend client + duplicate template. **Risk/gate**: this changes invitation-email delivery from sync→async; `accept-invitation` depends on the token email reaching the user, so async delivery latency + reliability (and failure surfacing) must be proven before cutover. Consider keeping the EF send as a fallback during a transition window, or a feature flag.
- **(c) Add the `user.role.assigned` "you've been added to {org}" email** as the first NEW consumer of the generalized workflow (the email deferred from PR 3). Template: informational, no token, no acceptance ceremony. Recipient: the assigned user; subject "You've been added to {org name}".

## Out of scope / open questions

- Whether to also fold DNS/webhook side-effects through the same generalized notifier (probably no — keep to email).
- Recipient-resolution for events that don't carry an email in `event_data` (may need an `api.*` read RPC the workflow calls).
- Per-user notification preferences (does the user want assignment emails?) — check `user.notification_preferences` before sending.
- SMTP-fallback parity for the EF-originated invitation template once migrated.

## Interaction with `invitation-resend-token-rotation-dead-links` (added 2026-07-31)

**These are separate cards. Sequence them; do not merge them.** The token card should
land FIRST.

They sit at different tiers — that one is token lifecycle + pre-auth error reporting,
this one is side-effect transport — and neither fix delivers the other. Fixing the
token message needs no change to email delivery; moving email to Temporal leaves the
rotation and the misleading "Invitation not found" exactly as they are.

**But this card makes that defect materially worse, which is why the order matters.**
`handle_invitation_resent` overwrites `invitations_projection.token` in place, so every
resend kills all previously emailed links. Today `sendInvitationEmail` is
**synchronous** and runs immediately after the read-back, so token rotation and email
delivery are effectively atomic from the admin's point of view: by the time the resend
reports success, the replacement email is out.

Going async breaks that coupling:

- **A dead-link window opens.** Between the projection write and the queued email
  landing, the recipient's older link is already dead and its replacement has not
  arrived. Today that window is ~0; under async it is however long the queue takes.
- **A failed/retrying workflow makes it unbounded.** The old token stays dead
  indefinitely while no new email ever arrives — and the only user-visible symptom is
  `Invitation not found`, which says nothing about a replacement being in flight.

That failure is very hard to diagnose from the recipient's side, and it is exactly the
sort of thing the async cutover gate in scope (b) exists to catch. Landing the token
card first (even just its cheap copy-only option) means the async migration degrades
into an honest message rather than a lie.

**Add to this card's cutover gate**: the invitation-email path must not go async until
a superseded/stale link produces an accurate message.

## Dependencies / sequencing

- **`invitation-resend-token-rotation-dead-links` should land before scope (b)** — see
  the Interaction section above.
- Independent of the rest of the invite-user epic (PR 3 ships without it). Can be scheduled whenever.
- Touches all three components (infra trigger, workflows, and removes EF code) → likely its own multi-step PR with workflow replay tests + a deploy plan for the worker.

## Files involved (initial)

- `workflows/src/workflows/` — new generalized notification workflow
- `workflows/src/activities/` — reuse `send-invitation-emails.ts` pattern / `ResendEmailProvider`
- `workflows/src/shared/providers/email/` — provider abstraction (reuse as-is)
- `infrastructure/supabase/handlers/trigger/` — notify trigger (extend or add) + reference file
- `infrastructure/supabase/supabase/functions/invite-user/index.ts` — retire `sendInvitationEmail` inline client (phase b)
- `infrastructure/supabase/contracts/asyncapi.yaml` — `*.email.sent` event(s) if new

## Related

- invite-user epic PR 3 (origin) — `dev/active/invite-user-route-existing-users-to-role-assign/`
- `documentation/infrastructure/patterns/event-processing-patterns.md` — sync trigger vs async pg_notify decision guide
- `documentation/workflows/guides/resend-email-provider.md` — provider config
