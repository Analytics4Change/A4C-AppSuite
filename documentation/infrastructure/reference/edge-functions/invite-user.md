---
status: current
last_updated: 2026-06-23
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Edge Function API reference for `invite-user`. Routes by user-state: greenfield emails get an invitation token + email; **existing** users are added by direct role assignment (or reactivate-then-assign) with no token. The success response carries an `action` discriminator.

**When to read**:
- Implementing or debugging the "add user to organization" UI flow
- Understanding why an existing user does NOT receive an invitation email
- Wiring the `action` discriminator into frontend success messaging
- Tracing the cross-provider invitation gate

**Prerequisites**:
- [manage-user.md](./manage-user.md) — sibling user-lifecycle EF
- [adr-rpc-readback-pattern.md](../../../architecture/decisions/adr-rpc-readback-pattern.md) — Pattern A v2 envelope
- [provider-partners-architecture.md](../../../architecture/data/provider-partners-architecture.md) — cross-provider boundary

**Key topics**: `invite-user`, `edge-function`, `user-invitation`, `role-assignment`, `email-status`, `reactivation`

**Estimated read time**: 7 minutes
<!-- TL;DR-END -->

# invite-user Edge Function

## Overview

`invite-user` is the **command** entry point for adding a user to an organization. It does **smart email lookup** (`checkEmailStatus`) and routes by the result, because the correct write differs by user-state:

- **Greenfield** (no live user, or a stale token) → create an invitation (token + email + acceptance ceremony).
- **Existing user** → a direct **role assignment** (or **reactivate-then-assign**) — no token, no email, no `user.invited`/`user.created` noise.

This routing was introduced by the `invite-user-route-existing-users-to-role-assign` card (epic PR 3). Before it, existing users were wrongly issued invitation tokens, producing misleading audit trails and spurious emails (discovered in PR #64 UAT T2).

**Permission**: `user.create` at the EF boundary. The existing-user paths additionally require the role-grant authority enforced by `api.modify_user_roles` / `api.reactivate_user` (the caller's JWT drives those gates).

## Endpoint

```
POST https://<project-ref>.supabase.co/functions/v1/invite-user
```

## Email-status routing

`checkEmailStatus` returns one of the statuses below; the handler routes accordingly. `api.check_user_has_any_role(user_id)` splits the "exists but not in this org" case into a roleless "zombie" vs a member of another org.

| `checkEmailStatus` | Meaning | Action | Response `action` |
|---|---|---|---|
| `active_member` | Active role in this org | 409 conflict | — |
| `pending_invitation` | Live token in this org | 409 conflict | — |
| `not_found` | No live user (or soft-deleted) | Create invitation (token + email) | `invitation_sent` |
| `expired_invitation` | Stale token, same org | Replace stale token | `invitation_sent` |
| `deactivated` | Has a role here, `users.is_active=false` | **Reactivate** (`api.reactivate_user` + clear auth ban) **then assign** requested roles | `user_reactivated_and_role_assigned` |
| `existing_user_no_roles` | Users row, **zero** roles anywhere ("zombie") | **Direct role assignment** (`api.modify_user_roles`) | `role_assigned` |
| `other_org_member` | Users row, ≥1 role in another org | **Cross-provider eligibility gate**, then on eligible → direct role assignment | `role_assigned` (or 422 if blocked) |

Existing-user paths emit **only** `user.role.assigned` / `user.reactivated` (via the RPCs); they do **not** emit `user.invited` or `user.created`. The correlation id chains automatically — the RPCs set `app.correlation_id` from `users.correlation_id`.

### Cross-provider gate

For `other_org_member`, `api.check_invitation_acceptance_eligibility` blocks direct provider→provider role assignment (HTTP 422) before any write — cross-tenant access between `type='provider'` orgs is reserved for `type='provider_partner'` mediation. See the top-of-file docblock and [accept-invitation.md](./accept-invitation.md) (acceptance-time gate).

## Response format

Success carries an `action` discriminator:

```jsonc
// invitation_sent (greenfield/expired)
{ "success": true, "action": "invitation_sent", "invitationId": "...", "emailStatus": "not_found" }

// role_assigned (existing user, no token)
{ "success": true, "action": "role_assigned", "userId": "..." }

// user_reactivated_and_role_assigned (deactivated user)
{ "success": true, "action": "user_reactivated_and_role_assigned", "userId": "..." }
```

Existing-user failures surface the RPC envelope as `{ success: false, error, errorDetails?: { code } }` (e.g. `TARGET_DEACTIVATED`, role-violation codes) — HTTP 400, parsed via `data.success`, not HTTP status. Adding an existing user with zero roles returns 400 ("At least one role is required").

## Frontend integration

`SupabaseUserCommandService.inviteUser` returns `InviteUserResult` with `action`: for `invitation_sent` the `invitation` is populated; for the role-assignment actions only `userId` is set (no `invitation`). `UsersManagePage` shows an action-specific success toast (`data-testid="invite-success-<action>"`); errors flow through `UsersErrorBanner` + `extractEdgeFunctionError`. See [frontend Definition of Done](../../../../frontend/CLAUDE.md).

## Related Documentation

- [manage-user.md](./manage-user.md) — deactivate / reactivate / delete / modify-roles EF
- [accept-invitation.md](./accept-invitation.md) — invitation acceptance + Sally short-circuit + acceptance-time cross-provider gate
- [adr-rpc-readback-pattern.md](../../../architecture/decisions/adr-rpc-readback-pattern.md) — Pattern A v2 envelope
- [cross-tenant-access-grant-rpc-reachability-matrix.md](../../../architecture/authorization/cross-tenant-access-grant-rpc-reachability-matrix.md) — `api.check_user_has_any_role` classification
- [event-metadata-schema.md](../../../workflows/reference/event-metadata-schema.md#events-using-stored-correlation_id) — user-lifecycle correlation chaining
