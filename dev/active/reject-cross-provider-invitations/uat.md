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

**Result**: [ ] PASS / [ ] FAIL

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

**Result**: [ ] PASS / [ ] FAIL

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

**Result**: [ ] PASS / [ ] FAIL

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

**Result**: [ ] PASS / [ ] FAIL

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

**Result**: [ ] PASS / [ ] FAIL

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

**Result**: [ ] PASS / [ ] FAIL

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
