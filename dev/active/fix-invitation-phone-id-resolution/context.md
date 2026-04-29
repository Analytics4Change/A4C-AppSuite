# Fix: invitation-phone placeholder UUIDs leak through invitation acceptance

**Type**: Bug fix
**Status**: 🟢 ACTIVE
**Priority**: Medium — silent partial-data corruption (notification preferences); not a security issue
**Discovered**: 2026-04-29 during smoke testing of `manage-user-delete-rpc-and-scope-retrofit` PR (smoke tests were unblocked; this bug is unrelated to that PR).

## Symptom

When a new user accepts an invitation, the `user.notification_preferences.updated` event is emitted as part of the acceptance flow with `event_data.notification_preferences.sms.phoneId = "invitation-phone-0"` (or `"invitation-phone-1"`, etc. — one per phone the inviter specified). The downstream projection handler attempts `::uuid` cast on this string and fails with:

```
invalid input syntax for type uuid: "invitation-phone-0"
```

The `domain_events` row records `processing_error`. Other invitation-acceptance events (`user.created`, `user.role.assigned`, `user.phone.added`, `invitation.accepted`) succeed because they don't depend on the placeholder. But the user's `user_notification_preferences_projection` row keeps the defaults set by `handle_user_created` (typically `sms_enabled = false, sms_phone_id = NULL`) instead of the SMS preferences the inviter specified.

## Real reproducer

User `lars.tice+test1@gmail.com` invited 2026-04-29 16:54:26 with `sms.enabled = true, phoneId = "invitation-phone-0"`.

Resulting state:
- `user_phones` row created cleanly: `phone_id = 0932ffa5-c5b6-47f1-9e8e-20be6d15c300`, `is_primary = true`, `sms_capable = true`. ✅
- `user_notification_preferences_projection` row: `sms_enabled = false, sms_phone_id = NULL`. ❌ (Inviter said SMS should be on.)
- `domain_events` row for `user.notification_preferences.updated` carries `processing_error`.

## Root cause

`frontend/src/pages/users/UsersManagePage.tsx:832` generates the placeholder IDs at form-fill time:

```typescript
formViewModel.formData.phones
  ?.filter((p) => p.smsCapable)
  .map((p, index) => ({
    id: `invitation-phone-${index}`,
    // Comment: "Backend will map these to real IDs on invitation acceptance"
    ...
  }))
```

The frontend correctly notes that the backend is supposed to resolve these placeholders to real UUIDs during acceptance. Evidently it doesn't. The placeholder string flows verbatim into the `user.notification_preferences.updated` event_data, where the handler's `::uuid` cast blows up.

## Resolution path

The accept-invitation Edge Function (or whichever code emits `user.notification_preferences.updated` during acceptance) needs to:

1. Create the `user_phones` rows first (already happening — `user.phone.added` events fire and produce real UUIDs).
2. Build a placeholder→real-UUID map: `{ "invitation-phone-0": <real_uuid_0>, "invitation-phone-1": <real_uuid_1>, ... }`. The mapping is by index — the order in which phones are added matches the order in the invitation form.
3. Substitute the placeholder in `notification_preferences.sms.phoneId` before emitting the event.

Alternative (cleaner): emit the event AFTER all phones exist and the inviter's preferences are reconciled, with the resolved UUID inline. This keeps the event handler simple — it never sees a placeholder.

## Out of scope

- The `phoneId → phone_id` snake/camel handling on the handler side (unrelated; PR #36 / our PR set the wire convention).
- Any retry/replay of the failed historical event for `lars.tice+test1@gmail.com`. Once the bug is fixed, that user can manually toggle SMS on in their notification preferences UI to issue a new well-formed event.

## References

- Bug discovered during smoke test of `manage-user-delete-rpc-and-scope-retrofit` (commit `19b133ce` on branch).
- Frontend placeholder generation: `frontend/src/pages/users/UsersManagePage.tsx:826-841`.
- Failing event ID: `edc2c08e-d8ef-486c-911f-75fcb1e2a2d4` (preserved with processing_error in `domain_events`).
- Affected user (test): `86885a4f-5fa3-442d-a780-12aed575a6a2` in org `2d0829ae-224b-4a79-ac3a-726b00d6c172`.
- Existing handler reference: `infrastructure/supabase/handlers/user/handle_user_notification_preferences_updated.sql` (or the equivalent — verify location during Phase 0).
