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

## Phase 0 Findings + Resolution (2026-04-29)

### Empirical answers to Phase 0 open questions

- **Q1 (single emission site)**: Confirmed. Only `accept-invitation/index.ts:682-705` emits `user.notification_preferences.updated` during invitation acceptance. No other paths.
- **Q2 (index-based mapping reliability)**: Currently safe. `createdPhoneIds` is built in array iteration order at line 615. No reordering applied. Future risk if sorting is introduced; not blocking for this fix.
- **Q3 (other placeholder patterns)**: None. Grep confirmed `invitation-phone-${index}` is the only placeholder type. No equivalent bugs for emails, addresses, or other fields.

### Decision: Approach A (substitute-before-emit) was the actual fix

Phase 0 revealed that "Approach B" (emit-after-phones) is what the code already does — phone events fire at lines 610-650, then notification_preferences at 682-705. The missing piece was the substitution step. So Approach A is the surgical fix: a small helper that resolves the placeholder against the already-populated `createdPhoneIds` array.

### Implementation

Added `resolveInvitationPhonePlaceholder` helper (`accept-invitation/index.ts:50-89`); applied at line 728 BEFORE the existing auto-select fallback (so out-of-range placeholders gracefully fall through to "first SMS-capable phone"). Bumped `DEPLOY_VERSION` from `v17-phase6-phones-prefs` to `v18-phone-id-resolution`.

### Affected historical events (pre-fix regression query)

Two on dev — both this session's smoke-test users:
- `de999f60-3e14-41e4-9d26-748f21927360` for `lars.tice+test@gmail.com` (61cbb03f-..., currently deactivated)
- `edc2c08e-d8ef-486c-911f-75fcb1e2a2d4` for `lars.tice+test1@gmail.com` (86885a4f-..., deleted in PR #40 smoke testing)

Production count unknown. Backfill posture per plan: document, do not auto-correct. Failed events preserved with `processing_error` for compliance audit. Recommended ops follow-up post-deploy: invoke `api.retry_failed_event(<event_id>)` for the two affected events so the projection self-heals from the audit row.

## Architect Review Responses (2026-04-29, software-architect-dbc verdict: APPROVE WITH CHANGES)

Five concrete change requests. Five resolutions:

- **C1 — Named type for `Array<{phoneId: string}>`**: addressed. Hoisted `InvitationPhone` to module level (preserving the tight `'mobile' | 'office' | 'fax' | 'emergency'` union type) and added `interface CreatedInvitationPhone { phoneId: string; phone: InvitationPhone }` alongside it. Both used in helper signature, in `createdPhoneIds` declaration, and removed inline duplicate at the request handler.
- **C2 — Correlation context in warn logs**: addressed. Helper now takes a `context: { correlationId?, userId, invitationId }` parameter; all three `console.warn` calls include the context as a structured object. Call site at line 807 passes `{ correlationId, userId, invitationId: invitation.id }` — joinable to the surrounding event chain in production logs.
- **C3 — DbC clarity for `enabled=false + placeholder` case**: documented in helper docblock. Decision: resolve regardless of `enabled` state (call site is unconditional under `if (prefs.sms)`). Rationale: the handler's `::UUID` cast doesn't gate on enabled, so a placeholder must be normalized to UUID-or-null regardless. Resulting projection state (`sms_enabled=false, sms_phone_id=<uuid>`) is consistent with `api.update_user_notification_preferences` read-back contract — a harmless tombstone of inviter intent.
- **C4 — Trust-boundary on UUID pass-through**: implemented option (b) defense-in-depth. Helper now validates that any UUID input matches an entry in `createdPhoneIds` before passing through; foreign UUIDs normalize to null + warn. This prevents a hand-crafted invitation payload from setting `sms_phone_id` to another user's phone or a fabricated UUID. Cost: O(n) check, n bounded by `phones.length` (small). Documented in helper docblock under "Cases".
- **C5 — Backfill ops note**: added to plan above (Recommended ops follow-up). Will also include in PR body.

Plus an invariant comment at the call site (line 727-735) marking that `createdPhoneIds` MUST NOT be reordered, since `resolveInvitationPhonePlaceholder` depends on insertion-order index correspondence with the frontend's `phones[]` array.

DEPLOY_VERSION bumped from `v18-phone-id-resolution` → `v19-phone-id-resolution-hardened` to differentiate the v18 deploy (review-pre) from the v19 deploy (review-incorporated) in production logs.
