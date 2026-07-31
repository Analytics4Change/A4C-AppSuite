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

## 2. Expected panel per fixture

`roles_in_caller_org > 0` is what makes membership match — `check_user_org_membership`
INNER JOINs `user_roles_projection`, so a **roleless** same-org user does NOT match it.

| # | Fixture | Predicted verdict | Panel | Fields locked? |
|---|---|---|---|---|
| S1 | `+uat-greenfield` | `not_found` **⚠️ unless its #85 invitation survives → `pending`/`expired`** | blue "New user" | no |
| S2 | `+test3` | `existing_user_no_roles` (same org, 0 roles) | — | no |
| S3 | `+uat-deactivated` | `deactivated` (role in caller org, `is_active=false`) | gray, **no** action button | no |
| S4 | `+uat-xorg-zombie` | `existing_user_no_roles` **⚠️ same #85 caveat as S1** | — | no |
| S5 ⭐ | `+test2` | **`active_member`** | — | **yes** |
| S6 | `+uat-xorg-member` | `other_org_member` (role in Live for Life) | — | no |

⭐ **S5 is the headline.** It is the ONLY assertion that exercises the tenancy
guard's authenticated-member branch — the one path five PRs never executed.

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

## 8. Results

| # | Verdict rendered | Expected | Pass? | Notes |
|---|---|---|---|---|
| S1 | | | | |
| S2 | | | | |
| S3 | | | | |
| S4 | | | | |
| S5 ⭐ | | | | |
| S6 | | | | |
| S7 | | | | |
| S8 | | | | |
