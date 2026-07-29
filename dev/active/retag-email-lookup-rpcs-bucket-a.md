---
status: seed
last_updated: 2026-07-29
---

# Seed: re-tag the two guarded email-lookup RPCs D → A

**Origin**: `software-architect-dbc` review of PR #103 (finding F4), 2026-07-29.

**Priority**: Low-Medium. No runtime effect — the guard is live and correct. This
is a taxonomy correction in the authorization design doc, which currently
contradicts itself.

## Problem

`20260729184125_guard_email_lookup_rpcs.sql` gave `api.check_user_org_membership`
and `api.check_pending_invitation` the Model M early-return membership guard, but
deliberately did not re-issue `COMMENT ON FUNCTION`. Both therefore still carry the
tags seeded by `20260601174841_cross_tenant_grant_phase_1_jwt_shape.sql:3528,3531`:

```
@a4c-bucket: D
@a4c-consultant-callable: pending-phase4-rls
```

Three things are now wrong in the codegen-owned tables:

| field | says | should say |
|---|---|---|
| bucket | `D` | `A` (A-variant, Model M — same shape as `list_users`) |
| consultant-callable | `pending-phase4-rls` | `yes` (grant-bearers pass the membership oracle) |
| guard prose | "RLS-enforced tenancy" | never true — both are `SECURITY DEFINER`, RLS does not apply |

They also still appear in the "Phase 4 RLS audit target list (Bucket D + D-variant
— 37 RPCs)" while the definer-bypasses-RLS cluster note marks them RESOLVED.

**CI cannot detect this.** `rpc-reachability-matrix-sync.yml` regenerates from the
tags and diffs the result — doc and tags are consistently wrong together, so it
passes green. Only a human reading the bucket definitions catches it.

## Why PR #103 did not just fix it

Two reasons, both worth preserving:

1. **The comment text is not fully knowable from this repo.** The
   `@a4c-rpc-shape: read` tag was applied at runtime by the APPEND-style backfill
   DO-block in `20260430172625`, so the live `pg_description` content is baseline
   prose + appended tags. A wholesale `COMMENT ON FUNCTION ... IS '<new text>'`
   risks discarding content nobody has read. The correct instrument is a
   **regex-replace DO-block**, the same idiom that backfill uses.
2. **The matrix must be regenerated in the same commit**, and
   `frontend/scripts/gen-rpc-reachability-matrix.cjs` shells out to `psql`
   (`:99`), which was not installed in the session that shipped the guard.
   Committing a re-tag without the regenerated matrix would turn the sync check
   red.

## Proposed

1. New migration with a DO-block that regex-replaces, per function, `@a4c-bucket:\s*D`
   → `@a4c-bucket: A` and `@a4c-consultant-callable:\s*pending-phase4-rls` →
   `@a4c-consultant-callable: yes`, leaving all other comment content intact.
   Use `\y` not `\b` (codified pitfall 1).
2. Add/refresh the `@a4c-consultant-callable-reason` line to state the Model M
   basis, matching the `list_users` entry's wording.
3. `supabase db push --linked`, then `npm run gen:rpc-reachability-matrix` (needs
   `psql` and either a local container or `SUPABASE_DB_URL`), commit the regenerated
   matrix.
4. Remove the "Known stale rows" annotation block added to the matrix by PR #103 —
   it exists only to keep the contradiction visible until this lands.

## Verification

- `git diff` on the matrix shows the two rows moving D → A, consultant-callable
  → yes, and dropping out of the Phase 4 target list.
- `rpc-reachability-matrix-sync.yml` green (it regenerates and diffs).
- The `@a4c-rpc-shape: read` tag survives — assert it, as
  `20260729184125` does at its assertion block.
- Bucket counts in `GENERATED:PER-BUCKET-COUNTS` shift by 2.

## Related

- `documentation/architecture/authorization/cross-tenant-access-grant-rpc-reachability-matrix.md`
  — the "Known stale rows" note this card removes, and the RESOLVED entry in the
  definer-bypasses-RLS cluster
- `20260622183824_phase_3_list_users_membership_guard.sql` — the Model M exemplar
  and the tagging precedent to match
- `20260430172625` — the APPEND-style backfill DO-block idiom
- `dev/active/seed-list-invitations-cross-tenant-visibility-decision.md` — separate,
  larger question about whether `check_pending_invitation` needs a permission
  conjunct on top of membership
