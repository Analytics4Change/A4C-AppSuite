---
status: implemented-pending-review
last_updated: 2026-07-30
---

# PR E — uniqueness on the normalized email

> ## Implementation record (2026-07-30) — branch `feat/email-uniqueness-constraints`
>
> Both indexes are **deployed to dev** with the intended partial predicates
> (`20260730125034_email_uniqueness_constraints.sql`). Creating them proved no
> existing row violates either.
>
> **The blocker is closed in the Edge Function, not the handler.**
> `handle_invitation_resent` is unchanged; `invite-user` now refuses a resend of
> an *expired* invitation that a pending one has superseded (409, pointing the
> admin at the live invitation) and fails **closed** on a probe error (503).
> Extracted as the exported `checkResendSupersede` so the branch is reachable
> from tests at all — the repo's known "`index.ts` branching only reachable via
> `serve()`" gap. 4 tests added; suite 133 → 137.
>
> **E4's premise was wrong and the mitigation was NOT retired.** The card
> expected `uq_users_email_normalized` to retire the `ORDER BY u.is_active DESC,
> u.created_at` dedup in `api.check_user_org_membership`. It does not: the index
> is **partial** (`WHERE deleted_at IS NULL`) and that query does **not** filter
> `deleted_at`, so a soft-deleted row can still share an address with a live one
> — 2 soft-deleted rows exist on dev today. The `INNER JOIN
> user_roles_projection` also fans out one row per role held. Retiring the
> ORDER BY would have reintroduced exactly the bug it was added for.
> `20260730125941_narrow_membership_dedup_rationale.sql` corrects the now-false
> comment premise ("There is no unique index on email on this table") and keeps
> the mitigation.
>
> **Probe lesson.** The behavioural probe creates its **own** throwaway org.
> `invitations_projection.organization_id` is FK-constrained, so a synthetic uuid
> raised `foreign_key_violation` — not `unique_violation`, so the inner handlers
> did not catch it and the migration aborted. The org is typed `platform_owner`
> because `chk_subdomain_conditional` demands a non-null `subdomain_status` for
> every type where `is_subdomain_required()` is true, and `platform_owner` is the
> one where it is false. Creating the fixture also keeps the probe meaningful on
> a **fresh CI container**, which has no organizations at all.
>
> **Still open**: architect review, then UAT.

**Origin**: split out of PR D (`20260730045737_normalize_email_at_the_source.sql`)
on the architect's recommendation. The user chose "normalize + unique"; this is
the sequencing, not a descope.

**Gate**: merge only after **probe P3** confirms the `invite-user` read-back is
live in the **deployed** Edge Function. Migrations and Edge Functions deploy via
independent GitHub workflows with no ordering guarantee, and P3 is the
verification these indexes depend on.

## Why it could not ship with PR D

A CHECK violation is made unreachable by PR D's BEFORE-row trigger. A
**uniqueness** violation cannot be — a duplicate is a real condition, not a
formatting slip.

And per `infrastructure/supabase/CLAUDE.md`, `process_domain_event` catches
handler exceptions with `EXCEPTION WHEN OTHERS`, writes `processing_error`, and
does **not** re-raise. So a 23505 inside `handle_user_invited` used to produce
200 OK + an invitation email + no row. PR D added read-backs at all three
`invite-user` emit sites and in the Temporal `emitEvent` funnel, which is what
turns a duplicate into a visible error instead of a silent dead invitation.

## The indexes

```sql
CREATE UNIQUE INDEX uq_users_email_normalized
  ON public.users (btrim(lower(email))) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_invitations_pending_org_email
  ON public.invitations_projection (organization_id, btrim(lower(email)))
  WHERE status = 'pending';
```

Both predicates are load-bearing, not decoration:

- **`WHERE deleted_at IS NULL`** — `handle_user_deleted.sql:13` soft-deletes and
  **retains the email**. `public.users.id = auth.users.id`, and org cleanup
  deletes auth users, so "user deleted, signs up again at the same address"
  yields a second row with the same email. A full index turns that into a
  `unique_violation` inside `handle_user_created`, on the accept path. It is also
  the filter `api.check_user_exists` already applies.
- **`WHERE status = 'pending'`** — re-inviting after a revoke or accept must stay
  legal, and it is what makes the index land clean (the 3 duplicate pairs on dev
  are all `accepted`+`revoked`). Not new policy: `invite-user:219` already calls
  `check_pending_invitation` and branches to resend. The index turns a
  TOCTOU-prone service check into a real constraint.

Keep the expression form rather than plain `(email)` so the indexes survive the
CHECK being dropped. Keep `idx_users_email_lower` unpartitioned —
`check_user_org_membership` does not filter `deleted_at`.

## ⚠️ Blocker to clear FIRST — `expired → resend → 23505`

Verified during PR D. `handle_invitation_resent.sql:7-13`:

```sql
UPDATE invitations_projection SET
  token = ..., expires_at = ..., status = 'pending', updated_at = ...
WHERE invitation_id = safe_jsonb_extract_uuid(p_event.event_data, 'invitation_id');
```

`status = 'pending'` **unconditionally**, keyed on `invitation_id`, with no
awareness of any other row. `invite-user:833-845` refuses `accepted` and
`revoked` — but **not `expired`**. So:

1. Invitation A for `bob@x` expires.
2. Admin invites `bob@x` again → `check_pending_invitation` finds nothing (A is
   expired) → creates pending invitation B.
3. Admin resends A → A flips to `pending` → collides with B.

Two ordinary steps, no race required. Fix in the same style as the two existing
guards: extend the refusal set to cover an expired invitation superseded by a
newer pending one for the same address.

Also note `ON CONFLICT (invitation_id)` cannot absorb a violation of a
**non-arbiter** unique index — that applies to `handle_user_invited.sql:41` as
much as to the resend path.

## Also in scope

- **Orphan pre-flight**: 3 `public.users` rows have no `auth.users` identity and
  `deleted_at IS NULL`, so they participate in the unique index. See
  `stale-uat-fixture-users-without-auth-identity.md`. PR D's A2 assertion already
  reports the count via LEFT JOIN.
- **Behavioural probes** replacing structural assertions: insert two pending rows
  for one `(org, normalized email)` and assert 23505; flip one to `revoked` and
  assert the insert now succeeds. That tests the **partial predicate** — the part
  most likely to be wrong, and the part no `indexdef` check can reach.
- Retire the `ORDER BY u.is_active DESC, u.created_at` mitigation comment in
  `check_user_org_membership` and close F7.

## ⚠️ Known future interaction — SSO

`auth.users` enforces email uniqueness only `WHERE is_sso_user = false`,
deliberately: two SAML identities can legitimately share an address. Today 0 SSO
users and 0 configured providers, but SAML 2.0 is in the component map. Whoever
wires SSO must revisit `uq_users_email_normalized`. Flagged in the PR D migration
header too.

## Related

- `normalize-email-at-the-source.md` — PR D, resolved
- `vacuous-self-assertions-in-migrations.md` — still open
- PR D findings F5 (partial predicates), F7 (uniqueness), F8 (orphans)
