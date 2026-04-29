# Plan — Preserve placeholder index correspondence on phone emit failure

## Phases

| Phase | Description |
|-------|-------------|
| 0 | Confirm Resolution A (sentinel) is the right approach. Read `handle_user_phone_added` to ensure no consumer of `user.phone.added` events depends on assumptions Resolution A would break. |
| 1 | Implement: change `createdPhoneIds` element type to `{ phoneId: string \| null; phone: InvitationPhone }`. On failure, push `{ phoneId: null, phone }`. Update `resolveInvitationPhonePlaceholder` to treat `null` slots as out-of-range (null + warn). |
| 2 | Update auto-select fallback at `accept-invitation/index.ts:817` to filter `phoneId !== null && phone.smsCapable`. |
| 3 | Optionally: emit a `user.phone.add_failed` event (or expand `processing_error` on the original event) to preserve the audit trail of the failure. Decide based on whether the existing `console.error` is sufficient observability. |
| 4 | Add Deno unit tests for `resolveInvitationPhonePlaceholder` with the new null-slot case (depends on `dev/parked/edge-function-deno-test-harness/` — could land first or be deferred). |
| 5 | Smoke test: artificially fail one phone emit (e.g., temporarily bypass the RLS policy or inject a SQL error) and confirm: (a) inviter-selected phone resolves correctly when index lands on a successful slot, (b) inviter-selected phone resolves to null + auto-selects when index lands on a failed slot. |

## Open questions

- **Q1**: Should `user.phone.add_failed` events be emitted, or is `console.error` sufficient? Lean toward console.error for now; expand if observability requirements surface.
- **Q2**: How to artificially trigger a `phoneError` for smoke testing? Options: (a) temporarily revoke RLS on `user_phones`, (b) inject a fault via a feature flag, (c) skip and rely on unit tests. Lean (c) once the test harness lands.

## Critical files

- `infrastructure/supabase/supabase/functions/accept-invitation/index.ts:58-163` (helper)
- `infrastructure/supabase/supabase/functions/accept-invitation/index.ts:743-778` (phone loop)
- `infrastructure/supabase/supabase/functions/accept-invitation/index.ts:806-822` (placeholder resolution + auto-select)
- `infrastructure/supabase/handlers/user/handle_user_phone_added.sql` (handler — read-only check)

## Verification

- Unit tests cover the null-slot case for `resolveInvitationPhonePlaceholder`.
- Manual smoke test (or fault injection) confirms inviter intent is honored when adjacent phones fail to emit.
- No regression in steady-state path (all phones emit successfully).
