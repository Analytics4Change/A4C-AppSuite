# Cross-org existing-user direct role assignment

**Status**: seed (not yet planned)
**Priority**: Medium — completes the `invite-user` routing story for the cross-tenant case; gated on a deliberate authz design (cross-tenant-capable role assignment).
**Origin**: invite-user epic PR 3 (`invite-user-route-existing-users-to-role-assign`, 2026-06-24), architect review (REQUEST CHANGES → narrow scope). PR 3 shipped direct assignment only for **same-org** existing users.

## Problem

PR 3 routes existing users away from the invitation-token flow into direct role assignment. But `api.modify_user_roles` and `api.reactivate_user` gate on `users.current_organization_id IS DISTINCT FROM <caller org>` → for a **cross-org** target (home org ≠ caller's org) they return `NOT_FOUND`. So PR 3 narrowed to same-org users:

- `existing_user_no_roles` (zombie) whose home org = caller's org → direct assign. A cross-org zombie returns NOT_FOUND and **falls back to the invitation token flow** (status quo).
- `deactivated` member of this org → reactivate + assign (single-org members only).
- `other_org_member` (≥1 role in another org) → kept on the invitation path entirely.

This card covers the deferred case: an admin in Org B adding an **existing** user whose home/role org is a different org A — without round-tripping a token.

## Why it's deferred (not just a guard tweak)

1. **The guard is the wrong oracle.** `current_organization_id` is the session/creating-org pointer, not a membership oracle (see `infrastructure/supabase/CLAUDE.md` § "accessible_organizations is the canonical membership oracle"). `modify_user_roles`/`reactivate_user` using it is a pre-existing latent issue (also affects multi-org members in the everyday edit-roles path).
2. **Chicken-and-egg.** Switching the guard to `accessible_organizations @> [caller_org]` doesn't help: a cross-org user isn't a member of B *until* the assign lands. The correct precondition for "add an existing user to MY org" is **caller-authority-in-my-org** (`user.role_assign` + `validate_role_assignment` scoped to B), NOT target-membership-in-B.
3. **Architectural question — should this be native role assignment at all?** Cross-tenant access between providers is designed to flow through **cross_tenant_access_grants**, not native `user_roles_projection` rows in another provider's org. The cross-provider gate already blocks provider→provider. So cross-org "add to my org" may belong to the grant pipeline, not a native-assign primitive. **Resolve this first.**

## Options (decide during planning)

- **A. Dedicated RPC** `api.assign_roles_to_existing_user(p_user_id, p_org_id, p_role_ids, p_reason)` whose precondition is caller-authority-in-`p_org_id` (not target-membership). Isolated from the shared edit-roles RPC; but it's a powerful cross-tenant-capable assign primitive needing careful authz + its own review + e2e.
- **B. Fix the shared guards** on `modify_user_roles`/`reactivate_user` to a caller-authority / `accessible_organizations` model. Largest blast radius (edit-roles path); needs pitfall-#6 ritual + e2e. Also fixes the latent multi-org edit-roles issue.
- **C. Route through grants.** If cross-org access must be grant-mediated, the EF surfaces "this user belongs to another org — use a cross-tenant grant" rather than assigning natively. Aligns with provider-partners architecture.

## Acceptance

Whatever path: must be **proven end-to-end against real Supabase** (a logged-in admin in Org B adding a user whose home org is A), not just unit tests with stubbed RPCs (pitfall #9 — mock clients can't model deployed RPC tenancy semantics).

## Related

- invite-user epic PR 3 (origin) — `dev/active/invite-user-route-existing-users-to-role-assign/`
- `infrastructure/supabase/CLAUDE.md` § "accessible_organizations is the canonical membership oracle" + § scoped-vs-unscoped permission checks
- `documentation/architecture/data/provider-partners-architecture.md` — cross-tenant access via grants
- cross-tenant-access-grant-rollout parent card (the grant pipeline)
