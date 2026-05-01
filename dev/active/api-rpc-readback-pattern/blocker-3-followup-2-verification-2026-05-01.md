---
status: current
last_updated: 2026-05-01
---

# Blocker-3-followup-2 Verification — 2026-05-01

Observation window: 2026-04-24 (PR #32 merge, commit `6b4a2fe5`) through 2026-05-01T00:00:00Z (today UTC).

**Context**: PR #32 shipped `manage-user` Edge Function v11, which replaced the v10 echo-based response for `update_notification_preferences` with a real Pattern A v2 read-back. The frontend VM added version-gated fallback branches (`log.warn` + refetch) in three methods: `updateNotificationPreferences`, `updateUserPhone`, and `addUserPhone`. The companion draft PR removes those fallbacks; merge is gated on zero telemetry hits across four signals during this window.

> **Architecture note (post-v11)**: `update_notification_preferences` was subsequently extracted from the Edge Function to SQL RPC `api.update_user_notification_preferences` in migration `20260424194102` (PR #33, Edge Function v12+). The observation window predates that extraction for the phone fallbacks but overlaps with it for the notification-prefs fallback. Signal 3 notes are updated accordingly — see Signal 3 section.

---

## Queries to run

### 1. Frontend telemetry — `contractViolation: true`

**Where it is logged**:
`frontend/src/viewModels/users/UsersViewModel.ts:1866–1875` — inside the `updateNotificationPreferences` method's fallback `else` branch. Fires when the service call returns `{success: true}` but the envelope is missing `notificationPreferences`. This would indicate an Edge Function regression or a pre-v11 response still in the rollout window.

**Exact `log.warn` call** (lines 1866–1875):
```typescript
log.warn(
  'updateNotificationPreferences success without notificationPreferences — ' +
    'v11 envelope MUST include the field on success. Falling back to refetch. ' +
    'Edge Function may have regressed OR pre-v11 envelope still in rollout.',
  {
    userId: request.userId,
    orgId: request.orgId,
    contractViolation: true,
  }
);
```

**How to search**:

_Browser console_ (DevTools → Console tab, filter field):
```
contractViolation
```
or
```
updateNotificationPreferences success without notificationPreferences
```

_Sentry_ (if configured — search in Issues or Log Explorer):
```
contractViolation true
```
```
message:updateNotificationPreferences success without notificationPreferences
```

_Datadog Log Search_:
```
@contractViolation:true
```
```
"updateNotificationPreferences success without notificationPreferences"
```

_Application-log grep_ (if logs are shipped to a file or stdout aggregator):
```bash
grep 'contractViolation' application.log | grep 'viewmodel'
grep 'updateNotificationPreferences success without' application.log
```

_Signal 1 expected count_: **0** for the window to pass.

---

### 2. Frontend telemetry — fallback `log.warn` (three sites)

Three separate fallback sites in `UsersViewModel.ts`. Each fires only when the backend returns `{success: true}` without the expected entity field.

#### Site A — `updateNotificationPreferences` (same branch as Signal 1)

See Signal 1 above. The `contractViolation: true` tag is the distinguishing marker for this site.

**File**: `frontend/src/viewModels/users/UsersViewModel.ts:1866`
**Message substring** (verbatim):
```
updateNotificationPreferences success without notificationPreferences — v11 envelope MUST include the field on success. Falling back to refetch. Edge Function may have regressed OR pre-v11 envelope still in rollout.
```

#### Site B — `updateUserPhone`

**File**: `frontend/src/viewModels/users/UsersViewModel.ts:1679–1683`
**Exact `log.warn` call**:
```typescript
log.warn(
  'updateUserPhone success without phone read-back — falling back to refetch. ' +
    'Backend RPC may be pre-Pattern-A-v2 or on a failed migration.',
  { phoneId: request.phoneId }
);
```
**Message substring** (verbatim):
```
updateUserPhone success without phone read-back — falling back to refetch. Backend RPC may be pre-Pattern-A-v2 or on a failed migration.
```

#### Site C — `addUserPhone`

**File**: `frontend/src/viewModels/users/UsersViewModel.ts:1614–1618`
**Exact `log.warn` call**:
```typescript
log.warn(
  'addUserPhone success without phone read-back — falling back to refetch. ' +
    'Migration 20260423232531 may not be deployed to this environment.',
  { userId: request.userId, phoneId: result.phoneId }
);
```
**Message substring** (verbatim):
```
addUserPhone success without phone read-back — falling back to refetch. Migration 20260423232531 may not be deployed to this environment.
```

**How to search all three sites at once**:

_Browser console_:
```
falling back to refetch
```

_Sentry / Datadog_:
```
"falling back to refetch"
```
```
message:*falling back to refetch* AND logger:viewmodel
```

_Application-log grep_:
```bash
grep 'falling back to refetch' application.log | grep -E 'updateNotificationPreferences|updateUserPhone|addUserPhone'
```

_Signal 2 expected count_: **0** hits across all three sites for the window to pass.

---

### 3. Edge Function log — `handlerInvariantViolated: true`

**Architecture update**: As noted in the context header, `update_notification_preferences` was extracted from the Edge Function to SQL RPC `api.update_user_notification_preferences` in migration `20260424194102` (PR #33). The `handlerInvariantViolated: true` tag existed in the **v11 Edge Function** NOT-FOUND branch (per PR #32 review item Q9.2) and is no longer emitted by the current Edge Function code (v15, deploy version `v15-modify-roles-extracted`). Check both the active window AND the brief v11→extraction window.

**The v11 `console.error` call** (in `manage-user/index.ts` v11, NOT-FOUND read-back path):
```javascript
console.error(
  `[manage-user v11] update_notification_preferences: projection row NOT FOUND after event ${eventId} — handler invariant violated (handler should UPSERT)`,
  { handlerInvariantViolated: true, userId, orgId, eventId }
);
```

**Supabase CLI — stream Edge Function logs**:
```bash
supabase functions logs manage-user --project-ref <REF>
```
Replace `<REF>` with your Supabase project reference (e.g. `abcdefghijklmnop`).

**Filter for the tag**:
```bash
supabase functions logs manage-user --project-ref <REF> | grep 'handlerInvariantViolated'
```

**Date-bounded query** (Supabase CLI supports `--since` / `--until` in ISO 8601):
```bash
supabase functions logs manage-user --project-ref <REF> \
  --since 2026-04-24T00:00:00Z \
  --until 2026-05-01T00:00:00Z \
  | grep 'handlerInvariantViolated'
```

**Supabase Dashboard URL pattern** (Edge Function Logs page):
```
https://supabase.com/dashboard/project/<REF>/functions/manage-user/logs
```
In the Dashboard log viewer, filter by:
```
handlerInvariantViolated
```

**Expected behavior**: Because the operation was extracted to SQL RPC before the observation window ends, any hits would be concentrated in the 2026-04-24 to 2026-04-24T~18:00Z window (approximately when PR #33 was merged). If any hits appear during that narrow window, they indicate a real handler failure that needs investigation.

_Signal 3 expected count_: **0** for the window to pass.

---

### 4. `domain_events.processing_error` for `user.notification_preferences.updated`

This is the authoritative backend signal. It covers both the Edge Function v11 path (2026-04-24) and the SQL RPC path (post-PR #33 cutover). A non-null `processing_error` means the `handle_user_notification_preferences_updated` handler raised an exception during projection write.

```sql
SELECT id, created_at, stream_id, processing_error
FROM domain_events
WHERE event_type = 'user.notification_preferences.updated'
  AND created_at >= '2026-04-24T00:00:00Z'
  AND processing_error IS NOT NULL
ORDER BY created_at DESC;
```

**To also see total event count vs error count** (useful context):
```sql
SELECT
  COUNT(*) FILTER (WHERE processing_error IS NULL)    AS success_count,
  COUNT(*) FILTER (WHERE processing_error IS NOT NULL) AS error_count,
  MAX(created_at) AS last_event_at
FROM domain_events
WHERE event_type = 'user.notification_preferences.updated'
  AND created_at >= '2026-04-24T00:00:00Z';
```

_Signal 4 expected count_: **0 rows with `processing_error IS NOT NULL`** for the window to pass.

---

## Acceptance gate

All four signals MUST return zero hits for the window.

- [ ] Signal 1 count: ___
- [ ] Signal 2 count: ___
- [ ] Signal 3 count: ___
- [ ] Signal 4 count: ___

## If all zero → merge the companion fallback-removal PR

See the draft PR opened alongside this file: `refactor(users): remove Pattern A v2 deploy-window fallbacks (pending verification)`.

Fill in the acceptance-gate checkboxes in this file AND in the PR body before merging.

## If any non-zero → document the hits

Paste the event IDs / log entries below, close the companion PR without merging, and leave the fallback in place. Re-schedule the verification for another 7 days out (2026-05-08).

```
<paste hits here>
```
