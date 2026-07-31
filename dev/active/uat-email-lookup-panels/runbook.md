---
status: ready-to-run — blocked on two prerequisites (see §0)
last_updated: 2026-07-31
---

# UAT runbook — invite-form email-lookup panels (epic PRs #103/#105/#106/#108/#110)

Parent: `dev/active/wireup-invite-form-email-status-lookup-seed.md`

**Distinct from `dev/archived/uat-pr85-invite-user-routing/runbook.md`.** That one
asserts what happens **after submit** (toasts, routing). This one asserts what
renders **on blur, before submit** — the lookup panel. Same fixture addresses,
different assertions. Do not conflate the two expectation tables.

## 0. Prerequisites — BOTH are currently blocking

1. **Vault unlocked** (`rbw unlock`). Needed for the §1 pre-flight snapshot and all
   backend assertions. Without it the expected-verdict table below cannot be
   confirmed, and §5/§6 cannot be set up at all.
2. **Claude-in-Chrome extension connected.** Currently reports "Browser extension is
   not connected". Needed to drive the form.
3. Logged into `https://a4c.firstovertheline.com` as an **admin of the caller org**
   (TestOrg — the org whose `org_id` lands in the JWT). The whole point of this UAT
   is the authenticated-member branch, so the session identity matters.

## 1. Pre-flight snapshot — RUN THIS FIRST, the table in §2 depends on it

⚠️ **The PR #85 UAT mutated these fixtures.** Its S1 and S4 scenarios each created a
pending invitation in the caller org. The lookup checks a pending invitation
*before* it checks user-existence, so if those invitations still exist, S1 and S4
resolve to `pending`/`expired` — **not** to `not_found`/`existing_user_no_roles`.

Do not assume the pre-#85 expectations still hold. Snapshot first:

```sql
WITH fixtures(email) AS (VALUES
  ('lars.tice+uat-greenfield@gmail.com'),
  ('lars.tice+test3@gmail.com'),
  ('lars.tice+uat-deactivated@gmail.com'),
  ('lars.tice+uat-xorg-zombie@gmail.com'),
  ('lars.tice+test2@gmail.com'),
  ('lars.tice+uat-xorg-member@gmail.com')
)
SELECT f.email,
       u.id                              AS user_id,
       u.is_active,
       u.deleted_at,
       (au.id IS NULL)                   AS is_orphan,
       (SELECT count(*) FROM user_roles_projection r WHERE r.user_id = u.id)
                                         AS roles_anywhere,
       (SELECT count(*) FROM user_roles_projection r
         WHERE r.user_id = u.id AND r.organization_id = :caller_org)
                                         AS roles_in_caller_org,
       (SELECT string_agg(i.status || '/' || (i.expires_at < now()), ',')
          FROM invitations_projection i
         WHERE i.organization_id = :caller_org
           AND btrim(lower(i.email)) = btrim(lower(f.email)))
                                         AS invitations_here
  FROM fixtures f
  LEFT JOIN public.users u ON btrim(lower(u.email)) = btrim(lower(f.email))
  LEFT JOIN auth.users au ON au.id = u.id
 ORDER BY f.email;
```

Derive each expected verdict from the snapshot using §3's decision order, then fill
in §2. **If a snapshot row contradicts §2, the snapshot wins** — §2 is a prediction.

## 2. Expected panel per fixture — DERIVED FROM LIVE SNAPSHOT 2026-07-31

**Caller org = `TestOrg-20260329`** (`2d0829ae-224b-4a79-ac3a-726b00d6c172`, provider,
subdomain verified). Snapshot taken 2026-07-31; re-run §1 if anything has moved.

`roles_in_caller_org > 0` is what makes membership match — `check_user_org_membership`
INNER JOINs `user_roles_projection`, so a **roleless** same-org user does NOT match it.

| # | Fixture | Live state | **Verdict** | Fields locked? |
|---|---|---|---|---|
| S1 | `+uat-greenfield` | no `users` row; **`pending` invitation from 2026-07-01, date-expired** | **`expired`** | no |
| S2 | `+test3` | role in TestOrg (Aspen Med Viewer), active | **`active_member`** | **yes** |
| S3 | `+uat-deactivated` | role in TestOrg, `is_active=false`, orphan | **`deactivated`** | no |
| S4 | `+uat-xorg-zombie` | 0 roles anywhere; **`pending` invitation from 2026-07-01, date-expired** | **`expired`** | no |
| S5 ⭐ | `+test2` | role in TestOrg (Sequoia Med Admin), active | **`active_member`** | **yes** |
| S6 | `+uat-xorg-member` | role in **Live for Life** only, orphan | **`other_org_member`** | no |
| S9 | any never-seen address, e.g. `lars.tice+uat-lookup-fresh@gmail.com` | nothing anywhere | **`not_found`** | no |

⭐ **S5 is the headline.** The only assertion exercising the tenancy guard's
authenticated-member branch — the path five PRs never executed.

### ⚠️ Three predictions changed against the pre-run guesses. Read this before judging a failure.

