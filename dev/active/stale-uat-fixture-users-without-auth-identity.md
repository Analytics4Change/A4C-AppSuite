---
status: seed
last_updated: 2026-07-30
---

# Seed: three `public.users` rows with no auth identity — and one lies about its state

**Origin**: fallout of the PR #106 F2 investigation. I had claimed "11 of 14 rows
don't match auth"; that was wrong (11 of 11 real users match). What the query
actually turned up was **3 rows in `public.users` with no `auth.users` row at all**.

**Priority**: Low as data hygiene. **Medium as a blocker for the PR B UAT** — see
the second section.

## The rows (verified live on dev, 2026-07-30)

| id | email | `is_active` | created |
|---|---|---|---|
| `841e6e80-…` | `lars.tice+uat-xorg-zombie@gmail.com` | `true` | 2026-06-24 17:32:47 |
| `558ecba0-…` | `lars.tice+uat-xorg-member@gmail.com` | `true` | 2026-06-24 17:32:47 |
| `97b750a1-…` | `lars.tice+uat-deactivated@gmail.com` | `true` | 2026-06-24 17:32:47 |

Identical `created_at` to the microsecond — a single seed statement. These are UAT
fixtures, not production corruption. Nothing to panic about.

## ⚠️ But `uat-deactivated` is `is_active = true`

That fixture exists to exercise the `deactivated` branch of the email lookup, and it
**currently returns `active_member`**. `check_user_org_membership` derives the verdict
from `is_active` alone, so the S3 scenario in
`wireup-invite-form-email-status-lookup-seed.md` will silently test the wrong path
and pass.

Anyone running the PR B UAT should flip it first, or the "deactivated → gray panel,
no action button" assertion is vacuous.

## Secondary: `check_user_exists` sees them, the guarded RPCs may not

These rows have no auth identity, so they can never sign in — but they are real rows
in `public.users`. `api.check_user_exists` (Bucket E, unguarded) will match them. If
their `accessible_organizations` doesn't include the probing org, the lookup renders
`other_org` for an account that cannot exist. Harmless in the fixture set; worth
knowing so it isn't mistaken for the guard bug described in the UAT card's
"Diagnostic if it is broken" section.

## Options

1. **Fix the one lie** — set `uat-deactivated` to `is_active = false`. Minimum needed
   to unblock the UAT.
2. **Re-seed the fixture set properly** — give all three real `auth.users` rows so
   they behave like the accounts they are standing in for.
3. **Delete them** once the PR B UAT is done. They are not referenced by anything
   outside the UAT card.

Recommended: (1) now, (3) after the UAT.

## Verification

- `SELECT u.id, u.email, u.is_active FROM public.users u LEFT JOIN auth.users a ON a.id = u.id WHERE a.id IS NULL;`
- After (1): the lookup renders `deactivated` (gray panel, no action button) for
  `lars.tice+uat-deactivated@gmail.com`.

## Related

- `dev/active/wireup-invite-form-email-status-lookup-seed.md` — the UAT this blocks
- PR #106 F2 (the false "11 of 14" claim this replaces)

---

## Update — PR D (2026-07-30)

- **`uat-deactivated` fixture flipped to `is_active = false`.** It was the
  prerequisite for the parent UAT's S3 scenario, which would otherwise have
  asserted "deactivated" against an `active_member` verdict and passed vacuously.
- The three orphan rows are now **surfaced by assertion A2** in
  `20260730045737_normalize_email_at_the_source.sql`, which uses a LEFT JOIN
  precisely so rows with no auth identity are visible (an INNER join structurally
  cannot see them).
- They become **load-bearing in PR E**: all three have `deleted_at IS NULL`, so
  they participate in `uq_users_email_normalized`. Deleting or re-seeding them is
  now a PR E pre-flight step, not just hygiene. → `pr-e-email-uniqueness-constraints.md`
