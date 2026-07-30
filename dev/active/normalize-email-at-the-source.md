---
status: RESOLVED (PR D, 2026-07-30) — uniqueness follow-up in PR E
last_updated: 2026-07-30
---

# Seed: normalize email at the source (citext / write path), not per call site

**Origin**: `software-architect-dbc` review of PR #106 (F5, F7, F8, F11, F12). Successor
to the deleted `normalize-email-case-in-lookup-rpcs.md`, whose §"SQL route" was the
**only** record of these alternatives — deleting it lost that, which the review
called out.

**Priority**: Medium-High. **F11 is an authorization-visibility failure**, not a
lookup miss, and F12 can permanently wedge an invitation.

## The actual problem

PRs #105/#106 fixed **3 of at least 8** case-sensitive email comparisons, one call
site at a time. That is the wrong altitude. Every one of the findings below
collapses if email is normalized **at the source** instead.

`citext` is available in this project (v1.6, **not installed**).

## What remains broken

### F11 — MEDIUM-HIGH · RLS makes an invitation invisible to its own invitee

Verified live on `public.invitations_projection`:

```sql
invitations_user_own_select
USING (email = (SELECT current_setting('request.jwt.claims', true)::json ->> 'email'))
```

The JWT email comes from `auth.users` and is **Auth-lowercased**;
`invitations_projection.email` is unnormalized (the org-bootstrap path stores raw).
So **a mixed-case invitation is invisible to the person it was issued to.** This is
an authorization-visibility failure and is higher-consequence than anything the
lookup RPCs do.

### F12 — MEDIUM · `accept-invitation` can 500 and wedge an invitation permanently

`infrastructure/supabase/supabase/functions/accept-invitation/index.ts:534`

```js
const existingUser = existingUsers.users.find(u => u.email === invitation.email);
```

Case-**sensitive** compare of an Auth-lowercased `auth.users.email` against a
possibly mixed-case `invitation.email`. On the "already registered" retry branch it
finds nothing → `500 "Inconsistent auth state"`, and the invitation can **never** be
accepted. Line `:595`, 61 lines below, got the `.toLowerCase()` treatment; this one
was missed.

### F5 — LOW-MED · A fourth RPC now disagrees with the three that were fixed

`api.get_invitation_by_org_and_email` still has `WHERE i.email = p_email` — same
table, same org+email shape, untouched by #106 — and it is the **idempotency guard**
for org bootstrap (`generate-invitations.ts:79-82`,
`documentation/workflows/guides/organization-bootstrap.md:369`). It now disagrees
with `check_pending_invitation`, so **a retry with different casing creates a
duplicate invitation.**

Also `api.get_invitation_by_id` uses `i.email = v_current_user_email` as an
**authorization** predicate.

### F7 — LOW · No uniqueness, so case-insensitive matching can pick the wrong row

There is **no unique index on email** on `users` or `invitations_projection`. A
case-insensitive match can now span several rows (`Bob@x` inactive, `bob@x` active).
`20260730034703` added `ORDER BY is_active DESC, created_at` to
`check_user_org_membership` so the pick is at least deterministic and fail-safe, but
that is a mitigation, not a fix. The fix is a uniqueness constraint on the
normalized value.

### The write paths that let it happen

The org-bootstrap path has **zero** email validation or trimming at any layer:

| layer | file | trims? | validates? |
|---|---|---|---|
| Form VM | `OrganizationFormViewModel.ts:423` | **no** | no |
| Transport | `TemporalWorkflowClient.ts` | passthrough | no |
| Edge Function | `organization-bootstrap/index.ts` | — | **no regex at all** |
| Activity | `generate-invitations.ts:114` | **no** | **none in all of `workflows/src/`** |
| Handler | `handle_user_invited` | **no** | no |

