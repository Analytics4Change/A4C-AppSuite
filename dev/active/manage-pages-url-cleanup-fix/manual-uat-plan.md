# Manual UAT — Stale URL param after entity delete (PR #46)

**PR**: https://github.com/Analytics4Change/A4C-AppSuite/pull/46
**Branch**: `fix/manage-pages-clear-deleted-id-from-url`
**Surfaced by**: Manual UI smoke test of the modify_user_roles plan, 2026-05-05 — Test 2 (single role removal) reporter landed on `/roles/manage?roleId=...` after deleting a role and saw _"Role could not be loaded. Please refresh the page."_

**Estimated time**: 25–35 minutes if you have admin accounts on the four affected pages prepared (or are willing to seed test entities just for deletion).

---

## What the fix changes

Each of four manage pages, in `handleDeleteConfirm` after `result.success`, now calls `setSearchParams(...)` with `{ replace: true }` to remove the stale entity-id from the URL. This stops the URL→state effect from re-firing on a deleted entity and surfacing the misleading "could not be loaded" error.

| Page | Param now cleared on delete | Test scenarios below |
|---|---|---|
| `/roles/manage` | `roleId` | 1, 5, 9 |
| `/users/manage` | `userId`, `invitationId` | 2, 6, 10 |
| `/schedules/manage` | `templateId` | 3, 7 |
| `/organizations/manage` | `orgId` | 4, 8 |

`/organization-units/manage` was audited as **not affected** (its URL→state effect gracefully no-ops on missing entities). It is included in scenario 11 as a regression check — its existing behavior should be unchanged.

---

## Pre-conditions

- Frontend pointed at a dev/staging Supabase project with both PR #44 (modify_roles + M3 registry) and PR #46 (this fix) applied. Local checkout = `fix/manage-pages-clear-deleted-id-from-url`; `npm run dev`.
- Logged in as a tenant admin in `testorg-20260329` (or any tenant where you can freely create + delete entities).
- For each page, **at least one disposable entity** to delete:
  - **Role**: a custom (non-canonical) role you can delete. If none exists, create one first via the Roles list.
  - **User**: an invited or existing test user. Use a low-privilege test account.
  - **Schedule template**: a draft or unused template.
  - **Organization**: this is more invasive — only test on a true dev/staging tenant you're willing to lose. Skip if no disposable org is available; mark scenario 4 as deferred.
- DevTools open (Network + Console + Elements tabs).

---

## Baseline: reproduce the bug pre-fix (optional but recommended)

Before applying the fix branch, do this once on `main` to confirm you reproduce the same symptom the reporter hit:

1. Check out `main` locally; `npm run dev`.
2. Navigate to `/roles/manage?roleId=<X>` where X is a deletable role's UUID.
3. Click Delete; confirm.
4. **Expected pre-fix**: deletion succeeds in the backend, but the page surfaces _"Role could not be loaded. Please refresh the page."_ The URL still contains `?roleId=<X>`.

If you skip this baseline, the post-fix scenarios are still meaningful — you're just trusting the bug report.

---

## Scenarios

### Scenario 1 — Roles: delete via deep-link

**Steps**:
1. Navigate to `/roles/manage?roleId=<X>` where X is a deletable role.
2. Click Delete in the role panel; confirm in the dialog.
3. Wait for the dialog to close.

**Expected**:
- The role is removed from the role list.
- **No error banner.**
- The URL is now `/roles/manage` (no `?roleId=` query param).
- Panel returns to empty state.

**DevTools**:
- Network: a `POST /rest/v1/rpc/delete_role` (or whatever the role-delete endpoint is) returned 2xx.
- Address bar updates to drop the `roleId` query param.
- No `setOperationError` console line.

**Pass**: success path completes without the stale error; URL is clean.

---

### Scenario 2 — Users: delete via deep-link

**Steps**:
1. Navigate to `/users/manage?userId=<U>` where U is a deletable test user.
2. Use the Delete action (typically in a Danger Zone panel) and confirm.

**Expected**:
- User removed from list.
- Toast: "User deleted".
- URL drops to `/users/manage` (no `?userId=`).
- No error banner.

**Pass**: as scenario 1, plus `userId` removed from URL.

---

### Scenario 3 — Schedule templates: delete via deep-link

**Steps**:
1. Navigate to `/schedules/manage?templateId=<T>` where T is a deletable template (no users currently assigned, or the page handles HAS_USERS gracefully).
2. Click Delete; confirm.

**Expected**:
- Template removed from list.
- URL drops to `/schedules/manage`.
- No error banner.

**Edge**: if the template has assignments, the delete is rejected with a HAS_USERS dialog (preserved behavior — not affected by the fix). The URL should still contain the `templateId` because the delete didn't succeed. **That is correct.**

**Pass**: success path drops the param; failure path preserves it (since the entity still exists).

---

### Scenario 4 — Organizations: delete via deep-link (skip if no disposable org)

**Steps**:
1. Navigate to `/organizations/manage?orgId=<O>` where O is a disposable test org (only on a dev/staging tenant where you accept the cost).
2. Click Delete; confirm with the appropriate reason.

**Expected**:
- Organization disappears from the list (or shows as deleted depending on UX).
- URL drops to `/organizations/manage`.
- No error banner.

If no disposable org is available, mark this scenario **Skip — no disposable org**.

---

### Scenario 5 — Roles: delete via list selection (no deep-link)

**Steps**:
1. Navigate to `/roles/manage` with NO `?roleId=` in URL.
2. Click a role in the list to load it into the panel.
3. Click Delete; confirm.

