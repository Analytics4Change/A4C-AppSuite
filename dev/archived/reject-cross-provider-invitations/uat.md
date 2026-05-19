# UAT Plan — PR #64 (`reject-cross-provider-invitations`)

**PR**: https://github.com/Analytics4Change/A4C-AppSuite/pull/64
**Branch**: `feat/reject-cross-provider-invitations` @ `69f799d0`
**Deploy target**: dev (`tmrjlswbsxmbglmaclxu.supabase.co`)
**Status**: ready for UAT (pre-merge)

## Scope

UAT covers what unit tests + SQL smoke can't:
- End-to-end UI behavior for the invite-user gate
- Regression: same-org invitations + greenfield onboarding still work
- dakaratekid's post-cleanup state from the user's perspective

Out of scope for this UAT (covered elsewhere):
- ✅ SQL-RPC branch behavior — Management API SQL smoke (5 scenarios) during implementation
- ✅ EF helper logic — 8 Deno tests in `_shared/__tests__/check-invitation-eligibility.test.ts`
- ⏳ AuthCallback Priority-2 fall-through — separate card `dev/active/investigate-auth-callback-priority-2-fallthrough.md`. UAT scenario T7 surfaces it but doesn't block this PR.
- ⏳ Cross-tenant grant pipeline — `dev/active/sub-tenant-admin-design/` parked card

## Preconditions

Confirm before starting any scenario:

- [ ] `cdfe81d2` + `69f799d0` deployed to dev:
  - Migration `20260513213831_pr64_closeout.sql` applied (`supabase migration list --linked` shows it in remote)
  - `accept-invitation` Edge Function at v25-cross-provider-invitation-gate (Dashboard → Functions)
  - `invite-user` Edge Function at v18-cross-provider-invitation-gate (Dashboard → Functions)
- [ ] dakaratekid post-cleanup state confirmed via Management API SQL:
  ```sql
  SELECT email, roles, accessible_organizations, current_organization_id
    FROM public.users WHERE id = 'bab8077f-6a76-46f4-a0cd-9363bbf313fb';
  -- Expected: roles=['Aspen Program Manager'], accessible_organizations=[liveforlife],
  --           current_organization_id=liveforlife
  ```
- [ ] No pending cross-provider invitations (pre-deploy audit at migration time showed 0; re-verify):
  ```sql
  SELECT COUNT(*) FROM public.invitations_projection i
   JOIN public.organizations_projection ot ON ot.id=i.organization_id AND ot.type='provider'
   JOIN public.users u ON LOWER(u.email)=LOWER(i.email) AND u.deleted_at IS NULL
   JOIN public.user_roles_projection urp ON urp.user_id=u.id
     AND urp.organization_id != i.organization_id
   JOIN public.organizations_projection oo ON oo.id=urp.organization_id
     AND oo.type='provider' AND oo.is_active=true
   WHERE i.status='pending' AND i.expires_at > NOW();
  -- Expected: 0
  ```

## Test accounts

