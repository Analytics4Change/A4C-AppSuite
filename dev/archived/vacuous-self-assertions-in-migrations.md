---
status: SUPERSEDED by #114 (2026-08-01) — do not work this card
last_updated: 2026-08-01
---

> ## ⚠️ SUPERSEDED — see issue #114
>
> Folded into #114's pitfall reform. The taxonomy is right; the remedy is to make entries terminate in a mechanism rather than to catalogue more species.
>
> Retained for its analysis and evidence, which fed the invitation-lifecycle
> retrospective. **Do not implement from this card** — the approach it describes
> treats a symptom that #114 removes structurally.

# Seed: migration assertions that check what the same migration just wrote

**Origin**: `software-architect-dbc` review of PR #106, finding F3.

**Priority**: Low. No runtime effect — but these assertions read as safety and provide
none, which is worse than their absence.

> ## A subtler variant found in PR #110 (F6) — worth adding to this card's taxonomy
>
> The original problem is an assertion that **cannot fail**. PR #110 surfaced the
> near neighbour: an assertion that **can** fail, but does not test the property
> its comment advertises.
>
> `20260730125034` probe (b) inserted a mixed-case duplicate and claimed it
> "proves the index is on the normalized expression, not the raw column". It does
> not. PR D's `a_normalize_email_invitations` BEFORE-row trigger rewrites
> `NEW.email` before any index is evaluated, so a plain unique index on
> `(organization_id, email)` would block it identically — the probe cannot
> distinguish the two, and cannot be made to (dropping the trigger trades the
> 23505 for a 23514 the `WHEN unique_violation` handler would not catch).
>
> Fixed by correcting the claim, not the code: the probe is genuinely useful as a
> trigger-and-index-agree check, and the expression claim is carried by the
> `indexdef` assertion where it belongs.
>
> **Taxonomy for this card**: (1) assertions that cannot fail; (2) assertions that
> can fail but prove something other than what they claim. Both read as coverage.

## Problem

`20260729184125_guard_email_lookup_rpcs.sql:222-259` (and the same shape copied into
`20260730032132`) contains assertions that `pg_get_functiondef()` the functions **that
same migration just wrote**, then regex the result for strings the migration itself
put there:

```sql
v_def := pg_get_functiondef(v_fn::regprocedure);
IF v_def !~ 'accessible_organizations' OR v_def !~ 'service_role' THEN
  RAISE EXCEPTION 'Tenancy guard or service_role exemption missing after replace: %', …
```

`CREATE OR REPLACE` either succeeded — in which case the strings are necessarily
present — or aborted the transaction before the DO block ran. **These cannot fail.**
Vacuous, not merely brittle.

Contrast the M3 shape-tag assertion in the same block, which IS load-bearing:
`obj_description` is **not** written by the migration, so OID-preservation is a real
property being checked.

## Why it matters

The assertions were added (by me) to guard the highest-consequence failure in that
migration: silently dropping the tenancy guard or the `service_role` exemption during
a `CREATE OR REPLACE`. That is a genuine hazard — codified pitfall 6 exists for it.
But the guard as written verifies nothing, so the hazard is unmitigated **while
appearing mitigated**, which is the worst of both.

`20260730034703` deliberately does not reproduce them; it keeps only the shape-tag
assertion. This card is about the two older copies.

## Proposed

Either delete the vacuous blocks, or convert them into **behavioural** probes that
test the deployed function rather than its source text. The repo already has the
idiom — `set_config('request.jwt.claims', …)` inside a transaction, per
`simulate-jwt-claims-for-rpc-test`:

```sql
-- inside the migration, in a rolled-back sub-transaction
PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"<non-member>"}', true);
IF EXISTS (SELECT 1 FROM api.check_user_org_membership('known@member.test', '<org>')) THEN
  RAISE EXCEPTION 'Tenancy guard did not deny a non-member' USING ERRCODE='P9099';
END IF;
```

That fails if the guard is actually missing, which the text check never can.

Consider whether this belongs in `infrastructure/supabase/CLAUDE.md` as a codified
pitfall: *an assertion whose subject is written by the same migration proves only that
the write happened.* The existing pitfall-8 template (handler-vs-schema column
existence) is a good counter-example — it checks `information_schema`, which the
migration does not write.

## Verification

- Temporarily remove the guard from a scratch copy; the converted assertion must fail.
  (The current one passes.)
- Migration remains idempotent and the DO block still runs inside the transaction.

## Related

- `20260729184125_guard_email_lookup_rpcs.sql:222-259` — the original
- `20260730032132_case_insensitive_email_lookup.sql` — copied the shape
- `20260730034703_symmetric_email_normalization.sql` — deliberately does not
- `infrastructure/supabase/CLAUDE.md` — pitfall 6 (the hazard), pitfall 8 (a
  non-vacuous assertion template)