- **S1 and S4 are `expired`, NOT `not_found` / `existing_user_no_roles`.** The
  PR #85 run left both a `status='pending'` invitation in TestOrg dated 2026-07-01,
  and the lookup checks pending invitations at step 2 — *before* user-existence at
  step 3. Both rows are past `expires_at`, so the verdict resolves `expired`.
- **S2 is `active_member`, NOT `existing_user_no_roles`.** The PR #85 S2 scenario
  *assigned it a role* (its whole point: 0→1 in `user_roles_projection`). The
  "same-org roleless" description is pre-#85 and no longer true.

None of these is a defect. Judging S1/S2/S4 against the stale table would produce
three false failures.

### Coverage gap this leaves, and the zero-mutation fix

As it stands the six fixtures cover only four of seven verdicts —
`expired`, `active_member`, `deactivated`, `other_org_member`. Missing: `not_found`,
`pending`, `lookup_failed`.

Rather than mutate dev data to restore S1/S4:

- **`not_found`** → S9 above: any address never seen before. No setup.
- **`pending`** → falls out of the §5 S7 setup for free (invitation B is pending).
- **`lookup_failed`** → §7, mock mode via a `lookupfail@…` address.

## 3. Verdict decision order (from `SupabaseUserQueryService.checkEmailStatus`)

1. `check_user_org_membership` → row? `is_active ? active_member : deactivated`
2. `check_pending_invitation` → row? `expires_at < now() ? expired : pending`
3. `check_user_exists` → row? then `check_user_has_any_role` →
   `false ? existing_user_no_roles : other_org_member`
4. otherwise → `not_found`

Any RPC **error** short-circuits to `lookup_failed` (orange panel). Errors never fall
through to `not_found` — that fence is the whole point of PR A.

## 4. ⚠️ The diagnostic that matters most

A denied caller gets **RETURN-empty, not an error**. So if the guard's member branch
is broken: membership `[]` → pending `[]` → unguarded `check_user_exists` still
matches → **every email in your own org renders `other_org`.**

**If S5 shows `other_org` instead of `active_member`, suspect the tenancy guard's
member branch — not the mapping logic.** The mapping is unit-tested; the guard's
member branch has never run. This is the single most likely failure of the whole run
and it is designed to look like something else.

Confirm via `users.accessible_organizations @> ARRAY[<caller_org>]::uuid[]` for the
signed-in user.

## 5. S7 — resend supersede refusal (NEW, PR #110)

Needs DB access to force the expiry. Sequence:

1. Invite `lars.tice+uat-supersede@gmail.com` → invitation **A**, pending.
2. Expire A: `UPDATE invitations_projection SET status='expired' WHERE id = <A>;`
   (Setting `status` directly is acceptable **for fixture setup only** — the app
   path uses `emitExpirationEvent`.)
3. Invite the same address again → invitation **B** is created, pending.
4. **Resend A.**

**Expect 409**, `code: 'INVITATION_SUPERSEDED'`, `errorDetails.supersedingInvitationId`
= B's id. Assert **no second pending row**:

```sql
SELECT id, status FROM invitations_projection
 WHERE organization_id = :caller_org
   AND btrim(lower(email)) = 'lars.tice+uat-supersede@gmail.com';
-- exactly ONE row with status='pending'
```

Then the **narrowness** check: resend an expired invitation that has NOT been
superseded → must still succeed. A guard that blocks this is over-broad.

## 6. S8 — accept-path orphan collision (NEW, PR #110) — failure is the pass

The three orphans (`+uat-xorg-zombie`, `+uat-xorg-member`, `+uat-deactivated`) have
`deleted_at IS NULL`, so they participate in `uq_users_email_normalized`.

Invite one of those addresses **from a different org** and accept it. `handle_user_created`
raises 23505 (the new auth id differs from the orphan's id, so `ON CONFLICT (id)`
cannot absorb it) and `accept-invitation` now reads that back.

**Expect HTTP 500 `PROCESSING_FAILED`.** Pre-PR-E this returned **200 OK** with a
working login and no `public.users` row. A 500 here is the fix working; **a 2xx means
the read-back regressed.**

```sql
-- the auth user must NOT have gained a users row
SELECT count(*) FROM public.users WHERE btrim(lower(email)) = '<orphan address>';
-- still 1 (the orphan), not 2
```

Cleaning up the orphans removes the failure →
`dev/active/stale-uat-fixture-users-without-auth-identity.md`.

## 7. Additional checks carried from the parent card

- **Whitespace / mixed-case**: paste `"  <S5 address>  "` with surrounding spaces →
  must render `active_member`, not blue "New user". `validateEmail` trims before
  validating, so there is no field error to warn you.
- **Lookup failure**: reachable in mock mode via a `lookupfail@…` address → orange
  panel, **submit still works**, retry re-runs.
- **Keyboard focus on retry**: tab to "Try again", activate by keyboard → focus must
  not fall to `<body>`; the button disables in place rather than unmounting.
- **Live region**: the `role="status"` wrapper is always mounted (PR B B4), so a
  screen reader announces the panel. Verify a result is actually announced.

## 8. Results — S1–S6 + S9 RUN 2026-07-31 ✅ ALL PASS

