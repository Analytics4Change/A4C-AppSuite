---
status: seed
last_updated: 2026-07-31
---

# Seed: resend rotates the invitation token in place, and dead links lie about why

**Origin**: email-lookup epic UAT, S8 setup (2026-07-31). Lars clicked the link in an
older invitation email and got `Invalid Invitation / Invitation not found`. It read as
a defect in the accept flow. It was not — but what it *is* deserves fixing.

**Priority**: LOW-MED. No data corruption, no security hole. It is an honesty defect
in a pre-auth, user-facing error path — and it costs real triage time (it cost some
during the UAT).

## Mechanism — confirmed on dev, not inferred

`handle_invitation_resent` **overwrites `invitations_projection.token` in place**. Every
resend calls `generateSecureToken()` and replaces the previous value. One token column,
no history, no grace window. Every previously emailed link for that invitation dies the
moment it is resent.

Verified: the token from the older email (`_i4Gfa…`) matched **zero rows** in
`invitations_projection`. The invitation itself was alive and `pending` the whole time
under a different token. So the accept path could not find it and reported
`Invitation not found` — which is true in the narrow literal sense and misleading in
every sense that matters.

## What this is NOT — ruled out during triage, do not re-open

**Not a host/subdomain bug.** The emailed link points at the platform host
`https://a4c.firstovertheline.com/accept-invitation?token=…` rather than the tenant
subdomain, because `FRONTEND_URL` derives from `https://a4c.${PLATFORM_BASE_DOMAIN}`
(`_shared/env-schema.ts:41`) — one org-agnostic host for every tenant. That is the
obvious-looking culprit and it is **not** the cause: navigating the **platform** host
with a **valid** token renders the accept form correctly. Verified live during the UAT.

(Whether tenant invitations *should* link to the tenant subdomain is a separate
question. It is not this defect, and it is not currently broken.)

## Why it is worth fixing

Rotating the token on resend is defensible security — it limits the exposure window of
a leaked token. The **reporting** is not defensible:

- `Invitation not found` is indistinguishable from never-existed, revoked, expired, and
  superseded. Four very different situations, one message.
- Clicking the older of two invitation emails is the **common** case, not the exotic
  one. People click the first invite they find in their inbox.
- The recipient's only recovery is to guess that a newer email exists. Support has no
  better signal.

Thematically this is the mirror image of what the email-casing epic just fixed: PR E
made silent failures loud. This is a loud failure that is **inaccurately described**.

## Options (not decided — the middle one has the real design question)

1. **Copy-only, no schema change.** Soften the message: "This invitation link is no
   longer valid. If you were sent a newer invitation email, use that one." Cheapest,
   ships immediately, fixes most of the confusion. Does not let us *confirm* supersession.
2. **Distinguish superseded from not-found.** Retain prior tokens purely to classify —
   a `superseded_tokens text[]` column on the projection, or a small history table
   written by `handle_invitation_resent`. The accept path can then say "this link was
   replaced by a newer invitation" with certainty.
   ⚠️ **The real design question**: the accept page is **pre-auth**. Confirming "an
   invitation exists for this address" to an unauthenticated caller is an enumeration
   surface. A superseded-token lookup is narrower than an email lookup (the caller must
   already hold a valid-looking historical token, which is unguessable), so this is
   probably acceptable — but it needs to be decided deliberately, not assumed.
3. **Do not rotate on resend.** Keep the original token and only extend `expires_at`.
   Simplest data model, no dead links at all. Weakens the security argument for
   rotation; needs a deliberate call on whether that argument is load-bearing here.

Option 1 is a strict improvement over today regardless of which of 2/3 is chosen later,
so it is a reasonable first step even if the bigger decision is deferred.

## Relationship to `consolidate-email-onto-temporal-notification-workflow`

**Keep them separate. Sequence them — do not merge.** See that card's new "Interaction"
section. Short version: they sit at different tiers (token lifecycle + error reporting
vs. email delivery transport), and neither fix delivers the other. But moving email to
async **widens this defect's blast radius**, so this card should land first.

## Verification when picked up

- Resend an invitation, then open the link from the *previous* email. The message must
  distinguish "superseded" from "not found" (options 1/2), or the old link must still
  work (option 3).
- Whichever option: an actually-bogus token must still produce a generic failure that
  reveals nothing about whether an invitation exists.
- Regression: the current (newest) link must still accept successfully.

## Related

- `dev/archived/uat-email-lookup-panels/runbook.md` — the S8 run where this surfaced.
- `consolidate-email-onto-temporal-notification-workflow/plan.md` — sequencing.
- `stale-uat-fixture-users-without-auth-identity.md` — unrelated, but the same UAT.
