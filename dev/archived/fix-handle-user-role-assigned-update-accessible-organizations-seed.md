# Fix `handle_user_role_assigned` to maintain `public.users.accessible_organizations`

**Status**: SUPERSEDED 2026-05-13 → ARCHIVED 2026-06-23 — successor `reject-cross-provider-invitations` SHIPPED (PR #64), now at `dev/archived/reject-cross-provider-invitations/`. The `accessible_organizations` denormalization gap closes automatically once provider→provider Sally invitations are rejected at the boundary; no separate fix needed.
**Priority**: Medium (affects post-invitation routing for multi-org users — frontend lands them on the wrong subdomain)
**Origin**: PR #63 UAT Test 5 post-test finding (2026-05-13, Sally scenario for `dakaratekid@gmail.com`)

## Supersession note (2026-05-13)

Planning investigation revealed this seed treats a symptom of architectural drift, not a root cause. Per `documentation/architecture/data/provider-partners-architecture.md` (last updated 2026-05-06, still authoritative): cross-tenant access between distinct `provider`-type orgs is reserved for users whose home org is `provider_partner`, and is mediated by `cross_tenant_access_grants_projection` — NOT by native role assignment. dakaratekid's case is a provider→provider Sally invitation that should have been rejected at the boundary. Both `liveforlife` and `testorg-20260329` are confirmed `type='provider'`, `partner_type=NULL`.

The architectural fix is to reject the invitation, not denormalize the data of an accepted-but-unintended invitation. See `dev/active/reject-cross-provider-invitations/` for the boundary-repair plan, including dakaratekid cleanup. The accessible_organizations denormalization gap closes automatically once provider→provider Sally invitations are rejected (no new offending rows).

The full cross-tenant grant pipeline (api.create_access_grant, RLS on provider data, partner UI) remains parked at `dev/active/sub-tenant-admin-design/`.

Routing-to-a4c symptom (dakaratekid landing on `a4c.firstovertheline.com/clients` despite JWT `org_id=liveforlife`) is NOT caused by `accessible_organizations` — routing reads JWT `org_id`, not the array. Seeded separately: `dev/active/investigate-auth-callback-priority-2-fallthrough.md`.

---

## Original framing (preserved for context, do not act on)

## Problem

The `handle_user_role_assigned` event handler updates `public.user_roles_projection` (correctly — source of truth for "user has any role") but does NOT update `public.users.accessible_organizations` to add the new organization's UUID. This leaves the denormalized `accessible_organizations` array stale after a multi-org user accepts an invitation.

Observed during PR #63 UAT Test 5:

- `dakaratekid@gmail.com` (user `bab8077f-…`) had a `provider_admin` role in liveforlife (org `43ede501-…`)
- Lars invited her to testorg-20260329 (org `2d0829ae-…`)
- She accepted via Google OAuth — `user.role.assigned` event landed cleanly for the new `Cypress Admin` role in testorg
- DB post-acceptance state:
  - `public.user_roles_projection` → 2 rows ✅ (the source of truth — `api.check_user_invitation_existence` reads from this, Sally short-circuit worked correctly)
  - `public.users.accessible_organizations` → `[43ede501-…]` only ❌ (testorg not added)
  - `public.users.current_organization_id` → unchanged at liveforlife (expected — primary org stays)

## Downstream symptom

After dakaratekid logged out and back in, she landed on `https://a4c.firstovertheline.com/clients` — the **platform-owner subdomain** — instead of testorg or liveforlife. The frontend's "where do I route this user" code appears to fall back to `a4c` when the user's `accessible_organizations` denormalization doesn't reflect the orgs where their `user_roles_projection` rows actually exist. Functionally she's locked out of testorg's UI until the array is fixed.

## Why this matters

- **Multi-org users are broken post-invitation**: any accepting user with prior roles elsewhere will hit this. The Sally scenario is exactly the multi-org-onboarding flow.
- **Pattern inconsistency**: the `handle_user_*` handlers are supposed to keep `public.users` denormalizations in sync with the events. This is a missed denormalization step.
- **Frontend trust on `accessible_organizations`**: the front-end's routing reads from this array (per inference from the routing bug); the array MUST be kept in sync.

## Hypothesis to confirm during planning

Audit the JWT custom claims hook (`auth.custom_access_token_hook`) and decide:
- Does the hook read `accessible_organizations` directly from `public.users`, or recompute from `user_roles_projection`?
- If the former, the fix is purely in the handler: add `accessible_organizations` update.
- If the latter, the handler is fine and the fix is elsewhere (e.g., the JWT issued at sign-in pre-dated the projection update, requiring a session refresh).

Resolve before writing code.

## Proposed shape

1. Read `infrastructure/supabase/handlers/rbac/handle_user_role_assigned.sql` (canonical reference).
2. Add `UPDATE public.users SET accessible_organizations = array_append(accessible_organizations, p_event.event_data->>'org_id') WHERE id = p_event.stream_id AND NOT (p_event.event_data->>'org_id'::uuid = ANY(accessible_organizations))` OR equivalent dedup logic.
3. Mirror the inverse in `handle_user_role_revoked` if it exists — when the LAST role in an org is revoked, the org should be removed from `accessible_organizations` (audit the projection carefully — multiple roles in one org should keep the org in the array as long as ≥1 role remains).
4. Add migration: `supabase migration new fix_user_role_assigned_maintain_accessible_organizations`. Update `handle_user_role_assigned` (and `_revoked` if applicable).
5. Update the handler reference file at `infrastructure/supabase/handlers/rbac/handle_user_role_assigned.sql` to match.
6. Backfill query for existing multi-org users (one-shot or migration-bundled): `UPDATE public.users u SET accessible_organizations = ARRAY(SELECT DISTINCT organization_id FROM public.user_roles_projection WHERE user_id = u.id) WHERE EXISTS (SELECT 1 FROM public.user_roles_projection urp WHERE urp.user_id = u.id AND NOT (urp.organization_id = ANY(u.accessible_organizations)))`. Verify with a SELECT before running.
7. UAT: re-run Sally-style invitation acceptance, verify `accessible_organizations` updates to include the new org.

## Out of scope

- The frontend routing logic itself. If the routing reads from `accessible_organizations`, the projection fix is sufficient. If it reads from somewhere else (e.g., a JWT claim derived from `user_roles_projection`), additional work may be needed — to be determined in planning.
- Refactoring `current_organization_id` semantics. The "primary org" concept is unchanged.

## Files involved

- `infrastructure/supabase/handlers/rbac/handle_user_role_assigned.sql` (canonical reference)
- `infrastructure/supabase/handlers/rbac/handle_user_role_revoked.sql` (potential inverse update)
- `infrastructure/supabase/supabase/migrations/<new>_fix_user_role_assigned_maintain_accessible_organizations.sql` (forward migration)
- `dev/active/manage-user-deactivate-pattern-a-v2-retrofit/tasks.md` UAT Test 5 entry (origin reference)

## Background context

- PR #63 ships `api.check_user_invitation_existence` SQL RPC which reads from `user_roles_projection`. That's the correct architectural pattern for the Sally-detector, and Test 5 confirmed it works.
- The `users.accessible_organizations` array is a separate denormalization that has its own consumers (likely the JWT custom claims hook + frontend routing). The two surfaces — `user_roles_projection` (source of truth) and `accessible_organizations` (denormalization) — diverged because `handle_user_role_assigned` only updates the former.
- The architectural rule (per `infrastructure/CLAUDE.md` § Event Metadata): all state changes flow through `domain_events` → handlers update projections. This handler is missing an update; not a violation of the pattern, just an incomplete handler implementation.

## Related cards / PRs

- PR #63 (`feat/deactivate-sql-rpc-pivot`) — discovery context; **not blocked** by this card
- `dev/active/sub-tenant-admin-design/` — possibly relevant if/when A4C user-identity gains OU-bounded location; could affect how `accessible_organizations` is computed

## Open questions for planning

1. Does the JWT custom claims hook read `accessible_organizations` or recompute from `user_roles_projection`?
2. Should `handle_user_role_revoked` remove the org from `accessible_organizations` when the last role in that org is revoked? (Probably yes for consistency, but verify there's no implicit assumption elsewhere.)
3. Are there other handlers that also need the same update? (e.g., `handle_invitation_accepted` — though role assignment events should already fire from acceptance, so handler-level is the right layer)
4. Is the frontend routing relying on `accessible_organizations` directly, or via a JWT claim? Audit `frontend/src/contexts/AuthContext.tsx` or wherever the routing decision lives.
