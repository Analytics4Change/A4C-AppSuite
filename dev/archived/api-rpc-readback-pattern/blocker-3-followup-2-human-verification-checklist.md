---
status: current
last_updated: 2026-05-05
---

# Blocker-3-followup-2 — Human verification checklist (Signals 1, 2, 3)

**Companion to**: [`blocker-3-followup-2-verification-2026-05-01.md`](./blocker-3-followup-2-verification-2026-05-01.md)
**PR**: https://github.com/Analytics4Change/A4C-AppSuite/pull/45
**Disposition path**: B (substantive) — Signal 4 already classified and disposed

This checklist consolidates exactly what to query and where for the three remaining signals so they can be returned in one sitting without re-reading the full verification packet.

**Observation window**: 2026-04-24T00:00:00Z → 2026-05-01T00:00:00Z (UTC).

## Signal 1 — Frontend `contractViolation: true`

**What it would mean**: `updateNotificationPreferences` got `result.success === true` but `result.notificationPreferences` was missing — Edge Function regression or pre-v11 envelope still in rollout. This would mean the fallback fired.

**Where to look** (whichever your environment uses):

| Surface | Query |
|---|---|
| Sentry — Issues / Log Explorer | `contractViolation true` OR `message:updateNotificationPreferences success without notificationPreferences` |
| Datadog Log Search | `@contractViolation:true` OR `"updateNotificationPreferences success without notificationPreferences"` |
| Application-log grep | `grep 'contractViolation' application.log \| grep 'viewmodel'` |
| Browser DevTools console (live, not historical) | filter on `contractViolation` |

**Time bound**: 2026-04-24T00Z → 2026-05-01T00Z.

**Pass condition**: 0 hits.

**If non-zero**: classify (target-class vs unrelated) and apply the disposition rule from the verification packet. Most likely target-class because the message string is specific to this site.

**Result count**: ___ (write here, then tick the corresponding line in the verification packet)

---

## Signal 2 — Frontend fallback `log.warn` (3 sites combined)

**What it would mean**: Any of the three fallback paths fired during the window. Three sites, all in `frontend/src/viewModels/users/UsersViewModel.ts`:

| Site | Method | Lines | Distinguishing message substring |
|---|---|---|---|
| A | `updateNotificationPreferences` | 1866-1875 | `updateNotificationPreferences success without notificationPreferences` (overlaps with Signal 1) |
| B | `updateUserPhone` | 1679-1683 | `updateUserPhone success without phone read-back` |
| C | `addUserPhone` | 1614-1618 | `addUserPhone success without phone read-back` |

**Where to look**:

| Surface | Query |
|---|---|
| Sentry / Datadog | `"falling back to refetch"` (matches all 3 sites) OR `message:*falling back to refetch* AND logger:viewmodel` |
| Application-log grep | `grep 'falling back to refetch' application.log \| grep -E 'updateNotificationPreferences\|updateUserPhone\|addUserPhone'` |

**Time bound**: 2026-04-24T00Z → 2026-05-01T00Z.

**Pass condition**: 0 hits across all three sites.

**Per-site result count**: A: ___ | B: ___ | C: ___ | **Total: ___**

---

## Signal 3 — Edge Function `handlerInvariantViolated: true`

**What it would mean**: `manage-user` Edge Function v11's NOT-FOUND read-back branch fired during the window — handler invariant violated (handler was supposed to UPSERT but the projection row was missing post-emit).

**Architecture caveat**: `update_notification_preferences` was extracted from the Edge Function to SQL RPC `api.update_user_notification_preferences` in PR #33 (migration `20260424194102`, merged 2026-04-24). The window starts the same day as the extraction, so this signal effectively covers a **narrow ~few-hour window** before the cutover. Hits here would mean v11 fired its NOT-FOUND branch in that window.

**Where to look**:

| Surface | Query |
|---|---|
| **Supabase Dashboard** (recommended path — CLI v2.75.0 lacks the `functions logs` subcommand) | `https://supabase.com/dashboard/project/tmrjlswbsxmbglmaclxu/functions/manage-user/logs` → filter on `handlerInvariantViolated` |
| Newer Supabase CLI (≥ v2.95) | `supabase functions logs manage-user --project-ref tmrjlswbsxmbglmaclxu --since 2026-04-24T00:00:00Z --until 2026-05-01T00:00:00Z \| grep 'handlerInvariantViolated'` |

**Time bound**: 2026-04-24T00Z → 2026-05-01T00Z. Realistically anything ≥ 2026-04-24T~18:00Z (after PR #33 cutover) cannot fire this signal because the path was extracted to SQL RPC and the v11 console.error is no longer reached.

**Pass condition**: 0 hits.

**Result count**: ___

---

## Once all three are returned

If all are 0 hits (or substantively-zero per the disposition rule):

1. Tick the boxes in `blocker-3-followup-2-verification-2026-05-01.md` and the PR #45 description.
2. Merge PR #45.
3. Move both verification documents to `dev/archived/api-rpc-readback-pattern/` post-merge.

If any signal returns target-class hits:

1. Paste the event IDs / log entries into the "If any non-zero → document the hits" section of the verification packet.
2. Close PR #45 without merging.
3. Leave the fallback branches in place.
4. Reschedule verification for 2026-05-12 (the original 2026-05-08 reschedule date is already elapsed; pushing to 2026-05-12 to give a fresh 7-day-out target).

---

## Why this checklist exists separately

The original verification packet (`blocker-3-followup-2-verification-2026-05-01.md`) interleaves the queries with detailed rationale and code references — useful for the first reader but verbose for the human running the queries on a follow-up day. This file is the abridged actionable version. The packet remains the authoritative reference; this file is purely for execution speed when you sit down to return Signals 1/2/3.