Note `OrganizationFormViewModel:423` lacks the `.trim()` its sibling
`UserFormViewModel` has. By contrast `invite-user/index.ts:956` applies
`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, which rejects surrounding whitespace with a 400 —
accidental protection, and only on that one path.

## Options

1. **`citext`** on `users.email` and `invitations_projection.email`. Fixes every
   comparison at once — including the RLS policy (F11) and both untouched RPCs
   (F5) — without editing any of them. Type change on columns that projections, an
   auth sync, and an RLS policy all touch; needs its own assessment.
2. **Normalize at the write path** — trim+lower in the handlers and/or a
   `BEFORE INSERT/UPDATE` trigger. Leaves comparisons alone but requires a backfill
   and does not stop a future writer bypassing it.
3. **CHECK constraint** `email = lower(btrim(email))` — makes the invariant
   enforced and loud, and would have prevented this whole class. Needs the same
   backfill and will reject writes until every path normalizes.
4. **Keep patching call sites** — the status quo. Five known sites left, and the
   next reviewer finds the sixth.

**Recommended: (3) + (1) or (2).** The CHECK is what turns "incidental" into
"guaranteed" — the property PR #106's investigation found missing.

## Verification

- The F11 RLS policy: a mixed-case invitation is visible to its invitee.
- F12: the accept-invitation "already registered" retry branch succeeds against a
  mixed-case invitation instead of 500ing.
- F5: an org-bootstrap retry with different casing does **not** create a duplicate.
- Existing probe set from #106 still green (service_role 4/4 across case+whitespace,
  anon `[]` on both guarded RPCs, `check_user_exists` open per Bucket E).
- If uniqueness lands: no duplicate-normalized-email rows survive the backfill.

## Related

- `20260730032132` + `20260730034703` — the three RPCs already normalized
- `dev/active/extract-email-lookup-controller.md` — if this lands first,
  `UserFormViewModel.lookupKey` may disappear rather than move
- PR #105 F1, PR #106 F1/F5/F7/F8/F11/F12


---

## RESOLVED — PR D (2026-07-30)

`20260730045737_normalize_email_at_the_source.sql` establishes the property this
card asked for, plus the wire-tier fixes that made it safe to establish.

**What shipped**

- BEFORE-row trigger `a_normalize_email_before_write` on `users` and
  `invitations_projection` canonicalizing every write to `btrim(lower(email))`,
  paired with `chk_users_email_normalized` / `chk_invitations_email_normalized`.
- F11 (RLS `invitations_user_own_select`), F5 (`get_invitation_by_org_and_email`
  **and** `get_invitation_by_id`) normalized — symmetric form, matching #106.
- F12 (`accept-invitation:534`) fixed via an extracted, tested
  `findAuthUserByEmail`.
- Frontend: `OrganizationFormViewModel`, `organization-validation` (both the
  raw-value regex test and the case-sensitive confirmation compare),
  `InvitationAcceptanceViewModel`, `LoginPage`, `UserFormViewModel.isDirty`.
- Temporal: normalization in `generate-invitations`, and a read-back in
  `emitEvent` covering the whole activity tier.

**The citext decision — recorded here because the deleted predecessor lost it once**

Rejected, on three grounds:

1. **It does not trim.** `'  a@b.com  '::citext <> 'a@b.com'::citext`, and
   trimming is half the bug.
2. **It would silently gut the CHECK.** Under citext,
   `email = btrim(lower(email))` evaluates TRUE for a mixed-case value, because
   `=` is case-insensitive. The constraint would read as if it enforced both
   properties while enforcing only one.
3. **It cannot reach `accept-invitation:534`** — a JavaScript `===` against the
   Auth admin API, which no SQL operator touches.

Also blocking: `ALTER COLUMN ... TYPE citext` fails while
`public.event_history_by_entity` projects `users.email`, and `supabase gen types`
emits `unknown` for extension types (`ltree` precedent at
`database.types.ts:160,525`).

**What did NOT ship — F7 uniqueness → PR E**

A CHECK violation can be made unreachable by the trigger; a **uniqueness**
violation cannot, because a duplicate is a real condition. And per
`infrastructure/supabase/CLAUDE.md`, a handler exception is absorbed into
`processing_error` without re-raising — so a 23505 inside `handle_user_invited`
degrades to a silent no-row failure. PR D adds the read-backs that turn that into
a visible error; PR E adds the indexes once probe P3 confirms those read-backs
are live in the **deployed** Edge Function.

PR E scope: `uq_users_email_normalized` (`WHERE deleted_at IS NULL` —
`handle_user_deleted.sql:13` soft-deletes and retains the email),
`uq_invitations_pending_org_email` (`WHERE status = 'pending'`), the orphan
pre-flight, behavioural probes for the partial predicates, and a guard for the
`expired → resend → 23505` sequence described below.

**Blocker PR E must clear first (verified during PR D)**

`handle_invitation_resent.sql:7-13` sets `status = 'pending'` unconditionally.
`invite-user:833-845` refuses to resend `accepted` and `revoked` invitations but
**not `expired`** ones. So: invitation A expires → B is created (pending) →
someone resends A → A flips to pending → two pending rows for the same
`(org, normalized email)`. Two ordinary steps, no race.
