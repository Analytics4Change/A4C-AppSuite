---
status: seed
last_updated: 2026-07-30
---

# Seed: case-normalize the email comparison in the lookup RPCs

**Origin**: `software-architect-dbc` review of PR #105, finding F1. PR B fixed the
**whitespace** half; this is the **case** half, which could not be fixed safely
without a DB check.

**Priority**: Medium. Same false-green class as the bug PR A exists to prevent.

## Problem

The three lookup RPCs compare with bare equality:

- `20260729184125_guard_email_lookup_rpcs.sql:157` — `WHERE u.email = p_email`
- `:194` — `WHERE ip.email = p_email`
- `check_user_exists` — same shape

Nothing in the codebase normalizes email case on write. So if `users.email` holds
`Bob@Org.com` and an admin types `bob@org.com`, all three probes return empty, and
the UI renders the confident blue *"New user — complete the form to send an
invitation"* for someone who is already an active member.

That is exactly what `SupabaseUserQueryService.checkEmailStatus`'s own contract
forbids — *"It must NOT return `not_found`, which the UI renders as a confident
'new user, go ahead and invite'"*. PR A honoured it for infrastructure failures;
this arrives through the input path instead.

## Why PR B did not just fix it

Lowercasing client-side would have **created** the mirror-image bug. With bare `=`,
sending `bob@org.com` against a stored `Bob@Org.com` fails to match — so a naive
`toLowerCase()` in the ViewModel turns "works for lowercase-stored addresses" into
"broken for mixed-case-stored ones". The vault was locked at the time, so the actual
storage convention could not be verified.

PR B therefore trimmed only (unambiguously safe: whitespace is never part of an
address, `validateEmail` already trims, and `buildRequest` submits trimmed) and left
case alone. See `UserFormViewModel.lookupKey`'s JSDoc.

## Already investigated (2026-07-30, dev project) — the answer is: fix it in SQL

| table | rows | mixed-case |
|---|---|---|
| `public.users` | 14 | **0** |
| `invitations_projection` | 18 | **0** |

All-lowercase today — but **nothing enforces it**. A constraint scan over both
tables returned no `lower(email)` CHECK (the only email-adjacent constraint found
was `auth.users.email_change_confirm_status_check`, unrelated). And only **11 of 14**
`public.users` rows match `auth.users.email` exactly, so Supabase Auth's own
normalization is not reliably propagating into the projection either.

So the lowercase property is **incidental, not guaranteed**. Client-side
`toLowerCase()` would work today and break silently the first time a mixed-case row
lands — reintroducing the same false-green from the other direction. That is why
PR B trimmed only.

**Conclusion: the fix belongs in SQL**, where it holds regardless of what is stored.
A CHECK constraint or `citext` would also work; a client-side change would not.

## SQL route

Change the comparisons to `WHERE lower(u.email) = lower(p_email)` — but that is
**not** free:

- It defeats any plain btree index on `email`. Check what exists
  (`\d users`) and add a functional index `ON users (lower(email))` in the same
  migration if one is needed, or the guarded probes become seq scans on every blur.
- Pitfall 6 applies: fetch each deployed body via Mgmt-API `pg_get_functiondef`
  and diff before `CREATE OR REPLACE`. These functions were last touched by
  `20260729184125`, which added the tenancy guard — do not drop it.
- Consider `citext` for the columns instead, which fixes every comparison at once
  rather than per-call-site. Larger change; needs its own assessment.

## Verification

- The UAT fixture added to `wireup-invite-form-email-status-lookup-seed.md`: a
  mixed-case address for a known active member must render `active_member`, not
  the blue "New user" panel.
- `EXPLAIN` the guarded probes before and after to confirm no seq scan appeared.
- The `service_role` exemption and the member-branch guard must both still behave
  — re-run PR A's probe set (`sb_secret` returns data, `sb_publishable` returns `[]`).

## Related

- `dev/active/wireup-invite-form-email-status-lookup-seed.md` — the UAT fixture
- `frontend/src/viewModels/users/UserFormViewModel.ts` — `lookupKey` accessor and
  the JSDoc recording why case was left alone
- `20260729184125_guard_email_lookup_rpcs.sql` — the guard that must survive any
  `CREATE OR REPLACE`
