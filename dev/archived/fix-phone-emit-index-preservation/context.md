# Fix: phone emit failure should not silently shift placeholder index correspondence

**Type**: Bug fix (defense-in-depth)
**Status**: 🟢 ACTIVE
**Priority**: Medium — silent wrong-phone selection is the same bug class PR #41 closed for `::UUID` cast failures
**Discovered**: 2026-04-29 during PR #41 architect review (Issue 2)

## Symptom

When the `accept-invitation` Edge Function emits `user.phone.added` events in a loop, per-phone emit failures are non-fatal: the loop continues with remaining phones but does NOT push the failed phone into `createdPhoneIds`. This breaks the index correspondence that `resolveInvitationPhonePlaceholder` relies on.

## Concrete failure mode

Frontend sends phones `[A, B, C]` (Office, Mobile-A, Mobile-B). Inviter selects Mobile-A → `prefs.sms.phoneId = "invitation-phone-1"`.

If B's emit transiently fails (network blip, RLS hiccup, handler exception), `createdPhoneIds` becomes `[A_uuid, C_uuid]`. The placeholder resolution in PR #41:
- Index 1 = `C_uuid` (Mobile-B)
- Inviter wanted Mobile-A
- Helper returns `C_uuid` with no error surface beyond a `console.warn`

Result: SMS notifications go to the wrong phone, sms_phone_id is set to a UUID that doesn't match inviter intent, no `processing_error` lands in `domain_events`. **Silent corruption of the inviter's intent.**

This is the same compliance-relevant silent-failure class that PR #41 was filed to close (the `::UUID` cast bug). PR #41 closed the cast-failure path; this card closes the index-shift path.

## Severity

- **Probability**: Low — phone emits rarely fail in steady state
- **Impact**: High when it happens — silent mis-routed SMS in a medication-management platform

## Resolution candidates

### A. Push a sentinel into `createdPhoneIds` on failure
Reserve the slot with `{ phoneId: null, phone }`. The helper at PR #41 then sees `null` for that slot and treats out-of-range or null entries identically (returns null + warns). Index correspondence preserved.

```typescript
} else {
  console.error(`[accept-invitation v${DEPLOY_VERSION}] Failed to emit user.phone.added for ${phone.label}:`, phoneError);
  createdPhoneIds.push({ phoneId: null, phone });  // preserve index
}
```

Helper signature would change from `CreatedInvitationPhone[]` (where `phoneId: string`) to a discriminated union or `phoneId: string | null`. Helper would treat null entries as "out of range" → null + warn.

### B. Make `phoneError` fatal
Return error to the user; rollback or compensate (the `auth.users` row already exists at this point — partial state).

More invasive; user creation is a saga; rolling back invokes complex compensation logic that doesn't exist for this flow. Not recommended.

### C. Hybrid: emit a `user.phone.add_failed` event and proceed
Preserve the audit trail of the failure. Helper still has shifted indexes; same bug. Not sufficient on its own.

### Recommendation: A

Pushing a sentinel is the minimal-blast-radius fix that preserves indexing without changing the user-creation contract.

## Out of scope

- Frontend-side prevention (the frontend will continue sending placeholders; backend is the resolution authority).
- Retry logic for failed `user.phone.added` emits (separate concern; saga-level decision).
- Refactoring `accept-invitation` to a transaction (architectural; out of scope for this fix).

## References

- PR #41 architect review (Issue 2): `software-architect-dbc` adjudication "Issue 2 Risk Re-check"
- `accept-invitation/index.ts:771-777` — current non-fatal `phoneError` handling
- `accept-invitation/index.ts:58-163` — `resolveInvitationPhonePlaceholder` (consumer of the indexed `createdPhoneIds`)
- `accept-invitation/index.ts:806-822` — placeholder resolution + auto-select call sites
