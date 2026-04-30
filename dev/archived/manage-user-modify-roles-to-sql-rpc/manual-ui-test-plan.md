# Manual UI Test Plan — modify_user_roles

**Purpose**: Verify the full integration wiring from the role-modification UI through the new `api.modify_user_roles` SQL RPC, the M3-narrowed helpers, the structured-error VM observables, and the `UsersErrorBanner` rendering. This is the "Phase 12 manual smoke" deferred from PR #44 close-out — each layer is unit/component-tested independently, but the full click-through-the-app integration has not been visually verified.

**Estimated time**: 20–30 minutes if you have a tenant admin account ready in dev.

**Pre-conditions**:
- Frontend pointed at a dev or staging Supabase project that has migrations through `20260430172836_fix_rpc_shape_classifications.sql` applied.
- Logged in as a user with `user.role_assign` permission (typically a tenant admin role like `super_admin` or any role granted that permission).
- At least **one target user** in the same org as the logged-in user (not yourself; the RPC's tenancy guard returns NOT_FOUND for cross-tenant users, and self-modification is allowed but harder to reason about during a smoke).
- At least **2–3 roles defined** in the org. If using `testorg-20260329`, the existing roles work fine.
- Supabase SQL editor open in another tab for verification queries (or use the MCP tool from the Claude conversation).

---

## Scenarios

Each scenario lists the steps, the expected UI behavior, and the verification queries. Pass criteria are bolded.

### Scenario 1 — Golden path: add a single role

**Steps**:
1. Navigate to the Users page (`/users` or wherever your nav points).
2. Select a target user (anyone other than yourself in your org).
3. Open the role-edit panel/dialog.
4. Check one role that the user does NOT currently hold.
5. Click **Save** (or whatever the submit button is labeled).

**Expected UI**:
- A success toast or success message appears (`successMessage = 'Roles updated'`).
- The user's role list refreshes to show the newly-added role.
- The error banner does NOT appear.

**Verification SQL** (replace `<userId>` with the target user's UUID):
```sql
-- The user.role.assigned event was emitted and processed cleanly
SELECT id, event_type, processing_error, created_at
FROM domain_events
WHERE stream_id = '<userId>'::uuid
  AND event_type = 'user.role.assigned'
ORDER BY created_at DESC
LIMIT 1;
-- Expected: one row, processing_error IS NULL.

-- The projection row exists for the new (user_id, role_id) pair
SELECT user_id, role_id, organization_id, assigned_at
FROM user_roles_projection
WHERE user_id = '<userId>'::uuid
ORDER BY assigned_at DESC
LIMIT 5;
-- Expected: includes the new role.
```

**Pass**: success message shown, role appears in list, exactly one new `user.role.assigned` event with `processing_error IS NULL`, projection row present.

---

### Scenario 2 — Golden path: remove a single role

**Steps**:
1. Same setup as Scenario 1 with a target user who currently holds at least one role.
2. Uncheck a role the user holds.
3. Save.

**Expected UI**:
- Success message; user's role list updates; error banner absent.

**Verification SQL**:
```sql
-- The revoke event fired
SELECT id, event_type, processing_error, created_at
FROM domain_events
WHERE stream_id = '<userId>'::uuid
  AND event_type = 'user.role.revoked'
ORDER BY created_at DESC
LIMIT 1;
-- Expected: one row, processing_error IS NULL.

-- The projection row is gone
SELECT COUNT(*) FROM user_roles_projection
WHERE user_id = '<userId>'::uuid AND role_id = '<removedRoleId>'::uuid;
-- Expected: 0.
```

**Pass**: success message, role no longer in user's list, `user.role.revoked` event emitted, projection row deleted.

---

### Scenario 3 — Mixed: add and remove in one save

**Steps**: Check at least one new role and uncheck at least one held role in the same submission. Save.

**Expected UI**: Single success message; both changes reflected.

**Verification SQL**:
```sql
-- Both event types emitted, in revoke-then-add order
SELECT id, event_type, processing_error, created_at
FROM domain_events
WHERE stream_id = '<userId>'::uuid
  AND event_type IN ('user.role.assigned', 'user.role.revoked')
  AND created_at > NOW() - INTERVAL '5 minutes'
ORDER BY created_at;
-- Expected: revokes appear before adds (matches the RPC's emission order).
-- All rows have processing_error IS NULL.
```

**Pass**: success message, both changes reflected, all events clean.

---

### Scenario 4 — Validation failure: subset-only violation

**Background**: `validate_role_assignment` rejects role assignments where the role grants a permission the actor doesn't possess (subset-only delegation rule). To trigger this, you need a role that has at least one permission you don't have.

**Setup options**:
- (a) Find/create a role that has a permission your account lacks (e.g., a role with `platform.*` permissions if you're a tenant admin without platform privileges).
- (b) If your account has every permission, you cannot trigger this from your role; sign in as a less-privileged role for this scenario.

**Steps**: Try to add the over-privileged role to a target user. Save.

**Expected UI**:
- The error banner appears with `data-testid="users-error-banner"`.
- The banner contains a child element with `data-testid="role-modification-violation"` (NOT `role-modification-partial-warning`, NOT the generic Error block).
- Inside, an `<li>` element with `data-testid="role-violation-SUBSET_ONLY_VIOLATION"` containing the violation message text.
- Heading reads "Role assignment violation" (singular) for one violation, or "N role assignment violations" for multiple.
- The Dismiss button (`data-testid="users-error-banner-dismiss"`) clears the banner when clicked.
- The user's role list does NOT change (no event was emitted; `validate_role_assignment` runs pre-emit).

**DevTools check**:
- Open DevTools → Elements → search for `data-testid="role-modification-violation"`. Confirm it's present.
- Open Network tab → find the `/rest/v1/rpc/modify_user_roles` POST. Inspect the response body — should contain `{success: false, error: 'VALIDATION_FAILED', violations: [{role_id, role_name, error_code: 'SUBSET_ONLY_VIOLATION', message}]}`.

**Verification SQL**:
```sql
-- No new role-assigned/revoked events should exist for this user in the last minute
SELECT COUNT(*) FROM domain_events
WHERE stream_id = '<userId>'::uuid
  AND event_type IN ('user.role.assigned', 'user.role.revoked')
  AND created_at > NOW() - INTERVAL '1 minute';
-- Expected: 0 (validation failed pre-emit).
```

**Pass**: banner renders with the right testids, no events emitted, dismiss clears the banner.

---

### Scenario 5 — Validation failure: scope hierarchy violation

**Background**: `validate_role_assignment` also rejects roles whose `org_hierarchy_scope` is outside the actor's `user.role_assign` containment. Per the 2026-04-27 codified rule, A4C currently has all `user.*` permissions at org root, so this is unreachable in practice today — every role with a tenant-rooted scope is within reach for any tenant admin.

**This scenario is deferred until the sub-tenant admin design ships.** Note in the test report: "Scenario 5 not exercisable — empirical scope distribution has all `user.role_assign` grants at org root; no sub-tenant admin exists to be denied a cross-OU role."

**Pass**: explicitly noted as deferred (no UI verification possible).

---

### Scenario 6 — No-op: idempotent re-run

**Steps**: Save the role list with no changes (open the role editor, don't change anything, click Save).

**Expected UI behavior**:
- Either the form-validation layer rejects empty submissions before reaching the RPC (best UX), OR
- The RPC's pre-emit check `IF array_length(p_role_ids_to_add, 1) IS NULL AND array_length(p_role_ids_to_remove, 1) IS NULL` returns `{success: false, error: 'INVALID_INPUT', errorDetails: {code: 'INVALID_INPUT', ...}}`. Banner appears with the generic Error block (not violation, not partial).

**DevTools check**: if the RPC is called, the response should be `INVALID_INPUT`. If the form blocks before the call, no `/rpc/modify_user_roles` request appears in the Network tab.

**Pass**: either pre-RPC form validation or post-RPC `INVALID_INPUT` banner; no state corruption.

---

### Scenario 7 — Re-running converges (true idempotency)

**Background**: The RPC is idempotent on its inputs because handlers use ON CONFLICT for assigns and DELETE no-op for revokes. Re-submitting the same change set is safe.

**Steps**:
1. Make a role change and save (as in Scenario 1 or 2). Confirm success.
2. Without changing anything, click Save again.

**Expected UI**: Either form validation blocks the resubmit (no diff to send), OR the RPC accepts and returns success again (the ON CONFLICT path silently no-ops the assigns; the DELETE silently affects 0 rows).

**Pass**: no error; user's role state stays correct; no `processing_error` rows.

---

### Scenario 8 — Banner UI variants (forced via DevTools)

If you don't want to engineer a real partial failure, you can verify the banner's `partial-warning` rendering by manually setting the VM state in DevTools:

**Steps**:
1. Open DevTools console while the Users page is loaded.
2. Find the UsersViewModel instance via React DevTools (search for `UsersViewModel`).
3. In the console, manually set:
   ```javascript
   // Replace `vm` with the actual reference from React DevTools
   import('mobx').then(({ runInAction }) => {
     runInAction(() => {
       vm.lastRolePartialFailure = {
         failureSection: 'remove',
         failureIndex: 1,
         addedRoleEventIds: [],
         removedRoleEventIds: ['evt-1'],
         processingError: 'Manually injected: handler raised',
       };
       vm.error = 'Test partial failure';
     });
   });
   ```
4. Confirm the banner now shows `data-testid="role-modification-partial-warning"` with the recovery copy and `data-testid="role-partial-processing-error"` containing the injected message.
5. Click Dismiss; confirm both `vm.error` and `vm.lastRolePartialFailure` clear.

**Pass**: partial banner renders correctly with all expected testids; dismiss clears state.

(If injecting state manually is awkward, this can also be verified end-to-end by intentionally introducing a handler failure in dev — but that's invasive and the unit test for `UsersErrorBanner` already covers the rendering.)

---

### Scenario 9 — Network shape sanity check

**Steps**: With DevTools Network tab open, perform any successful role modification (Scenario 1, 2, or 3).

**Expected**:
- Request URL: `https://<project>.supabase.co/rest/v1/rpc/modify_user_roles` (POST)
- Request body: `{p_user_id, p_role_ids_to_add, p_role_ids_to_remove, p_reason}`
- **No** call to `/functions/v1/manage-user` with `operation: modify_roles` (that path was removed in Edge Function v15).
- Response: `{success: true, userId, addedRoleEventIds: [...], removedRoleEventIds: [...]}`
- Response headers should include the standard tracing headers (`x-correlation-id`, `traceparent`).

**Pass**: request hits the SQL RPC endpoint, not the Edge Function; response shape matches the Pattern A v2 envelope.

---

### Scenario 10 — Edge Function sanity (negative test)

**Background**: After PR #44, the `manage-user` Edge Function (v15) no longer accepts `operation: 'modify_roles'`. If something in the frontend still calls the old path, this scenario surfaces it.

**Steps** (browser DevTools console):
```javascript
const session = await window.supabase.auth.getSession();
const res = await fetch(
  'https://<your-project>.supabase.co/functions/v1/manage-user',
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.data.session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'modify_roles',
      userId: '00000000-0000-0000-0000-000000000001',
      roleIdsToAdd: [],
      roleIdsToRemove: [],
    }),
  },
);
console.log(res.status, await res.json());
```

**Expected**: HTTP 400 with `{error: 'Invalid operation. Must be "deactivate" or "reactivate"'}`. The Edge Function correctly rejects the legacy operation name.

**Pass**: 400 response confirming v15 deployment took effect.

---

## Test Report Template

After running, fill in:

| # | Scenario | Pass / Fail / Skip | Notes |
|---|---|---|---|
| 1 | Add single role | | |
| 2 | Remove single role | | |
| 3 | Mixed add+remove | | |
| 4 | Subset-only violation | | |
| 5 | Scope hierarchy violation | Skip | Deferred — no sub-tenant admins exist today |
| 6 | No-op submission | | |
| 7 | Idempotent re-run | | |
| 8 | Banner partial-warning variant | | (DevTools-injected acceptable) |
| 9 | Network shape (success) | | |
| 10 | Edge Function rejects legacy op | | |

Any **fail** should open a follow-up issue with:
- Browser + version
- Screenshot of the banner / DevTools state
- Network tab response body
- Verification SQL output

Any **unexpected behavior** that's not strictly a fail (e.g., copy issues, accessibility quirks) should be noted in the report as observations.

---

## Cleanup

After testing, you may want to revert role changes you made on the test user:
```sql
-- View what changed in the last hour for the target user
SELECT event_type, event_data, event_metadata, created_at
FROM domain_events
WHERE stream_id = '<userId>'::uuid
  AND event_type IN ('user.role.assigned', 'user.role.revoked')
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at;
```

Then use the same UI to restore the original role set, OR call `api.modify_user_roles` directly via SQL with the inverse change set.

---

## What this plan does NOT cover

- **Concurrency / race conditions**: two simultaneous role modifications for the same user. The handlers are idempotent on the unique key, so the final state is safe, but interleaving is not exercised.
- **Permission boundary edge cases** that depend on the future sub-tenant-admin design.
- **Browser compat matrix**: Chrome/Firefox/Safari/Edge variations. Test in your team's primary supported browser; cross-browser is a separate concern.
- **Mobile / responsive**: the banner copy is verbose; on narrow viewports the layout may need attention. Out of scope here; track separately if it matters.
