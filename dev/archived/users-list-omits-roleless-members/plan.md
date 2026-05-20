# User management list omits role-less org members

**Status**: seed (not yet planned)
**Priority**: Medium-High — admin-blind-spot on a HIPAA-adjacent surface; a user with `accessible_organizations` membership and zero current roles is invisible to org admins, making revocation/audit/cleanup harder
**Origin**: PR #64 UAT T2 prep (2026-05-18) — observed `lars.tice+test3@gmail.com` does not appear in testorg's `/users` route despite being known to the platform with `accessible_organizations=[testorg]` and `auth.users` row alive

## Problem

`api.list_users(p_org_id, ...)` filters out users who do not have a `user_roles_projection` row for `p_org_id`, even when those users have `accessible_organizations @> ARRAY[p_org_id]` (i.e., they're still members per the denormalized array). This makes "zombie" users — onboarded, then had their role revoked but not deactivated/deleted — invisible to org admins.

### Why it matters

1. **Operational visibility**: an admin who needs to re-assign a role, re-invite, or finally deactivate such a user cannot see them in the UI. They have to know to query SQL or the audit trail.
2. **Audit-trail integrity**: every user known to be a member of the org should be visible somewhere. A "ghost" state where the system knows about them but doesn't display them is a state-machine gap.
3. **HIPAA-adjacent risk**: in BAA-governed environments, the org admin is responsible for knowing who has — or has had — access. Users invisible in the admin UI but still backed by live `auth.users` and `accessible_organizations` rows are a gap in that responsibility surface.
4. **PR #64 UAT discovered this**: a clean re-invite test was muddled because the subject was invisible in the UI. The card author had to switch from "select existing user → re-invite" to "type email manually into Invite dialog."

## Where the defect lives

`infrastructure/supabase/supabase/migrations/20260212010625_baseline_v4.sql` — `api.list_users` body. Two `WHERE EXISTS (SELECT 1 FROM public.user_roles_projection ur WHERE ur.user_id = u.id AND ur.organization_id = p_org_id)` predicates (one for the total-count query, one for the SELECT). Both predicates exclude role-less users.

```sql
-- Current (filters out role-less org members)
WHERE EXISTS (
  SELECT 1 FROM public.user_roles_projection ur
  WHERE ur.user_id = u.id AND ur.organization_id = p_org_id
)
```

## Fix sketches

### Option A — broaden to `accessible_organizations` (recommended)

Replace the EXISTS predicate with a check against the user's membership column:

```sql
WHERE p_org_id = ANY(u.accessible_organizations)
```

This is the authoritative "is this user a member of this org" indicator — kept in sync from `user_organizations_projection` via the `trg_sync_accessible_orgs` trigger.

Pros: matches the architectural intent that `accessible_organizations` IS the membership oracle. Users who lost a role but still have a membership row appear; users who never had any relationship don't.

Cons: relies on `accessible_organizations` being correctly maintained. Per memory (`fix-handle-user-role-assigned-update-accessible-organizations-seed.md`, superseded by `reject-cross-provider-invitations`), this denormalization has historically had drift — but post-PR-64 the drift class is closed.

### Option B — `EXISTS` against `user_organizations_projection` directly

```sql
WHERE EXISTS (
  SELECT 1 FROM public.user_organizations_projection uop
  WHERE uop.user_id = u.id AND uop.org_id = p_org_id
)
```

Architecturally pure (queries the source-of-truth projection, not the denormalization). Slightly more expensive than option A's array containment check.

### Option C — explicit "ghost users" filter parameter

Add a parameter `p_include_roleless boolean DEFAULT true` to `api.list_users` so callers can opt in/out of including roleless members. Frontend default would be `true`.

Pros: explicit, backwards-compatible.
Cons: another parameter on a function that already takes 7 — clutter. The semantically-correct fix is option A/B; option C punts the architectural question to the caller.

**Recommendation**: option A. Single-line replacement, queries the denormalization column directly (already cheap for filters), aligns with `accessible_organizations`-as-membership-oracle semantics.

## Test impact

- Add a Deno or SQL test verifying that a user with `accessible_organizations @> [target_org]` and zero role rows appears in `list_users` results
- Confirm pagination, status filters, search filters all still work post-change

## Frontend impact

- The UI today renders `roles: jsonb` array from the API response. For roleless members it'll be `[]`. UI may show an empty roles column / "No roles assigned" badge — verify rendering looks reasonable, or add a small UX touch (e.g., row tint or a small "needs role" indicator).
- A roleless user is a valid invite-flow subject — re-inviting via the UI should call `api.modify_user_roles` or the normal invite flow, not be blocked.

## Related projection consistency

While auditing this, also worth verifying:
- `api.list_users_for_role_management(p_org_id)` — same pattern likely; check
- `api.list_users_for_bulk_assignment(p_org_id)` — same pattern likely; check
- `api.list_users_for_schedule_management(p_org_id)` — same pattern likely; check

If any of these also use the role-EXISTS pattern, they should be aligned with the fix.

## Out of scope

- **The root cause of how a user reaches the zombie state** (role revoked without deactivation). For lars.tice+test3 specifically, looking at `domain_events` history would reveal whether his role was revoked manually or via some flow that should have also deactivated him. Worth a separate investigation card if it's a recurring pattern.
- **Backfilling `user_organizations_projection`** for users with `accessible_organizations` entries but missing membership rows — would only matter if option B is chosen and the drift class actually has instances.

## Files involved

- `infrastructure/supabase/supabase/migrations/20260212010625_baseline_v4.sql` (current source of truth for `api.list_users`)
- New migration: `infrastructure/supabase/supabase/migrations/<TIMESTAMP>_fix_list_users_include_roleless.sql`
- `infrastructure/supabase/handlers/api/` (no handler reference file needed; api.* RPCs aren't event handlers)
- Frontend: `frontend/src/services/users/SupabaseUserQueryService.ts` (verify the call site still works correctly)
- New test: SQL-level verification or Deno-level service test

## Related work

- PR #64 (`reject-cross-provider-invitations`) — UAT T2 surfaced this. Card seeded mid-UAT; T2 itself proceeds without depending on the fix (invite dialog accepts email directly).
- Parked card `dev/parked/eligibility-rpc-pgtap-coverage/` — if pg_tap testing infrastructure lands, would also cover the `list_users` fix's regression tests.