Run as `johnltice@yahoo.com` (provider_admin, TestOrg-20260329) at
`https://testorg-20260329.firstovertheline.com/users/manage?mode=create`.
Verdict read from `data-testid`, not inferred from copy.

| # | Fixture | Expected | `data-testid` | Fields locked | Pass |
|---|---|---|---|---|---|
| S1 | `+uat-greenfield` | `expired` | `email-lookup-expired` | no | ✅ |
| S2 | `+test3` | `active_member` | `email-lookup-active_member` | **yes** | ✅ |
| S3 | `+uat-deactivated` | `deactivated` | `email-lookup-deactivated` | no | ✅ |
| S4 | `+uat-xorg-zombie` | `expired` | `email-lookup-expired` | no | ✅ |
| S5 ⭐ | `+test2` | `active_member` | `email-lookup-active_member` | **yes**, submit disabled | ✅ |
| S6 | `+uat-xorg-member` | `other_org` | `email-lookup-other_org` | no | ✅ |
| S9 | fresh address | `not_found` | `email-lookup-not_found` | no | ✅ |
| §7 | `"   LARS.TICE+Test2@GMail.COM   "` | `active_member` | `email-lookup-active_member` | **yes** | ✅ |

**⭐ S5 — the tenancy guard's authenticated-member branch executed correctly for the
first time.** It rendered `active_member`, not `other_org`. S2 corroborates
independently: both require `check_user_org_membership` to return a row, which only
happens if the guard admitted the caller. The disguised failure mode described in §4
did not occur.

The mixed-case + surrounding-whitespace probe resolving to `active_member` exercises
the full PR C + PR D chain end-to-end through the UI — the field trimmed to
`"LARS.TICE+Test2@GMail.COM"` and still matched the member.

Console: clean. All 41 messages came from an unrelated Chrome extension content
script (`chrome-extension://pejdij…`), none from the app.

### Correction to §2's predicted vocabulary

§2 predicted `other_org_member` for S6. That verdict does not exist in the frontend.
`EmailLookupVerdict` has exactly six members and the correct one is **`other_org`**.
`SupabaseUserQueryService.ts:908` documents the deliberate gap: the Edge Function
splits this case (`other_org_member` vs a roleless zombie) via
`check_user_has_any_role`, and the frontend union intentionally does not — the known
R1 limitation. So `existing_user_no_roles`, which earlier drafts of this card
predicted for S2/S4, was never a reachable frontend verdict at all.

## 9. S7 — resend supersede refusal — RUN 2026-07-31 ✅ PASS (both halves)

Fixture: `lars.tice+uat-supersede@gmail.com`, created fresh. No existing fixture touched.

| Step | Action | Result |
|---|---|---|
| 1 | Invite via UI → **A** `141ccb64…` (`invitation_id` `99211150…`) | pending |
| 2 | `UPDATE invitations_projection SET status='expired' WHERE id=A` | expired |
| 3 | Invite same address again → **B** `ec0d912c…` | pending |
| 4 | **Resend A** (roster card → "Send New Invitation" → confirm) | **REFUSED** ✅ |

Banner (assertive) + toast echo: *"A newer invitation is already pending for that
address. Resend the current invitation instead."* — the EF's exact
`INVITATION_SUPERSEDED` copy.

**The assertion that matters**: after the refusal, A was still `expired` with
`updated_at` unchanged from step 2, and B still `pending`. **Exactly one pending row
throughout.** The 23505 never happened, because the refusal came at the wire rather
than in the handler where it would have been swallowed.

### Narrowness half — the guard must not be over-broad

| Step | Action | Result |
|---|---|---|
| 5 | Revoke B | revoked |
| 6 | **Resend A** again, now with no competing pending row | **SUCCEEDED** ✅ |

A flipped `expired` → `pending` (16:00:23) and the card gained Resend/Revoke. So the
guard refuses only the actual collision; a legitimate resend of an expired invitation
still works.

### Decisive negative check

```sql
SELECT event_type, processing_error FROM domain_events
 WHERE created_at > now() - interval '25 minutes' AND processing_error IS NOT NULL;
-- [] — zero rows
```

**No silent handler failure at any point.** Had the guard let step 4 through, this is
where the swallowed 23505 would have surfaced.

## 10. Bonus — `pending` verdict (S10) ✅

With A back to `pending`, the lookup was re-run against it:
`email-lookup-pending`, *"This email has a pending invitation."*, fields locked.

**Verdict coverage now complete for all six real verdicts**: `not_found`, `pending`,
`expired`, `active_member`, `deactivated`, `other_org`. Only `lookup_failed` is
unexercised against a real backend — it is reachable in mock mode only, by design.

### Leftover fixture state

`lars.tice+uat-supersede@gmail.com` has **A pending** and **B revoked** in
TestOrg-20260329. Harmless, and A doubles as a durable `pending` fixture. Revoke A if
a clean roster is wanted.

### Remaining

- **S8** (§6) — accept-path orphan collision. Not run: needs a real invitation-accept
  through an emailed token, which permanently consumes an invitation.
