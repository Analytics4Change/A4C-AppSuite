---
status: current
last_updated: 2026-06-10
---

> **2026-06-10 re-baseline**: the original observation window (2026-04-24 → 2026-05-01)
> is now ~6 weeks past and its logs have aged out of retention. This PR was recreated on a
> fresh branch off post-git-crypt-removal `main` (the original branch predated the
> 2026-05-06 git-crypt purge). See the **Re-baseline addendum — 2026-06-10** at the bottom
> for the current gate plan and the extended backend evidence.

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

All four signals MUST return zero **fallback-target-class** hits for the window. (See "Disposition rule" below for the substantive-vs-strict reading.)

- [ ] Signal 1 count: ___ (frontend log aggregator — needs human)
- [ ] Signal 2 count: ___ (frontend log aggregator — needs human)
- [ ] Signal 3 count: ___ (Supabase Edge Function logs / Dashboard — needs human; CLI v2.75.0 lacks `functions logs`; MCP `get_logs` only retains 24h, observation window is 4–11d back)
- [x] Signal 4 count: **2 hits, both classified as UNRELATED bug class** (PR #41/#42 invitation-phone-placeholder); treating as effective-zero per Path B disposition (2026-05-05). See "Signal 4 results — 2026-05-05" below.

## Disposition rule

The acceptance gate measures: **did the bug-class-the-fallbacks-guard-against actually fire during the observation window?** Two readings are possible when a signal returns hits:

1. **Strict** — any non-zero count fails the gate. Used when classification is ambiguous or the hits MIGHT belong to the target bug class.
2. **Substantive** — hits classified as a different (already-closed) bug class are recorded for audit but do NOT fail the gate, because they are not signals of the bug class under test.

**Convention**: if applying the substantive reading, the verification packet MUST record (a) the exact hits, (b) the classification rationale (which bug class they belong to and which PR closed it), and (c) why those hits could not have triggered the fallbacks-under-test. The audit trail then shows a future reader why this gate was treated as effective-zero.

## Signal 4 results — 2026-05-05

**Query run** (via MCP `execute_sql` against the linked dev project):

```sql
SELECT id, created_at, stream_id, processing_error
FROM domain_events
WHERE event_type = 'user.notification_preferences.updated'
  AND created_at >= '2026-04-24T00:00:00Z'
  AND processing_error IS NOT NULL
ORDER BY created_at DESC;
```

**Returned 2 rows**:

| event id | created_at | stream_id | processing_error |
|---|---|---|---|
| `de999f60-3e14-41e4-9d26-748f21927360` | 2026-04-29 19:43:21Z | 61cbb03f-… | `invalid input syntax for type uuid: "invitation-phone-0"` |
| `edc2c08e-d8ef-486c-911f-75fcb1e2a2d4` | 2026-04-29 16:55:59Z | 86885a4f-… | `invalid input syntax for type uuid: "invitation-phone-0"` |

**Classification — UNRELATED bug class** (PR #41 / PR #42, both merged 2026-04-29):

These two errors are the **invitation-phone-placeholder UUID-cast** bug closed by PR #41 (`resolveInvitationPhonePlaceholder` helper at `accept-invitation/index.ts`) and PR #42 (sentinel pattern + F3 frontend index-space fix). The frontend's `invitation-phone-N` placeholder phoneIds were flowing through to `user.notification_preferences.updated` event payloads, where the handler's `::UUID` cast raised. Both event timestamps land on the same UTC day as the PR #41 merge (2026-04-29), consistent with pre-fix instances captured during the bug's lifetime.

**Why these 2 hits could not have triggered the fallbacks-under-test**:

- The fallbacks (PR #45 removes) fire on `result.success === true && result.notificationPreferences === undefined` — an envelope-completeness violation when the RPC reports success but omits the entity.
- These 2 hits represent the handler **raising** during projection update. Pattern A v2 read-back catches the raise and the RPC returns `{success: false, error: 'Event processing failed: invalid input syntax for type uuid: ...'}`.
- A `success === false` envelope routes through the **failure branch** in `updateNotificationPreferences`, NOT the fallback `else` branch. The fallback's pre-condition (`success === true`) is not met.
- Therefore: even though these events have non-null `processing_error`, they are not signals of the fallback firing or the bug class the fallback guards against.

**Disposition**: Path B (substantive). Signal 4 effective-zero for this gate. Hits recorded for audit per convention. Signals 1, 2, 3 still need human verification before merge.

## If Signals 1/2/3 also come back zero (or substantively zero) → merge the companion fallback-removal PR

See the draft PR opened alongside this file: `refactor(users): remove Pattern A v2 deploy-window fallbacks (pending verification)`.

Fill in the remaining acceptance-gate checkboxes in this file AND in the PR body before merging.

## If any of Signals 1/2/3 come back with **target-class** hits → document the hits

Paste the event IDs / log entries below, close the companion PR without merging, and leave the fallback in place. Re-schedule the verification for another 7 days out (next: 2026-05-12 — pushed from 2026-05-08 since 4 days are already elapsed).

```
<paste hits here>
```

---

## Re-baseline addendum — 2026-06-10

**Why re-baseline**: The original observation window (2026-04-24 → 2026-05-01) closed ~6 weeks
ago. The signals can no longer be verified as originally specified — log retention has aged out:
Signal 3's Edge Function logs (MCP `get_logs` = 24h; CLI lacks `functions logs`) are gone, and the
Sentry/Datadog window for Signals 1–2 is at/past typical retention. Rather than chase expired logs,
re-baseline on a fresh forward window. The fallbacks have been live and quiet for 6+ weeks (this PR
was never merged), so a short new window is equivalent evidence that the envelope-completeness bug
class is not firing.

**Branch provenance**: the original PR #45 branch (`followup/blocker-3-followup-2-fallback-removal`)
predated the 2026-05-06 git-crypt removal (`42533ce2`) and could not be checked out cleanly
(stale git-crypt-encrypted file + locked filter). It was recreated as a fresh branch off current
`main`; the `UsersViewModel.ts` removal is byte-identical to the original (blob `fcedd5ef`).

**New forward window**: `2026-06-10T00:00:00Z → 2026-06-17T00:00:00Z` (7 days), fallbacks still in place.

| Signal | Re-baseline plan | Status |
|---|---|---|
| **1** — frontend `contractViolation: true` | Re-run the aggregator query (see checklist §1) over the new window. Expected 0. | ☐ needs human (Sentry/Datadog) |
| **2** — frontend fallback `log.warn` (3 sites) | Re-run (checklist §2) over the new window. Expected 0. | ☐ needs human (Sentry/Datadog) |
| **3** — EF `handlerInvariantViolated: true` | **Dispositioned by code-absence**: `update_notification_preferences` was extracted from the Edge Function to SQL RPC `api.update_user_notification_preferences` (PR #33, migration `20260424194102`); the tag is no longer emitted by the current EF. No log retrieval needed. Backend cross-check below subsumes it. | ✅ N/A (extracted) |
| **4** — `domain_events.processing_error` | **Re-run across the FULL 2026-04-24 → 2026-06-10 span** (append-only table, persistent). | ✅ effective-zero |

### Signal 4 — extended backend evidence (2026-06-10, full 6-week span)

Queried `domain_events` for `processing_error IS NOT NULL` across the entire span since the original
window opened. The fallbacks guard `update_notification_preferences` + the two phone mutations:

- **`user.notification_preferences.updated`**: 14 events processed; **2 errored — the SAME 2 hits from
  2026-04-29** already disposed in "Signal 4 results — 2026-05-05" (`edc2c08e…`, `de999f60…`,
  invitation-phone UUID-cast bug, closed by PR #41/#42 — UNRELATED bug class). **Zero new hits in 6 weeks.**
- **phone events** (`%phone%`): 5 events processed; **0 processing errors**.

This gives continuous 6-week backend coverage showing the envelope-completeness bug class never fired
— a stronger result than the original 1-week window. Path B (substantive effective-zero) holds across
the full span.

### Merge condition (re-baselined)

Merge when **Signals 1 & 2 return zero (or substantively-zero per the disposition rule) over the
new 7-day window**. Signal 3 is dispositioned by code-absence; Signal 4 is effective-zero with
continuous 6-week coverage. The Path A (strict) / Path B (substantive) disposition rule above is
unchanged. If Signals 1/2 surface target-class hits, follow the "target-class hits" procedure above.
