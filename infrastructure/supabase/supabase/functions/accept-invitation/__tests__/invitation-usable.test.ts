/**
 * Unit tests for `checkInvitationUsable` — the acceptance precondition.
 *
 * Run with:
 *   deno test --allow-net accept-invitation/__tests__/invitation-usable.test.ts
 *
 * # What this is guarding (PR A commit 1)
 *
 * Until migration `20260731195015`, **nothing on the accept path consulted
 * `status`**. Revocation writes `status` and `updated_at` only — the token stays
 * live and `expires_at` is untouched — so the two pre-existing guards (clock and
 * accepted_at) both passed for a revoked invitation. A holder of a revoked
 * token could reach `auth.admin.createUser` and get a working account.
 *
 * The migration closed it at the source by filtering
 * `api.get_invitation_by_token` to `status='pending'`. These tests pin the
 * belt-and-braces guard that must survive anyone later relaxing that filter.
 */

import { assertEquals } from 'https://deno.land/std@0.220.1/assert/mod.ts';

import { checkInvitationUsable } from '../index.ts';

const NOW = new Date('2026-07-31T12:00:00Z');
const FUTURE = '2026-08-07T12:00:00Z';
const PAST = '2026-07-24T12:00:00Z';

Deno.test('checkInvitationUsable → usable for a live pending invitation', () => {
  const result = checkInvitationUsable(
    { status: 'pending', expires_at: FUTURE, accepted_at: null },
    NOW,
  );
  assertEquals(result.usable, true);
});

Deno.test('checkInvitationUsable → REFUSES a revoked invitation with a live token', () => {
  // The headline case. Before PR A this returned usable — the token was live,
  // the expiry was in the future, and nothing looked at status.
  const result = checkInvitationUsable(
    { status: 'revoked', expires_at: FUTURE, accepted_at: null },
    NOW,
  );
  assertEquals(result.usable, false);
  assertEquals(result.usable === false && result.code, 'INVITATION_NOT_PENDING');
});

Deno.test('checkInvitationUsable → refuses a clock-expired invitation that is still status=pending', () => {
  // NOT redundant with the RPC's status filter: expiration is lazy, so nothing
  // sweeps the projection and `pending` + past-expiry is a real, common state
  // the RPC passes straight through. Deleting this check would reopen
  // acceptance of expired invitations.
  const result = checkInvitationUsable(
    { status: 'pending', expires_at: PAST, accepted_at: null },
    NOW,
  );
  assertEquals(result.usable, false);
  assertEquals(result.usable === false && result.code, 'INVITATION_EXPIRED');
});

Deno.test('checkInvitationUsable → refuses an already-accepted invitation', () => {
  const result = checkInvitationUsable(
    { status: 'accepted', expires_at: FUTURE, accepted_at: '2026-07-30T00:00:00Z' },
    NOW,
  );
  assertEquals(result.usable, false);
  assertEquals(result.usable === false && result.code, 'INVITATION_ALREADY_ACCEPTED');
});

Deno.test('checkInvitationUsable → refuses any unrecognised status (fails closed)', () => {
  // `chk_invitation_status` permits 'deleted' with no writer today, and future
  // statuses must degrade to a refusal rather than fall through to acceptance.
  for (const status of ['deleted', 'draft', '', null, undefined]) {
    const result = checkInvitationUsable(
      { status, expires_at: FUTURE, accepted_at: null },
      NOW,
    );
    assertEquals(
      result.usable,
      false,
      `status=${JSON.stringify(status)} must not be acceptable`,
    );
  }
});

Deno.test('checkInvitationUsable → the refusal message does not disclose which terminal state', () => {
  // A caller holding only a token must not learn revoked-vs-deleted from the
  // accept endpoint. The precise reason is served by
  // api.get_invitation_token_state, which returns an enum and no tenant data.
  const revoked = checkInvitationUsable(
    { status: 'revoked', expires_at: FUTURE, accepted_at: null },
    NOW,
  );
  const deleted = checkInvitationUsable(
    { status: 'deleted', expires_at: FUTURE, accepted_at: null },
    NOW,
  );
  assertEquals(
    revoked.usable === false && revoked.message,
    deleted.usable === false && deleted.message,
  );
});
