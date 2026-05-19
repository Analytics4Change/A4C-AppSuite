# Tasks — invite-user-route-existing-users-to-role-assign

## Investigation

- [ ] Verify the `deactivated` path is actually broken today: deactivate a test user, try to re-invite, observe what `invite-user` does (does it 409? proceed? what kind of event hits domain_events?)
- [ ] Audit all `user.invited` events in `domain_events` for the last 30 days — how many were for **existing** users (i.e., emit's `stream_id` corresponds to an existing pre-event users row)? Magnitude of the drift class.
- [ ] Decide: split status into two via new RPC vs. fold into `check_user_exists` return shape

## Migration(s)

- [ ] (Possibly) new SQL RPC `api.check_user_has_any_role(p_user_id uuid) RETURNS boolean` with `@a4c-rpc-shape: read` comment
- [ ] (Possibly) extend `api.check_user_exists` return shape to include `has_any_role boolean` so a single call disambiguates
- [ ] If extending check_user_exists: bump existing consumers (`SupabaseUserQueryService.ts:869` + invite-user EF) to handle new shape

## Edge Function — `invite-user`

- [ ] Split `EmailStatus` type: add `existing_user_no_roles`; tighten `other_org_member` semantic in the docblock
- [ ] Update `checkEmailStatus` to return the new status (call `check_user_has_any_role` after `check_user_exists`)
- [ ] Refactor the post-`checkEmailStatus` switch into named handlers:
  - [ ] `assignRoleToExistingUser()` — for `existing_user_no_roles` + `other_org_member` (after gate passes)
  - [ ] `reactivateAndAssignRole()` — for `deactivated`
  - [ ] Existing `createInvitation()` path stays for `not_found` + `expired_invitation`
- [ ] Wire the cross-provider gate ONLY to the `other_org_member` literal path (not to `existing_user_no_roles`, since zombies have no active provider role to gate on)
- [ ] Update response shape: add `action: 'invitation_sent' | 'role_assigned' | 'user_reactivated_and_role_assigned'` discriminator
- [ ] Bump `DEPLOY_VERSION` constant

## Audit-trail cleanup

- [ ] For role-assignment paths, do NOT emit `user.invited` — only `user.role.assigned` fires
- [ ] For reactivation paths, emit `user.reactivated` then `user.role.assigned` (NOT `user.invited`)
- [ ] Verify domain_events stays semantically clean for the existing-user paths

## Frontend

- [ ] `SupabaseUserCommandService` — handle the new `action` discriminator in the invite-user response
- [ ] `UsersManagePage` — toast/banner copy per action; row updates immediately on `role_assigned` (user shows up in the list with role)
- [ ] Verify the existing-user-no-roles row (post `users-list-omits-roleless-members` fix) has a clear UX path: list shows "No roles assigned" badge + Assign Role button → calls the new path → user gains role

## Tests

- [ ] Unit: routing dispatcher selects the right handler per status (5 cases minimum)
- [ ] Deno: integration tests for each branch with mocked checkEmailStatus fixtures
- [ ] SQL/RPC: `check_user_has_any_role` (or extended `check_user_exists`) returns correct booleans for: zero-role user, single-role user, multi-role user, soft-deleted user
- [ ] Frontend service tests: action discriminator handled correctly per response

## UAT (post-implementation)

- [ ] Re-add lars.tice+test3 to testorg via the UI (assumes visibility fix has landed) → expect `action: 'role_assigned'`, no token in invitations_projection, no `user.invited` event in domain_events
- [ ] Cross-provider attempt (dakaratekid → testorg) still rejected via PR #64 gate, no zombie-pathway bypass
- [ ] Deactivate-then-readd: deactivate a testorg user → invite same email → expect `action: 'user_reactivated_and_role_assigned'`, no token, no email

## Sequencing

- [ ] Visibility fix (`users-list-omits-roleless-members/`) lands first OR alongside — without it, the UX has no entry point
- [ ] Reactivate RPC (`manage-user-reactivate-pattern-a-v2-retrofit/`) lands first OR alongside — the `deactivated` branch depends on it
- [ ] This card lands third or in parallel

## Documentation

- [ ] Update `frontend/src/services/CLAUDE.md` or relevant docblocks if response-shape conventions change
- [ ] Update `documentation/architecture/authentication/...` if the invitation flow's semantic shifts substantially
- [ ] Memory entry: this card + the rationale (existing-user paths bypass the invitation ceremony)

## PR shape

- [ ] Branch: `feat/route-existing-users-to-role-assign`
- [ ] One PR per landed dependency (visibility fix, reactivate retrofit). This card's PR comes last in the sequence.
- [ ] Architect review at plan-time (pre-code) per recent norms — this is a meaningful architectural change with response-shape implications
