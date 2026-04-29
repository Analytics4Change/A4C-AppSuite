/**
 * Unit tests for resolveInvitationPhonePlaceholder
 *
 * Run with:
 *   deno test --allow-net accept-invitation/__tests__/phone-id-resolution.test.ts
 *
 * Establishes the per-Edge-Function test pattern for pure helpers
 * (the parked card `dev/parked/edge-function-deno-test-harness/` had this
 * as its first-target deliverable). Mirrors the `_shared/__tests__/`
 * structure: colocated under the Edge Function directory, imports the
 * helper directly via the `export` keyword.
 *
 * Coverage:
 *   - 6 cases from PR #41 (resolveInvitationPhonePlaceholder's docblock)
 *   - 3 sentinel cases from this card (PR #42, fix-phone-emit-index-preservation)
 */

import {
  assertEquals,
  assertNotEquals,
} from 'https://deno.land/std@0.220.1/assert/mod.ts';

import {
  resolveInvitationPhonePlaceholder,
  type CreatedInvitationPhone,
  type InvitationPhone,
} from '../index.ts';

// =============================================================================
// Test fixtures
// =============================================================================

const ctx = {
  correlationId: 'test-corr-id',
  userId: '00000000-0000-0000-0000-0000000000aa',
  invitationId: '00000000-0000-0000-0000-0000000000bb',
};

function makePhone(label: string, smsCapable = true): InvitationPhone {
  return {
    label,
    type: 'mobile',
    number: '5551234567',
    countryCode: '+1',
    smsCapable,
    isPrimary: false,
  };
}

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';
const UUID_C = '33333333-3333-3333-3333-333333333333';
const UUID_FOREIGN = '99999999-9999-9999-9999-999999999999';

// Three-element happy-path fixture: A, B, C all successfully emitted.
function happyPath(): CreatedInvitationPhone[] {
  return [
    { phoneId: UUID_A, phone: makePhone('Mobile-A') },
    { phoneId: UUID_B, phone: makePhone('Mobile-B') },
    { phoneId: UUID_C, phone: makePhone('Mobile-C') },
  ];
}

// Three-element fixture with a sentinel at index 1 (B's emit failed).
function withSentinelAt1(): CreatedInvitationPhone[] {
  return [
    { phoneId: UUID_A, phone: makePhone('Mobile-A') },
    { phoneId: null, phone: makePhone('Mobile-B') },
    { phoneId: UUID_C, phone: makePhone('Mobile-C') },
  ];
}

// =============================================================================
// PR #41 cases (6)
// =============================================================================

Deno.test('null input returns null', () => {
  const result = resolveInvitationPhonePlaceholder(null, happyPath(), ctx);
  assertEquals(result, null);
});

Deno.test('undefined input returns null', () => {
  const result = resolveInvitationPhonePlaceholder(undefined, happyPath(), ctx);
  assertEquals(result, null);
});

Deno.test('placeholder in range resolves to matching phoneId', () => {
  const result = resolveInvitationPhonePlaceholder('invitation-phone-1', happyPath(), ctx);
  assertEquals(result, UUID_B);
});

Deno.test('placeholder out of range returns null', () => {
  const result = resolveInvitationPhonePlaceholder('invitation-phone-99', happyPath(), ctx);
  assertEquals(result, null);
});

Deno.test('UUID matching createdPhoneIds passes through', () => {
  const result = resolveInvitationPhonePlaceholder(UUID_B, happyPath(), ctx);
  assertEquals(result, UUID_B);
});

Deno.test('UUID NOT in createdPhoneIds returns null (defense-in-depth)', () => {
  const result = resolveInvitationPhonePlaceholder(UUID_FOREIGN, happyPath(), ctx);
  assertEquals(result, null);
});

Deno.test('malformed string returns null', () => {
  const result = resolveInvitationPhonePlaceholder('not-a-uuid-or-placeholder', happyPath(), ctx);
  assertEquals(result, null);
});

// =============================================================================
// Sentinel cases (this card, PR #42)
// =============================================================================

Deno.test('placeholder targeting sentinel slot returns null (CR-2 sentinel-detection)', () => {
  // Index 1 contains the sentinel. The helper must observe the null phoneId
  // and return null with a distinct warn — not silently return null from the
  // generic in-range branch. Verifies CR-2 from architect review.
  const result = resolveInvitationPhonePlaceholder('invitation-phone-1', withSentinelAt1(), ctx);
  assertEquals(result, null);
});

Deno.test('placeholder adjacent to sentinel resolves correctly (sentinel preserves indexing)', () => {
  // Index 0 (Mobile-A) — should resolve to UUID_A unaffected by the sentinel
  // at index 1.
  const result0 = resolveInvitationPhonePlaceholder('invitation-phone-0', withSentinelAt1(), ctx);
  assertEquals(result0, UUID_A);
});

Deno.test('CR-4 integration: index correspondence preserved through sentinel', () => {
  // Load-bearing assertion of this whole card. Construct createdPhoneIds as
  // the loop would build it after a partial failure (B's emit failed → null
  // sentinel at index 1). All three resolutions:
  //   invitation-phone-0 → UUID_A
  //   invitation-phone-1 → null (sentinel slot, warn fires)
  //   invitation-phone-2 → UUID_C  (load-bearing — pre-fix this would
  //                                  return UUID_C *only by luck*; pre-fix
  //                                  the array was [UUID_A, UUID_C] and
  //                                  index 2 was out-of-range)
  const arr = withSentinelAt1();
  assertEquals(resolveInvitationPhonePlaceholder('invitation-phone-0', arr, ctx), UUID_A);
  assertEquals(resolveInvitationPhonePlaceholder('invitation-phone-1', arr, ctx), null);
  assertEquals(resolveInvitationPhonePlaceholder('invitation-phone-2', arr, ctx), UUID_C);
  // Confirm UUID_C is at index 2 in the SENTINEL-INCLUSIVE array — this is
  // the indexing guarantee the sentinel pattern provides. Pre-fix, with
  // sentinel-skipping behavior, UUID_C would have been at index 1 and
  // index 2 would have been out-of-range.
  assertEquals(arr[2].phoneId, UUID_C);
  assertNotEquals(arr[1].phoneId, UUID_C);
});