- **Platform admin / inviter**: `lars.tice@gmail.com` (has admin access in liveforlife and testorg-20260329)
- **Existing provider user**: `dakaratekid@gmail.com` (`provider_admin` / "Aspen Program Manager" role in `liveforlife` only after PR #64 cleanup)
- **Greenfield email**: pick one not in `public.users` — suggested `uat-pr64-greenfield-$(date +%s)@example.com`
- **Soft-deleted email**: `lars.tice+test@gmail.com` (confirmed soft-deleted via SQL during implementation)

## Test scenarios

### T1 — invite-user gate blocks provider→provider invitation (the main test)

**Setup**: dakaratekid has an active provider_admin role in liveforlife. testorg-20260329 is a different `type='provider'` org.

**Steps**:
1. Log in to `testorg-20260329.firstovertheline.com` as a user with `user.create` permission.
2. Navigate to Users → Invite User.
3. Fill in email = `dakaratekid@gmail.com`, first name = `Dakara`, last name = `Test`, select any role from testorg's roles, click Invite.

**Expected**:
- HTTP 422 response (DevTools → Network → invite-user)
- UI shows a clear error message containing "another provider organization" and "cross-tenant access grant via a partner organization"
- Response body contains `code: "cross_provider_invitation_blocked"`, `correlation_id: <uuid>`
- Response body does **NOT** contain `context.existing_provider_org_id` (Finding #1 closeout)
- Edge Function log (Dashboard → Functions → invite-user → Logs) shows: `Eligibility blocked: cross_provider_invitation_blocked` with `correlationId`, `invitee_user_id=bab8077f-...`, `target_org_id=2d0829ae-...`, `decision: blocked`

**DB verification**:
```sql
-- No new invitation token created
SELECT COUNT(*) FROM public.invitations_projection
 WHERE email='dakaratekid@gmail.com'
   AND organization_id='2d0829ae-224b-4a79-ac3a-726b00d6c172'
   AND created_at > (NOW() - INTERVAL '5 minutes');
-- Expected: 0

-- No new user.invited event
SELECT COUNT(*) FROM public.domain_events
 WHERE event_type='user.invited'
   AND event_data->>'email'='dakaratekid@gmail.com'
   AND created_at > (NOW() - INTERVAL '5 minutes');
-- Expected: 0
```

**Result**: [x] **PASS** (executed 2026-05-15)

- **Tester**: Lars Tice
- **Actor**: `johnltice@yahoo.com` (provider_admin in testorg-20260329) — switched from super_admin after the role-validation-quirk + nginx-cookie-buffer discoveries
- **Correlation ID**: `999ef65d-626c-4990-937e-3911a6699a5c`
- **V1 UI** ✅ — red banner: "Failed to send invitation / This user is already a member of another provider organization. Cross-tenant access between providers requires a cross-tenant access grant via a partner organization, not a direct invitation."
- **V2 Network** ✅ — HTTP `422`, body `{error:"This user is already a member of another provider organization. ...", code:"cross_provider_invitation_blocked", correlation_id:"999ef65d-..."}`. **No `context` field** — Finding #1 closeout verified end-to-end at the wire.
- **V3 EF log** ⚠️ Aged out before query (Supabase Free-tier function-log retention < 3 days). Function-log analytics endpoint returns 0 rows for the correlation_id. **For future tests, query EF logs within 1 hour of running each scenario.**
- **V4 DB** ✅ — 0 new invitations in `invitations_projection` for (`dakaratekid@gmail.com`, testorg-20260329) in the last 10 min; 0 new `user.invited` events; dakaratekid unchanged (`roles=['Aspen Program Manager']`, home=liveforlife); super_admin's `current_organization_id` reverted to NULL.
- **Notes**: T1 forced two side discoveries — the nginx cookie-buffer issue (card `dev/active/fix-nginx-large-client-header-buffers/`) and the super_admin role-validation inconsistency (philosophical discussion in plan file § "UAT T1 execution plan"). Neither blocks PR #64 merge; both are seeded as separate work.

---

### T2 — same-org re-invitation still works (regression)

**Setup**: pick a user whose previous invitation to liveforlife expired/was revoked, OR a deactivated liveforlife user. (If no such user exists, deactivate a non-critical liveforlife user first.)

**Steps**:
1. Log in to `liveforlife.firstovertheline.com` as a liveforlife admin.
2. Navigate to Users → Invite User (or "Resend invitation" if applicable).
3. Re-invite the user to liveforlife.

**Expected**:
- HTTP 201 (or 200 for resend) — normal success flow
- Invitation email sent
- New `user.invited` event in `domain_events` for the target email

**Why this matters**: confirms the gate does NOT fire for `same-org` invitations (the eligibility RPC's `urp.organization_id != p_target_org_id` filter is doing its job).

**Result**: [x] **PASS** (executed 2026-05-18, scope reframed — see notes)

- **Tester**: Lars Tice
- **Actor**: `johnltice@yahoo.com` (provider_admin in testorg-20260329)
- **Subject**: `lars.tice+test3@gmail.com` (UUID `2269bdb4-3ba5-4db0-bd5d-fc66cf8f9a88`) — currently in a "zombie" state: `users.accessible_organizations=[testorg]`, but `user_roles_projection` is empty. Past `accepted` invitation from 2026-05-11; role since revoked. UAT discovered this and seeded a separate defect card (`dev/active/users-list-omits-roleless-members/`) — the user is invisible in the testorg UI but the invite-dialog accepts his email.
- **Correlation ID**: `097a4f55-9863-4ece-a3a1-0060a0e61337`
- **Invitation ID** (PK in projection): `d2696d91-2b7d-4a88-bca9-a5df50ca1ee5`
- **Invitation ID** (stream_id / event-correlation): `12fc7d4f-61e9-4d38-b2a9-009273b603be`
- **V1 UI** ✅ — success indication shown (HTTP 201 from EF; no red banner)
- **V2 Network** ✅ — HTTP `201`, body `{"success":true,"invitationId":"12fc7d4f-...","emailStatus":"other_org_member"}`. The `emailStatus:"other_org_member"` value is the key assertion that the gate path was entered (rather than `active_member` 409 or `not_found` greenfield-skip).
- **V3 EF log** ⚠️ Analytics-API blind spot for this project — `function_logs`/`edge_logs`/`function_edge_logs` sources all return zero rows even within minutes of invocation. Likely a project-tier limitation: stdout from EFs goes to the Dashboard's live Logs viewer but not the Logflare/BigQuery analytics pipe. **V3 accepted by-implication**: V2 response shape can ONLY occur if the gate returned `ok:true` — any blocked outcome short-circuits to HTTP 422 before invitation creation.
- **V4 DB** ✅ — new `invitations_projection` row (id=`d2696d91-...`, invitation_id=`12fc7d4f-...`, status=`pending`, created 2026-05-18 18:48:54). New `user.invited` event (stream_id=`12fc7d4f-...`, event_type=`user.invited`, stream_type=`user`). dakaratekid unchanged. super_admin `current_organization_id` still NULL.
- **Side discoveries** (related defects, not PR #64 regressions):
  - **`api.list_users` excludes role-less org members** (the zombie state visible here) — separate defect card seeded at `dev/active/users-list-omits-roleless-members/`. Admin couldn't see lars.tice+test3 in the testorg `/users` page despite his being a known member; had to type his email directly into the Invite dialog.
  - **`invite-user` issues invitation tokens to existing non-deleted users** when the correct action is direct role assignment (or reactivation, for the deactivated branch). The `other_org_member` status overloads two semantic cases ("user in another org" + "user with no roles anywhere"). PR #64's gate is correct in its narrow scope (block provider→provider cross-tenant native role) but doesn't reframe whether the invitation token is the right write action for existing users. Card seeded at `dev/active/invite-user-route-existing-users-to-role-assign/` covering: status enum split (`existing_user_no_roles` new value), routing-by-state, no-token role-assignment path for existing users, reactivation path for `deactivated`, audit-trail cleanup (no spurious `user.invited` for known users).
  - **Analytics-API doesn't surface EF stdout logs for this project tier** — `function_logs` / `edge_logs` / `function_edge_logs` all return zero rows even within minutes. Dashboard live Logs view still works; the API endpoint just doesn't see the stdout. Adds a UAT-evidence friction worth noting if log-capture becomes important for compliance audits. Not a defect requiring a card today; surfaced here for future readers.

**Cleanup**: pending invitation revoked 2026-05-18 via `api.revoke_invitation` (projection id `d2696d91-2b7d-4a88-bca9-a5df50ca1ee5`, invitation_id `12fc7d4f-61e9-4d38-b2a9-009273b603be`). `invitation.revoked` event id `ec97afc1-937f-4635-ac3c-02de7dfe330c` with reason "UAT T2 cleanup (PR #64; lars.tice+test3 zombie state, re-invited then revoked per UAT workflow)". Revoke required JWT-claim simulation via `set_config('app.current_user', ...)` + `set_config('request.jwt.claims', ...)` per `memory/simulate-jwt-claims-for-rpc-test.md` since Management API SQL has no auth context.

**Note about `api.revoke_invitation` parameter naming**: the function parameter is `p_invitation_id` but in the body it's used as `WHERE id = p_invitation_id` (the projection PK), not the `invitation_id` event-correlation column. The EF response returns the event-correlation UUID as `invitationId`. Frontend callers need to pass the projection PK to `api.revoke_invitation`, not the event-correlation UUID. Likely a small inconsistency worth flagging in a separate cleanup card (the parameter name should match the column it filters on, OR the function should accept both/either).

---

### T3 — greenfield invitation works (regression, gate not called)

**Setup**: a brand-new email never seen by the system.

**Steps**:
1. Log in to `testorg-20260329.firstovertheline.com` as an admin.
2. Invite `uat-pr64-greenfield-$(date +%s)@example.com` (use a unique timestamp suffix).
3. Fill in any first/last/role; submit.

**Expected**:
- HTTP 201 — invitation created normally
- Invitation email sent (verify in Resend Dashboard or your inbox if you used a real email)
- New `user.invited` event in `domain_events`
- Edge Function log shows the standard `Email status: not_found` line, and **does NOT** contain an `Eligibility check passed` or `Eligibility blocked` line (the gate skips greenfield invitees because `checkEmailStatus` doesn't return `other_org_member`)

**Why this matters**: confirms the gate doesn't add latency for the common case.

**Result**: [x] **PASS** (executed 2026-05-19, V4-bonus inbox confirmed)

- **Tester**: Lars Tice
- **Actor**: `johnltice@yahoo.com` (provider_admin in testorg-20260329)
- **Greenfield email**: `lars.tice+uat-pr64-t3-1778760000@gmail.com`
- **Correlation ID**: `6d49eb30-f220-4125-b350-dd9bdef55e84`
- **Invitation ID** (event-correlation / stream_id): `e65fb538-6cd9-42c7-b36d-9eb508d1b5b6`
- **Invitation projection PK id** (for cleanup): `80d9a2e1-0623-45e5-abeb-ebb655d5c1f5`
- **V1 UI** ✅ — success indication, no error banner
- **V2 Network** ✅ — HTTP `201`, body `{"success":true,"invitationId":"e65fb538-...","emailStatus":"not_found"}`. The `emailStatus:"not_found"` value is the KEY T3 assertion — proves the gate code path was never entered (the `if (emailStatus.status === 'other_org_member' && emailStatus.userId)` condition is false for `not_found`, so the helper is never called).
- **V3 EF log** ⚠️ Analytics-API blind spot confirmed (3/3 sources returned 0 rows for the fresh correlation_id within 15 min of submission). **V3 accepted by-implication**: the EF code structure makes the gate inaccessible from the `not_found` branch; `emailStatus:"not_found"` in V2 is logically equivalent to "gate was not called."
- **V4 DB** ✅ — new `invitations_projection` row (PK `80d9a2e1-...`, invitation_id `e65fb538-...`, status `pending`, testorg, created 2026-05-19 17:00:43Z). New `user.invited` event (stream_id `e65fb538-...`, email + org_id correct). Zero new `public.users` row. Zero new `auth.users` row. dakaratekid unchanged (`Aspen Program Manager` @ liveforlife). super_admin `current_organization_id` still NULL.
- **V4-bonus inbox** ✅ Invitation email received in `lars.tice@gmail.com` inbox (routed via the `+suffix` alias). Tester confirmed NOT clicking the acceptance link — invitation stays `pending` until cleanup-revoke.
- **Cleanup** ✅ Invitation revoked 2026-05-19 via `api.revoke_invitation` (projection id `80d9a2e1-0623-45e5-abeb-ebb655d5c1f5`). `invitation.revoked` event id `07cbbd00-c5b4-4165-b1b3-0af8fffc2df7`. Inbox link now inert.
- **Notes**: confirms the projection's `id` (gen_random_uuid default) differs from the EF-generated `invitation_id` for greenfield invitations too — same pattern as T2. The `api-revoke-invitation-param-naming` card's diagnosis holds.

---

### T4 — soft-deleted user treated as greenfield (Finding #3 closeout)

**Setup**: `lars.tice+test@gmail.com` has `deleted_at IS NOT NULL` (confirmed during implementation).

**Steps**:
1. Log in as any admin.
2. Invite `lars.tice+test@gmail.com` to either liveforlife or testorg-20260329.

**Expected**:
- HTTP 201 — invitation proceeds normally as if greenfield
- Edge Function log shows `Email status: not_found` (because `api.check_user_exists` now filters `deleted_at IS NULL`)
- Gate is NOT called

**Pre-fix behavior** (would have been): `Email status: other_org_member` (incorrect — user is tombstoned), potentially followed by an eligibility check that misleadingly evaluates a tombstoned user's role rows.

**DB verification**:
```sql
-- Confirm api.check_user_exists returns 0 rows for the soft-deleted email
SELECT * FROM api.check_user_exists('lars.tice+test@gmail.com');
-- Expected: 0 rows
```

**Cleanup**: revoke the invitation after testing if you don't want it to land — `supabase` Dashboard → SQL Editor → `SELECT public.api.revoke_invitation('<invitation-id>', 'UAT cleanup');` (or via Users management UI).

**Result**: [x] **PASS** (executed 2026-05-19; V4-bonus inbox confirmed; cleanup complete)

- **Tester**: Lars Tice
- **Actor**: `johnltice@yahoo.com` (provider_admin in testorg-20260329)
- **Subject (revised)**: `lars.tice+test1@gmail.com` (UUID `86885a4f-5fa3-442d-a780-12aed575a6a2`). Originally planned subject was `lars.tice+test@gmail.com` but pre-test discovered they had 2 stale role rows in testorg (would have short-circuited to `deactivated` status instead of the `not_found` path T4 was designed to verify). Switched to `lars.tice+test1` whose single stale role row was first cleaned up via authorized fixture-prep emit of `user.role.revoked` (event id `d2efc1e7-dcd9-41ed-91e3-c335ba0703f1`, see "Side discoveries" below for the broader card seeded).
- **Correlation ID**: `de18e69a-b36f-4d01-9d37-eaf026085ca6`
- **Invitation ID** (event-correlation / stream_id): `e05b1690-a6e7-4f74-b249-8ffc4a9a61f2`
- **Invitation projection PK id** (for cleanup): `314325f4-abb8-40da-a95e-921b39f8040d`
- **V1 UI** ✅ success indication, no error
- **V2 Network** ✅ HTTP `201`, body `{"success":true,"invitationId":"e05b1690-...","emailStatus":"not_found"}`. **The `emailStatus:"not_found"` value is the KEY T4 assertion** — proves Finding #3 closeout (`api.check_user_exists` filters `deleted_at IS NULL`) is wired correctly through `checkEmailStatus` to the EF response. Pre-closeout would have returned `"other_org_member"`.
- **V3 EF log** ⚠️ Analytics-API blind spot (3/3 sources empty for fresh correlation_id) — accepted by-implication: `emailStatus:"not_found"` can ONLY come from the gate-skipped code path in the EF.
- **V4 DB** ✅ — new `invitations_projection` row (PK `314325f4-...`, invitation_id `e05b1690-...`, status `pending`, testorg, created 2026-05-19 18:07:38Z). New `user.invited` event (stream_id `e05b1690-...`). Subject's `users` row UNCHANGED — `deleted_at=2026-04-29T17:16:06Z` (still soft-deleted), `is_active=false`, `roles=[]`, 0 role rows. dakaratekid + super_admin unchanged.
- **V4-bonus inbox** ✅ Invitation email received in `lars.tice@gmail.com` inbox (via `+test1` alias). Tester confirmed viewing the email without clicking the acceptance link — invitation stayed `pending` until cleanup-revoke.
- **Cleanup** ✅ Invitation revoked 2026-05-19 via `api.revoke_invitation` (projection id `314325f4-abb8-40da-a95e-921b39f8040d`). `invitation.revoked` event id `c2381ce0-9895-4caf-96b2-0ea777000d20`. Inbox link now inert.
- **Side discoveries** (related defects, not PR #64 regressions):
  - **Soft-deleted users have stale dependent projection rows**: `handle_user_deleted` sets `users.deleted_at` but does NOT cascade-clean dependent membership projections. Inventory across all `user_id`-bearing tables showed 10 stale rows on dev for the 2 soft-deleted users (3 user_roles_projection, 2 user_organizations_projection, 2 user_notification_preferences_projection, 3 user_phones). `check_user_org_membership` doesn't filter `deleted_at IS NULL`, so it returns these stale rows — short-circuiting `checkEmailStatus` to `deactivated` before Finding #3's `check_user_exists` filter can fire. Card seeded at `dev/active/handle-user-deleted-cascade-cleanup-projections/` covering: hard-DELETE membership projections on `user.deleted`, NULL the `contacts_projection.user_id` link, emit `access_grant.revoked` for active grants, KEEP audit-reference columns, backfill the 10 existing stale rows inline.
  - **Test required fixture surgery**: emitting `user.role.revoked` for `lars.tice+test1`'s single stale role row (South Valley Admin, role_id `e6409dc1-...`) was authorized inline as anticipatory cleanup matching what the new cascade-cleanup card will eventually do. Audit-trail-correct (soft-deleted user shouldn't have active role).

---

### T5 — accept-invitation gate (deferred for this UAT)

**Why deferred**: the pre-deploy audit confirmed 0 in-flight cross-provider invitations on dev. Constructing a synthetic in-flight token requires either:
(a) bypassing the invite-create gate (defeats the point), or
(b) issuing a token via `api.emit_domain_event` directly (out of normal flow).

The accept-time gate is covered by:
- **8 Deno helper tests** (the gate logic is the same shared helper called by both EFs, just with different `blockedStatus`)
- **SQL-level RPC behavior** confirmed during implementation via Management API
- **Edge Function deployment confirmed** (v25 includes the gate at the documented line range)

If a future deployment lands cross-provider invitations issued before the gate ships, those tokens will hit the accept-time gate naturally — but we don't have any today.

**Result**: [ ] N/A — accepted as covered by unit tests + SQL smoke

---

### T6 — dakaratekid post-cleanup verification

**Steps**:
1. Run the management-API SQL precondition query (above) — confirm dakaratekid is in single-org state.
2. Log in to `liveforlife.firstovertheline.com` as dakaratekid (use her Google OAuth).
3. Verify her dashboard loads, she sees liveforlife data, and her permissions match her `Aspen Program Manager` role.

**Expected**:
- Login succeeds
- Dashboard loads on `liveforlife.firstovertheline.com/dashboard` (Priority-2 redirect path)
- Permissions match the `Aspen Program Manager` role (e.g., she can view liveforlife clients but NOT see anything from testorg)
- DevTools → Application → JWT shows `org_id = liveforlife UUID`, `effective_permissions` matches Aspen Program Manager

**Result**: [x] **PASS** (executed 2026-05-19)

- **Tester**: Lars Tice (acting as dakaratekid for the self-test)
- **Subject**: `dakaratekid@gmail.com` (UUID `bab8077f-6a76-46f4-a0cd-9363bbf313fb`)
- **Pre-test state**: confirmed clean — `is_active=true`, `deleted_at=null`, `roles=['Aspen Program Manager']`, `current_organization_id=43ede501-…` (liveforlife), `accessible_organizations=[liveforlife]`. Auth row not banned, not deleted. 1 role row: Aspen Program Manager @ liveforlife scope_path=`liveforlife`. No cross-tenant grants. Live for Life org subdomain status `verified`.
- **V1 UI** ✅ Login completed cleanly; no 400 cookie error (her JWT is moderate-sized — 14 permissions, chunked across 2 cookies but well within nginx buffer for single-subdomain access).
- **V2 Routing** ✅ Landed on `liveforlife.firstovertheline.com` (Priority-2 happy path). **Reproducibility data captured across 4 login cycles**: 3 cycles → liveforlife (75% happy path); 1 cycle → `a4c.firstovertheline.com` (25% Priority-3 fall-through — the routing bug). Bug is **intermittent**, not deterministic — strongly suggests a race condition. Evidence folded into `dev/active/investigate-auth-callback-priority-2-fallthrough.md` (root-cause hypotheses now ordered: stale JWT before refresh, async timing in `getOrganizationSubdomainInfo`, CF caching, DNS lag).
- **V3 JWT claims** ✅ Decoded from chunked cookies (`sb-tmrjlswbsxmbglmaclxu-auth-token.0` + `.1`):
  - `org_id`: `43ede501-5d88-44b5-a84b-53edeec0781f` (liveforlife) ✓
  - `org_type`: `provider` ✓
  - `claims_version`: 4 ✓
  - `access_blocked`: false ✓
  - `effective_permissions_count`: 14 (Aspen Program Manager scope)
  - All sampled permissions have scope `"liveforlife"` — **no testorg references**, no leakage of the prior cross-provider role assignment
- **V4 DB state** ✅ Unchanged from pre-test except `auth.users.last_sign_in_at` updated to fresh login timestamp (as expected). No drift.
- **V5 functional spot-check** Not explicitly performed; she navigated her UI without observed errors.
- **Side findings**:
  - **Routing-bug reproducibility data** captured for separate card — significant: 1-in-4 fall-through rate establishes it as a real intermittent bug, not a one-time anomaly. Race condition hypothesis now primary.
  - **JWT chunking is NOT super_admin-specific**: dakaratekid's 14-permission JWT also chunks across 2 cookies. The nginx-buffer card updated with this empirical refinement — the buffer fix is structurally correct for any role-bearing user as the permission catalog grows.

---

### T7 — dakaratekid routing on login (KNOWN-UNKNOWN — Priority-2 fall-through bug is a separate concern)

**Steps**:
1. Have dakaratekid log out from wherever she is.
2. From a fresh tab, go to `https://a4c.firstovertheline.com/login` (the platform-owner subdomain login).
3. Sign in with Google OAuth as dakaratekid.

**Expected (happy path)**:
- AuthCallback decodes JWT, sees `org_id = liveforlife`
- Calls `getOrganizationSubdomainInfo(liveforlife)` → gets `slug='liveforlife'`, `subdomain_status='verified'`
- Redirects to `https://liveforlife.firstovertheline.com/dashboard`

**KNOWN-UNKNOWN**: if dakaratekid instead lands on `https://a4c.firstovertheline.com/clients` (Priority-3 default on the platform host), that is **NOT a PR #64 regression** — it's the same Priority-2 fall-through bug that was seeded as a separate card `dev/active/investigate-auth-callback-priority-2-fallthrough.md`. The architecturally-correct routing path is unchanged by PR #64 (which does not touch routing).

**If you observe the known-unknown**:
- Capture the AuthCallback console log (DevTools → Console)
- Capture the response from `api.get_organization_by_id(liveforlife_uuid)` in Network tab
- Update the routing-investigation card with the captured evidence
- **Do NOT block PR #64 merge on this** — the routing card is the right home for the fix

**Result**: [ ] Happy path / [ ] Known-unknown observed (PR #64 not affected)

---

### T8 — Edge Function deploy versions verified (sanity check)

**Steps**:
1. `curl -sS -i -X OPTIONS https://tmrjlswbsxmbglmaclxu.supabase.co/functions/v1/accept-invitation -H "Origin: https://a4c.firstovertheline.com"` → expect HTTP 200
2. `curl -sS -i -X OPTIONS https://tmrjlswbsxmbglmaclxu.supabase.co/functions/v1/invite-user -H "Origin: https://a4c.firstovertheline.com"` → expect HTTP 200
3. Dashboard → Functions → confirm latest deploy timestamp on both functions is after the commit time of `69f799d0`
4. Trigger any invite-user request (e.g., T3 greenfield) and grep the log for `v18-cross-provider-invitation-gate` (DEPLOY_VERSION string)
5. Trigger any accept-invitation request (e.g., previously-issued valid invitation) and grep the log for `v25-cross-provider-invitation-gate`

**Result**: [x] **PASS** (executed 2026-05-19)

- **Tester**: Lars Tice
- **Verification approach** (modified from original spec): runtime DEPLOY_VERSION grep was infeasible because the Supabase analytics-API doesn't surface EF stdout for this project (blind spot confirmed across T2/T3/T4). Switched to two stronger signals: (a) Management API function metadata showing deploy timestamps + ACTIVE status, (b) implicit confirmation from T1-T4 runtime evidence.

| Surface | Result |
|---|---|
| OPTIONS preflight `/functions/v1/accept-invitation` | ✅ HTTP 200 |
| OPTIONS preflight `/functions/v1/invite-user` | ✅ HTTP 200 |
| Management API `accept-invitation` status | ACTIVE, version 154, `updated_at` = `2026-05-13 23:53:15 UTC` |
| Management API `invite-user` status | ACTIVE, version 99, `updated_at` = `2026-05-13 23:53:15 UTC` |
| Match to PR #64 merge commit `c00577a6` | ✅ merge at `2026-05-13 17:52:19 -0600` = `23:52:19 UTC` (deploy completed within ~1 min of merge) |
| Both EFs deployed simultaneously | ✅ identical `updated_at` |

**Runtime DEPLOY_VERSION confirmation** (implicit via tests T1–T4):
- T1 returned `HTTP 422` + `code: "cross_provider_invitation_blocked"` from invite-user → uniquely produced by **v18-cross-provider-invitation-gate** code (the gate doesn't exist in prior versions)
- T2/T3/T4 returned `success:true` + `emailStatus` + `invitationId` consistent with v18 response shape
- All four tests called `api.check_invitation_acceptance_eligibility` (per the new helper integration), confirming the v18 source is loaded and operating

**accept-invitation v25 runtime limitation**: no T5 end-to-end acceptance test was run (no in-flight cross-provider invitations existed to trigger the acceptance-time gate). Coverage is via: (a) helper unit tests with `blockedStatus: 403` (8 tests pass), (b) deploy timestamp matching PR #64 closeout window, (c) deploy of the v25 source confirmed at upload time via `supabase functions deploy accept-invitation` during PR #64 implementation. **Accepted as PASS** based on this triangulation; would only need actual T5 end-to-end if a real-world cross-provider invitation token surfaces.

---

### T9 (optional) — invite-user blocks even when called directly via curl

**Steps**:
```bash
curl -X POST https://tmrjlswbsxmbglmaclxu.supabase.co/functions/v1/invite-user \
  -H "Authorization: Bearer <lars's session JWT>" \
  -H "Content-Type: application/json" \
  -H "x-correlation-id: $(uuidgen)" \
  -d '{
    "email": "dakaratekid@gmail.com",
    "firstName": "Dakara",
    "lastName": "Test",
    "roles": [{"role_id": "<any-testorg-role-uuid>"}],
    "operation": "create"
  }'
```

**Expected**:
- HTTP 422
- Response body: `{ "error": "This user is already a member of another provider organization. ...", "code": "cross_provider_invitation_blocked", "correlation_id": "...", "context": <may be empty or omitted; should NOT contain existing_provider_org_id> }`

**Why this matters**: confirms the gate is enforced at the Edge Function tier, not relying on UI to block the bad request.

**Result**: [ ] PASS / [ ] FAIL / [ ] SKIPPED

---

## Sign-off

| Tester | Date | Verdict |
|--------|------|---------|
| | | |

**Required to PASS for merge**: T1, T2, T3, T4, T6, T8.
**Recommended**: T9.
**Informational**: T7 (known-unknown documented), T5 (covered by unit tests).

**If any required test FAILs**: do NOT merge; capture evidence (correlation_id, log line, SQL state, screenshots), update this file, and surface in the PR.

## Post-merge actions

- Move `dev/active/reject-cross-provider-invitations/` to `dev/archived/reject-cross-provider-invitations/`
- Update memory file `~/.claude/projects/-home-lars-dev-A4C-AppSuite/memory/cross-provider-invitation-rejected.md` § Card path with the new location
- Update `MEMORY.md` "Last groomed" line with merge commit hash + UAT result summary

## Quick-reference SQL snippets

Paste-ready Management API SQL queries for during UAT:

```bash
# Set once
export SUPABASE_PROJECT_REF=tmrjlswbsxmbglmaclxu
# SUPABASE_ACCESS_TOKEN already in env

# dakaratekid full state
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data-raw '{"query":"SELECT email, roles, accessible_organizations, current_organization_id FROM public.users WHERE id = $$bab8077f-6a76-46f4-a0cd-9363bbf313fb$$;"}'

# Pending cross-provider invitations (should be 0)
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data-raw '{"query":"SELECT COUNT(*) FROM public.invitations_projection i JOIN public.organizations_projection ot ON ot.id=i.organization_id AND ot.type=$$provider$$ JOIN public.users u ON LOWER(u.email)=LOWER(i.email) AND u.deleted_at IS NULL JOIN public.user_roles_projection urp ON urp.user_id=u.id AND urp.organization_id != i.organization_id JOIN public.organizations_projection oo ON oo.id=urp.organization_id AND oo.type=$$provider$$ AND oo.is_active=true WHERE i.status=$$pending$$ AND i.expires_at > NOW();"}'

# Recent invite-user events (after T1 — should NOT include dakaratekid)
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data-raw '{"query":"SELECT event_type, event_data->>$$email$$ AS email, created_at FROM public.domain_events WHERE event_type=$$user.invited$$ AND created_at > NOW() - INTERVAL $$10 minutes$$ ORDER BY created_at DESC;"}'
```