**Expected**:
- Same as scenario 1 — role gone, URL clean, no error banner.

**Why this scenario exists**: confirms the fix is robust to whatever path got the user to "viewing role X." Without deep-link, the URL→state effect's re-fire path isn't triggered, but the fix still applies (idempotently) and shouldn't break the no-deep-link flow.

**Pass**: same outcome as scenario 1.

---

### Scenario 6 — Users: delete via list selection (no deep-link)

**Steps**: as scenario 5, but on `/users/manage`. Click a user, delete, confirm.

**Pass**: user gone, URL stays clean (`/users/manage`), no error banner.

---

### Scenario 7 — Schedules: delete via list selection

**Steps**: as scenario 5, on `/schedules/manage`. Click a template, delete, confirm.

**Pass**: template gone, URL clean, no error banner.

---

### Scenario 8 — Organizations: delete via list selection (skip if no disposable org)

**Steps**: as scenario 5, on `/organizations/manage`.

**Pass / Skip**: same conditional as scenario 4.

---

### Scenario 9 — Roles: delete-failure preserves URL state

**Goal**: confirm the fix only fires on success, not on the dialog/error path.

**Steps**:
1. Navigate to `/roles/manage?roleId=<X>` for a role X that you cannot delete (e.g., a canonical/system role, or a role that has active users assigned that triggers a guard).
2. Attempt to Delete it. The page should reject (canonical roles), or the dialog should switch to a "deactivate first" / "still active" prompt.

**Expected**:
- Delete is rejected. The role is still present.
- The URL **still contains** `?roleId=<X>`. (No setSearchParams call on the failure path.)
- The panel still shows the role; no stale error banner.

**Pass**: failure path is unchanged by the fix.

---

### Scenario 10 — Users: delete-failure preserves URL state

**Steps**: trigger a delete failure on a user (e.g., attempt to delete an active user that requires deactivation first, or simulate a transient failure with DevTools network throttling).

**Expected**: failure path leaves `?userId=<U>` in the URL because the entity still exists. Banner shows the failure message.

**Pass**: failure path unchanged.

---

### Scenario 11 — OrganizationUnits regression (not affected by fix)

**Background**: This page was audited and is **not** affected by the bug class — its URL→state effect already no-ops on missing entities. Verify nothing has regressed.

**Steps**:
1. Navigate to `/organization-units/manage?select=<U>` where U is a disposable leaf OU.
2. Delete the OU; confirm.

**Expected**: existing behavior preserved — page selects the parent OU (line 538 of OrganizationUnitsManagePage.tsx) on successful delete; if no parent, panel goes empty. No stale "could not load" error either way (the effect at line 245 `if (unit)` already handles missing-unit gracefully).

**Pass**: no regression. Behavior identical to pre-fix `main`.

---

### Scenario 12 — Bookmark a deleted entity (out-of-scope but worth noting)

**Goal**: This is the scenario PR #46 explicitly does **not** cover. Verify it still fails the same way (i.e., we haven't changed it accidentally).

**Steps**:
1. Note a roleId before deletion: `<X>`.
2. Delete role X via any UI path; verify it's gone.
3. Manually paste `https://<host>/roles/manage?roleId=<X>` into a new tab (simulating a stale bookmark).

**Expected**: page loads, the URL→state effect fires on the deleted ID, `getRoleById(X)` returns null, banner shows "Role could not be loaded. Please refresh the page."

**This is correct behavior** — the user explicitly navigated to a non-existent entity. The fix only addresses the case where the deletion happens in-app (where the URL has authority and should be cleaned).

**Pass**: behavior matches expectation (banner shown for a true dead-bookmark navigation). If this also drops the URL silently, it's actually a regression in error-surfacing — flag it.

---

## Test Report Template

| # | Scenario | Pass / Fail / Skip | Notes |
|---|---|---|---|
| Baseline | Reproduce pre-fix on `main` (Roles) | | (Optional) |
| 1 | Roles delete via deep-link | | |
| 2 | Users delete via deep-link | | |
| 3 | Schedules delete via deep-link | | |
| 4 | Organizations delete via deep-link | | (Skip if no disposable org) |
| 5 | Roles delete via list selection | | |
| 6 | Users delete via list selection | | |
| 7 | Schedules delete via list selection | | |
| 8 | Organizations delete via list selection | | (Skip if no disposable org) |
| 9 | Roles delete-failure preserves URL | | |
| 10 | Users delete-failure preserves URL | | |
| 11 | OrganizationUnits regression check | | |
| 12 | Bookmark to deleted entity (regression) | | |

Any **fail** should open a follow-up issue with:
- Browser + version
- Screenshot of the URL bar + any banner
- DevTools Network tab response (for the delete RPC)
- Console errors if any

---

## Cleanup

After running, no special cleanup needed for the fix itself. If you created disposable test entities (roles, users, templates) just for deletion, they're gone.

---

## What this plan does NOT cover

- **Browser back/forward navigation interaction** with the URL change. The fix uses `{replace: true}` on `setSearchParams` so the deletion doesn't add a new history entry — pressing Back from the post-delete page should land on whatever the user was on before opening the role detail. Worth checking once but not a primary scenario.
- **Concurrent delete + URL update race**: if two tabs delete the same entity simultaneously, the URL fix on the second tab could fire after the entity is already gone from the projection. Behavior should be benign (URL just gets cleaned twice) but isn't exercised.
- **Mobile / responsive layouts** of the delete confirmation dialog. Out of scope.
