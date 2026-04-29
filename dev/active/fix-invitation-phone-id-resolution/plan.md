# Plan — Fix invitation-phone placeholder resolution

## Phases

| Phase | Description |
|-------|-------------|
| 0 | Locate the code path that emits `user.notification_preferences.updated` during invitation acceptance. Likely candidates: `accept-invitation` Edge Function, or a stored procedure called from it. Confirm the exact emission site. |
| 1 | Decide between (a) **substitute-before-emit** (resolve placeholder→real-UUID map, swap phoneId in event_data, then emit) vs (b) **emit-after-phones** (defer the notification_preferences event until all `user.phone.added` events have produced real UUIDs, then emit with inline real UUID). Both are correct; (a) is simpler if the emission site is already after phone creation; (b) is cleaner if the ordering needs reorganizing anyway. |
| 2 | Implement the chosen approach. Add inline test data with a phone array of length ≥ 2 to confirm the index-based mapping works for multiple phones. |
| 3 | Backfill / repair: query for `domain_events` rows with `event_type = 'user.notification_preferences.updated'` AND `processing_error LIKE '%invitation-phone-%'` to identify all users affected so far. For each, the projection row exists but doesn't reflect the inviter's intent. Either: (i) emit a corrective event per user that uses the real UUID, OR (ii) document that affected users should manually re-set their preferences. Probably (ii) — backfill is risky and the audit trail is preserved by leaving the failed event in place. |
| 4 | Verify: re-run invitation acceptance for a fresh test user with SMS preferences on; confirm `user_notification_preferences_projection.sms_enabled = true` and `sms_phone_id = <real UUID>`. |

## Open questions

- **Q1**: Is there a single emission site for `user.notification_preferences.updated` during acceptance, or are there multiple paths (e.g., direct emission vs called from a higher-level orchestration)? Phase 0 must answer.
- **Q2**: Is the placeholder→real-UUID mapping by-index reliable, or do we need to match by phone number / type? By-index works if the acceptance flow preserves the order from the invitation form, but if `user_phones` rows are inserted in a different order (e.g., is_primary first), the index can desync. Worth verifying.
- **Q3**: Are there other places where invitation placeholders flow into events? E.g., `availableEmails` or other arrays? Grep for `invitation-` placeholder pattern broadly.

## Critical files (read-only until Phase 1)

- `frontend/src/pages/users/UsersManagePage.tsx:820-860` — placeholder generation site.
- `infrastructure/supabase/supabase/functions/accept-invitation/index.ts` (likely) — acceptance flow.
- `infrastructure/supabase/handlers/user/handle_user_notification_preferences_updated.sql` (likely) — handler that fails on UUID cast.
- `domain_events` (DB) — failed events to enumerate during backfill triage.

## Verification

- Re-run invitation acceptance with SMS=on for a fresh test user.
- Query `user_notification_preferences_projection` for the new user; expect `sms_enabled = true, sms_phone_id = <real UUID>`.
- Query `domain_events WHERE event_type = 'user.notification_preferences.updated' AND processing_error IS NOT NULL` for the test user; expect zero rows.
