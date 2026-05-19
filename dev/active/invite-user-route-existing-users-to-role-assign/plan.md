# `invite-user` should route by user-state, not always create an invitation token

**Status**: seed (not yet planned)
**Priority**: Medium-High — architectural drift; the invite-user EF currently issues invitation tokens (with email + acceptance ceremony) to **existing non-deleted users** whose roles have been revoked or who are deactivated, when the correct action is to directly modify roles or reactivate. The bad UX is masked by the fact that the Sally short-circuit in `accept-invitation` makes the flow "work" — but the wrong abstraction generates misleading audit trails, wrong success messages, and unnecessary email round-trips.
**Origin**: PR #64 UAT T2 discovery (2026-05-18) — `lars.tice+test3@gmail.com` (non-deleted user, zero roles anywhere, accessible_organizations=[testorg]) was issued a fresh invitation token when admin re-added him to testorg.

## Problem statement

`invite-user/index.ts` routes purely on `checkEmailStatus` output to decide between 409-conflict / always-create-invitation. For three of those statuses, the always-create-invitation path is the **wrong write action**:

| `checkEmailStatus` returns | Today's behavior | Correct architectural action |
|---|---|---|
| `active_member` (active role in this org) | 409 conflict | ✅ 409 conflict (unchanged) |
| `pending_invitation` (this org has a live token already) | 409 conflict | ✅ 409 conflict (unchanged) |
| `not_found` (no users row OR soft-deleted) | Create invitation + token + email + acceptance | ✅ Create invitation (unchanged — true onboarding) |
| `expired_invitation` (stale token, same org) | Create new invitation | ✅ Replace stale token (unchanged — probably OK as-is) |
| `deactivated` (has role row in this org but `users.is_active=false`) | **Create new invitation token + email** | ❌ Should **reactivate** via `api.reactivate_user` (or successor RPC) — no token, no email, no acceptance ceremony |
| **`other_org_member` overloaded** | (single status used for two cases) | ❌ Should be **two distinct statuses** with two distinct routes — see below |

### The `other_org_member` overload

The status is returned when `check_user_exists` finds a `users` row but `check_user_org_membership` and `check_pending_invitation` don't. Two semantically-distinct sub-cases hide behind this one name:

- **(a) Truly in another org**: the user has at least one `user_roles_projection` row in some org other than the target. PR #64's cross-provider gate exists for this case. For provider→provider direction: blocked. For provider→partner direction: today blocked-by-omission (Finding #5 docblock). Eventually: cross-tenant access grant via partner.
- **(b) Existing user, no roles anywhere ("zombie")**: the user has a `users` row, possibly `accessible_organizations` membership, but zero `user_roles_projection` rows. Re-inviting them is architecturally a **role re-assignment**, not an onboarding.

The fix is to split these:

