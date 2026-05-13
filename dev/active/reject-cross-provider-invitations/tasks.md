# Tasks — reject-cross-provider-invitations

**Architect-reviewed 2026-05-13.** See `plan.md` § ARCHITECT VERDICT for the must-fix list (C1–C5) and optional improvements. Tasks below incorporate the fixes inline.

## Migration

- [ ] `supabase migration new reject_cross_provider_invitations`
- [ ] Write `api.check_invitation_acceptance_eligibility(uuid, uuid) RETURNS jsonb`:
  - [ ] **STABLE** function marker (it's a pure read)
  - [ ] **NO `auth.uid() IS NULL` guard** (ARCHITECT NOTE C1) — rely on GRANT for authn
  - [ ] Filter: `urp.organization_id IS NOT NULL` (ARCHITECT NOTE C4a) to skip super_admin global rows
  - [ ] Filter: `role_valid_from IS NULL OR <= CURRENT_DATE` (C4b)
  - [ ] Filter: `op.is_active = true` on existing-role org (C4c)
  - [ ] `@a4c-rpc-shape: read` comment
- [ ] `GRANT EXECUTE ... TO authenticated` AND `TO service_role` (C1) — service_role is REQUIRED for accept-invitation's admin client
- [ ] Inline pre-deploy audit DO block: NOTICE-only enumeration of pending invitations that the new gate would now reject (see plan.md "Risks" → "in-flight token risk" + suggested SQL)
- [ ] Inline diagnostic NOTICE-only audit for other multi-provider users (cumulative analog for any unfound dakaratekids)
- [ ] Inline dakaratekid cleanup `DO` block:
  - [ ] Docblock above stating idempotency invariant (depends on `handle_user_role_revoked` row-delete semantics — ARCHITECT NOTE C5)
  - [ ] `metadata.automated: true` flag added
  - [ ] Named-arg `api.emit_domain_event` call (signature `(p_stream_id, p_stream_type, p_event_type, p_event_data, p_event_metadata)`)
- [ ] `supabase db push --linked --dry-run` clean
- [ ] `supabase db lint --level error` passes
- [ ] Apply to dev: `supabase db push --linked`
- [ ] Verify dakaratekid post-cleanup state via Management API SQL (per `memory/management-api-sql-endpoint.md`):
  - [ ] `user_roles_projection` has only liveforlife row
  - [ ] `users.roles[]` no longer contains 'Cypress Admin'
  - [ ] `accessible_organizations` unchanged (still `[liveforlife]`)
  - [ ] `domain_events` shows `user.role.revoked` event with cleanup reason
- [ ] Run pre-deploy audit NOTICE output: capture any in-flight pending invitations that the new gate WOULD reject. If non-zero, decide per-case (revoke / let-403-land) BEFORE deploying gate to production.

## Handler reference

- [ ] Create `infrastructure/supabase/handlers/api/check_invitation_acceptance_eligibility.sql` matching migration body

## Type regeneration

- [ ] `supabase gen types typescript --linked > frontend/src/types/database.types.ts`
- [ ] `supabase gen types typescript --linked > workflows/src/types/database.types.ts`
- [ ] `cd frontend && npm run gen:rpc-registry` (registry adds `check_invitation_acceptance_eligibility` to ReadRpcs)
- [ ] `cd frontend && npm run typecheck` passes
- [ ] `cd workflows && npm run typecheck` passes

## Edge Function: accept-invitation

- [ ] Add eligibility check in Sally path (after `checkExistingUserPath` confirms userExists, before role-event emission — around `index.ts:580-660`)
- [ ] Call via the EF's service-role admin client (no auth.uid() → service_role GRANT path; see ARCHITECT NOTE C1)
- [ ] Log decision at INFO with `correlationId`, `inviteeUserId`, `targetOrgId`, `decision`; on block also log `existingOrgId` (from `details.existing_provider_org_id`)
- [ ] On `eligible=false`: return 403 with the RPC's error code + message + correlation_id (use existing `createInternalError`/`handleRpcError` helpers)
- [ ] On `eligible=true`: continue existing Sally flow unchanged
- [ ] Bump `DEPLOY_VERSION` constant
- [ ] Update top-of-file comment header with eligibility-gate note + document the TOCTOU window (race between check and emit; benign for v1)

## Edge Function: invite-user (invite-creation, defense-in-depth)

**ARCHITECT NOTE C2 2026-05-13**: this section originally targeted `manage-user`, which is the WRONG file. `user.invited` is emitted only at `invite-user/index.ts:836`. Tasks below corrected.

- [ ] Open `infrastructure/supabase/supabase/functions/invite-user/index.ts`
- [ ] Insert lookup BEFORE the `// CREATE INVITATION` block (around line 786, after the existing 409 duplicate-active-invite check)
- [ ] Email→user lookup (ARCHITECT NOTE on safety):
  - [ ] `SELECT id FROM public.users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL ORDER BY created_at LIMIT 1`
  - [ ] Use a SQL RPC wrapper (e.g., `api.find_user_id_by_email(p_email text)`) OR an existing `api.*` helper if one exists — DO NOT add a wire-tier `.from('users')` call (Rule 19 violation)
  - [ ] **Check before adding new RPC**: grep for existing email-lookup RPCs first; reuse if available
- [ ] If user found: call `api.check_invitation_acceptance_eligibility(p_invitee_user_id, p_target_org_id := orgId)` via `apiRpc<{ eligible: boolean; error?: string; message?: string }>` (read-shape helper)
- [ ] On `eligible=false`: return 422 with `{ error: rpcResult.error, message: rpcResult.message, correlationId }`; do NOT create invitation token; do NOT emit `user.invited`
- [ ] On user-not-found (greenfield invitee): skip eligibility, continue to existing flow
- [ ] Bump `DEPLOY_VERSION` constant
- [ ] Add docblock at top of file documenting the gate + cross-reference to `accept-invitation/index.ts` belt-and-suspenders gate

## Tests

### Deno tests — accept-invitation

- [ ] `eligibility-gate.test.ts`:
  - [ ] eligible=true → existing Sally path continues (mock asserts `user.role.assigned` emission)
  - [ ] eligible=false (cross_provider_invitation_blocked) → 403, no role events emitted
  - [ ] eligible=false (target_org_not_found) → 403, no role events emitted
  - [ ] RPC error (eligError) → handleRpcError envelope, no role events emitted
  - [ ] **`provider_partner` → provider invitee → eligible=true** (ARCHITECT NOTE — use the LIVE enum value `provider_partner`, not the legacy `partner` shown in the doc; guards the future grant pipeline)
  - [ ] **NEW (ARCHITECT NOTE)**: Global super_admin invitee (existing role row with `organization_id IS NULL`) → eligible=true (super_admin should not be gated by this check)
  - [ ] **NEW (ARCHITECT NOTE)**: Future-dated role (`role_valid_from > today`) at another provider → eligible=true (not yet active, so not blocking)
  - [ ] **NEW (ARCHITECT NOTE)**: Expired role (`role_valid_until < today`) at another provider → eligible=true
  - [ ] **NEW (ARCHITECT NOTE)**: Deactivated existing provider org → eligible=true (the stale role doesn't block fresh invite)

### Deno tests — invite-user (NOT manage-user; see ARCHITECT NOTE C2)

- [ ] `invite-eligibility.test.ts`:
  - [ ] eligible=true → invitation created, `user.invited` emitted
  - [ ] eligible=false → 422, no invitation token, no `user.invited` event
  - [ ] No existing user (greenfield invitee, email doesn't match any users row) → no eligibility call, invitation created normally
  - [ ] **NEW (ARCHITECT NOTE)**: Email lookup is case-insensitive (`User@Example.com` matches `user@example.com` projection row)
  - [ ] **NEW (ARCHITECT NOTE)**: Soft-deleted user with matching email is treated as greenfield (deleted_at IS NOT NULL → skip eligibility)

### SQL-level test (RPC unit test) — RECOMMENDED

**ARCHITECT NOTE 2026-05-13**: Deno tests cover the EF integration but not the RPC's own logic in isolation. Add a SQL-level test against the dev DB using the Management API SQL endpoint + the `set_config('request.jwt.claims', ...)` pattern from `memory/simulate-jwt-claims-for-rpc-test.md`. Covers branches without needing an EF deployment:

- [ ] **OPTIONAL but recommended**: Create `infrastructure/supabase/tests/rpc/check_invitation_acceptance_eligibility.test.sql` or document the test queries in the migration's NOTICE audit. Branches to assert:
  - [ ] target_org_not_found
  - [ ] eligible=true when invitee has no other roles
  - [ ] eligible=true when invitee's other role is in `provider_partner` org
  - [ ] eligible=false when invitee has active role in another `provider` org AND target is `provider`
  - [ ] eligible=true when invitee's other role is `role_valid_until < today` (expired)
  - [ ] eligible=true when invitee's other role is at an `is_active = false` org

### CI

- [ ] `supabase-edge-functions-test.yml` runs both new test files
- [ ] `supabase-edge-functions-lint.yml` passes
- [ ] `rpc-registry-sync.yml` passes (registry includes new ReadRpc entry)

## Pre-deploy smoke (against dev, per 2026-05-12 pre-deploy ritual)

- [ ] Apply migration to dev
- [ ] Capture the pre-deploy audit NOTICE output (in-flight pending invitations the new gate would now reject) — paste into card
- [ ] Deploy `accept-invitation` to dev
- [ ] Deploy `invite-user` to dev (NOT manage-user — ARCHITECT NOTE C2)
- [ ] Smoke 1: cross-provider invite-create (e.g., new test user already in liveforlife + invite to testorg) → expect 422 with `cross_provider_invitation_blocked`
- [ ] Smoke 2: same-org re-invite (user re-invited to liveforlife) → expect 200, normal flow
- [ ] Smoke 3: NEW user (no existing roles) invited to testorg → expect 200, new user.created + user.role.assigned (Sally check returns isExistingUser=false; eligibility not called)
- [ ] Smoke 4: Management API SQL confirms dakaratekid restored (per `memory/management-api-sql-endpoint.md`)
- [ ] **NEW**: Smoke 5 — accept-invitation Sally path with cross-provider scenario → expect 403 with `cross_provider_invitation_blocked`, no `user.role.assigned` emitted (verify in `domain_events` via Management API)
- [ ] **NEW**: Smoke 6 — provider_partner-type user invited to provider org → expect 200 (guards future grant pipeline; matches Deno test case)
- [ ] Paste log artifacts (Edge Function logs + DB query results) into card before opening PR

## UAT (post-deploy, post-PR-merge)

- [ ] Run Sally-style invitation acceptance with cleanly-reset state
- [ ] Verify rejection at invite-create UI shows the 422 message clearly
- [ ] Verify dakaratekid is restored to single-org liveforlife state
- [ ] Verify routing for dakaratekid → liveforlife.firstovertheline.com (note: if routing symptom persists, it's the separate follow-up card)

## Docs

- [ ] Update `documentation/architecture/data/provider-partners-architecture.md` (**ARCHITECT NOTE C3 — expanded scope**):
  - [ ] Fix authorization_type naming: `family_consent` → `family_participation`, `agency_assignment` → `social_services_assignment` (DB enum at `baseline_v4.sql:12516` is the source of truth)
  - [ ] Fix `type='partner'` → `type='provider_partner'` throughout (live CHECK at `baseline_v4.sql:13111` is `('platform_owner', 'provider', 'provider_partner')`; legacy `'partner'` is wrong)
  - [ ] Update Org Structure ASCII diagram (lines ~199-243) to use `provider_partner`
  - [ ] Add "Boundary Repair" callout citing this card + cross-referencing the EF docblocks
  - [ ] Bump frontmatter `last_updated` to today
- [ ] **ARCHITECT NOTE (optional improvement)** — prefer EF-docblock as canonical home for boundary-repair rule:
  - [ ] Add full docblock at top of `accept-invitation/index.ts` (eligibility gate, TOCTOU window, return contract)
  - [ ] Add full docblock at top of `invite-user/index.ts` (defense-in-depth gate, email-lookup safety, response contract)
  - [ ] Add a SHORT cross-reference in `infrastructure/supabase/CLAUDE.md` § Critical Rules (one bullet pointing to the two EF docblocks); do NOT duplicate full content there

## Memory

- [ ] Update `MEMORY.md` index entry: close `fix-handle-user-role-assigned-update-accessible-organizations-seed.md`, link to this card
- [ ] New memory file `cross-provider-invitation-rejected.md`: the gate location, the eligibility RPC's return contract, dakaratekid cleanup, what's STILL not enforced (RLS on provider data, grant producer pipeline)

## Follow-up cards (seed, don't work)

- [ ] Seed `dev/active/investigate-auth-callback-priority-2-fallthrough.md`:
  - Why did dakaratekid land on `a4c.firstovertheline.com/clients` when her JWT carries `org_id=liveforlife` and liveforlife's subdomain is verified?
  - Hypothesis: `getOrganizationSubdomainInfo(liveforlife)` failed for her (RPC denial / RLS / thrown exception) → AuthCallback fell through to Priority 3.
  - Suggested investigation: read `frontend/src/services/organization/getOrganizationSubdomainInfo.ts`, trace the underlying RPC, check RLS on `organizations_projection` for `provider_admin` callers viewing their own org.

## PR

- [ ] Branch name: `feat/reject-cross-provider-invitations` (or similar)
- [ ] PR body uses standard template; links to provider-partners-architecture.md and this card
- [ ] PR-D-style observability backfill not needed (no service-layer changes)
- [ ] Architect review: APPROVE WITH IN-PR FIXES is the expected verdict shape per recent norms
- [ ] **NEW (ARCHITECT NOTE)**: PR body must include a "Pre-deploy audit" subsection capturing the NOTICE output of in-flight pending invitations — empty list is the expected result if the gate is shipping ahead of legitimate cross-provider invites
- [ ] **NEW (ARCHITECT NOTE)**: PR body must explicitly note the live enum constraint `('platform_owner', 'provider', 'provider_partner')` and link to the doc-naming fix; reviewers should not be confused by `provider-partners-architecture.md`'s outdated `type='partner'` references