| Proposed new status | Definition | Route |
|---|---|---|
| `other_org_member` (literal) | users row + ≥1 user_roles_projection row in any org other than target | Cross-provider gate (PR #64); on eligible=true, **direct role assignment to existing user** + notification email (NOT new invitation token) |
| `existing_user_no_roles` (new) | users row but zero user_roles_projection rows anywhere | **Direct role assignment to existing user** + notification email |

## Why the current behavior tolerates the wrong abstraction

`accept-invitation` has a Sally short-circuit (PR #63): if the OAuth-authenticated user already exists in `user_roles_projection`, skip `user.created` and just emit `user.role.assigned`. For lars.tice+test3 (zero roles), `check_user_invitation_existence` returns `isExistingUser=false` → `accept-invitation` emits `user.created` → `handle_user_created` is an UPSERT (`ON CONFLICT (id) DO UPDATE`) → no-op for the user row, then `user.role.assigned` fires.

So end-to-end, the role gets re-attached. But the trail in `domain_events` shows:
- `user.invited` (misleading — user already existed)
- `user.created` (no-op via UPSERT — but still emitted; an auditor sees a creation event for a pre-existing user)
- `user.role.assigned` (the actually-meaningful event)

A clean architecture would emit just `user.role.assigned` (the only event that reflects a real state change) with no `user.invited` or `user.created` noise.

## Why this isn't a PR #64 regression

PR #64's scope was narrow: block provider→provider cross-tenant native role assignment. It correctly fires for existing users with active roles in another provider org (`other_org_member` literal case). It correctly returns `eligible=true` for the zombie case (no active roles anywhere to block on). The behavior PR #64 ships is correct **within its narrow contract**. This card is the next layer — reconsidering whether `invite-user` should be issuing invitation tokens at all when the user already exists.

## Architecture sketch

### Step 1 — Split the status enum

In `invite-user/index.ts` `EmailStatus` type and `checkEmailStatus` function:

```typescript
type EmailStatus =
  | 'not_found'
  | 'pending_invitation'
  | 'expired_invitation'
  | 'active_member'
  | 'deactivated'
  | 'other_org_member'           // now means: has active role in another org
  | 'existing_user_no_roles';     // NEW: users row exists, zero role rows anywhere
```

Add a new SQL RPC `api.check_user_has_any_role(p_user_id uuid) RETURNS boolean` to disambiguate (or fold the check into `check_user_exists`'s return shape).

### Step 2 — Route by status

```typescript
switch (emailStatus.status) {
  case 'active_member':       return 409;
  case 'pending_invitation':  return 409;
  case 'not_found':           return createInvitation(); // current path
  case 'expired_invitation':  return createInvitation(); // replaces stale token
  case 'deactivated':         return reactivateAndAssignRole(); // NEW path
  case 'existing_user_no_roles': return assignRoleToExistingUser(); // NEW path
  case 'other_org_member':    return crossProviderGateThenAssignRole(); // gate fires; on eligible, NEW assign-role path
}
```

### Step 3 — New code paths (no new tokens)

`assignRoleToExistingUser(userId, orgId, roleId)`:
- Verify caller has `user.create` permission (already checked at the EF boundary today)
- Verify caller has authority to grant this specific role to this user in this org (use existing `api.validate_role_assignment`)
- Call `api.modify_user_roles(p_user_id := userId, p_role_id_add := roleId, p_org_id := orgId)` directly
- Emit a `user.role.assigned` event (the modify_roles RPC already does this)
- Optionally send a notification email "You've been added to [org name]" — no token, no acceptance, just informational
- Response shape: `{ success: true, action: 'role_assigned', userId, roleId }`

`reactivateAndAssignRole(userId, orgId)`:
- For the `deactivated` case: reactivate via `api.reactivate_user(userId)` (still needs to land per the parked retrofit card)
- Then assign role per above
- Response shape: `{ success: true, action: 'user_reactivated_and_role_assigned', userId, roleId }`

`crossProviderGateThenAssignRole(userId, targetOrgId, roleId)`:
- Run `api.check_invitation_acceptance_eligibility(userId, targetOrgId)` (PR #64 gate)
- On `eligible=false`: HTTP 422 with the gate's error code (unchanged from PR #64)
- On `eligible=true`: call `assignRoleToExistingUser(userId, orgId, roleId)`
- Response shape (success): same as `assignRoleToExistingUser`

### Step 4 — Frontend response handling

`SupabaseUserCommandService` / `UsersManagePage` consume the new `action` discriminator and show appropriate UI feedback:
- `'invitation_sent'` → "Invitation sent to {email}. They'll receive an email."
- `'role_assigned'` → "Role assigned to {existing user name}."
- `'user_reactivated_and_role_assigned'` → "User reactivated and role assigned."

After the call, refresh the user list (the assignee now appears in the testorg roster — depends on the visibility fix landing).

### Step 5 — `user.invited` audit-trail cleanup

For the role-assignment paths, do NOT emit `user.invited` — that event is the wrong semantic. Emit only `user.role.assigned`. Audit trail stays clean.

## Test surface

- Unit: helper-tier tests that the routing logic dispatches to the right write path per status
- SQL: `api.check_user_has_any_role` (or whatever replaces it) returns the right boolean
- Deno: `invite-user` integration test using mocked checkEmailStatus to assert each branch
- UAT scenarios analogous to T2 (existing user with no role → re-add via UI → expect 200 with `action: 'role_assigned'`, no email sent, no token in projection)

## Dependencies / sequencing

- **`users-list-omits-roleless-members/`** (already seeded) — must land first OR alongside. Without it, admins can't find existing-roleless users to re-add via the UI, so the new UX path has no entry point.
- **`manage-user-reactivate-pattern-a-v2-retrofit/`** (parked) — the `deactivated` route depends on having `api.reactivate_user` (currently a separate Edge Function path). Could also be a separate sub-card.
- **Cross-tenant grant pipeline** (parked at `dev/active/sub-tenant-admin-design/`) — orthogonal; this card doesn't depend on it. The provider→provider_partner direction stays at "blocked by omission" pending the larger grant work.

## Out of scope

- Changing the invitation-acceptance ceremony for true greenfield users (`not_found`). Keep that flow.
- The cross-tenant grant pipeline itself (separate parked card).
- The "User exists in another provider org" UX message — could be improved but not changed by this card.

## Files involved

- `infrastructure/supabase/supabase/functions/invite-user/index.ts` — primary EF refactor
- `infrastructure/supabase/supabase/functions/_shared/check-invitation-eligibility.ts` — already shared between invite-user + accept-invitation; reuse for the cross-provider sub-path
- (Possibly) new SQL RPC `api.check_user_has_any_role(uuid)` OR extend `check_user_exists` return shape
- `frontend/src/services/users/SupabaseUserCommandService.ts` — handle new `action` discriminator
- `frontend/src/pages/users/UsersManagePage.tsx` — toast/banner copy per action
- Tests: Deno integration tests for the new routing + frontend service tests

## Related cards / PRs

- **PR #64** (`reject-cross-provider-invitations`, merged 2026-05-13) — the cross-provider gate this card builds on
- **`users-list-omits-roleless-members/`** (NEW 2026-05-18, seeded same UAT session) — visibility prerequisite
- **`manage-user-reactivate-pattern-a-v2-retrofit/`** (parked) — `api.reactivate_user` RPC; needed for the `deactivated` route
- **`sub-tenant-admin-design/`** (active, dormant) — full cross-tenant grant pipeline; orthogonal to this card
