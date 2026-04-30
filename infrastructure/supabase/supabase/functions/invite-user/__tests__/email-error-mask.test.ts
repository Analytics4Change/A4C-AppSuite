/**
 * Unit tests for invite-user email error masking.
 *
 * Run with: deno test --allow-net invite-user/__tests__/email-error-mask.test.ts
 *
 * sendInvitationEmail bypasses the shared error-response chokepoint and constructs
 * its own error string from the catch path. This test verifies the maskPii application
 * at index.ts:382 (catch path) and the Resend errorData.message path at index.ts:369.
 *
 * Per-Edge-Function test pattern from PR #42.
 */

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.220.1/assert/mod.ts';

import { sendInvitationEmail } from '../index.ts';

const baseParams = {
  email: 'recipient@example.com',
  firstName: 'Alice',
  lastName: 'Smith',
  orgName: 'Acme Org',
  token: 'tok-abc',
  expiresAt: new Date('2026-12-31T23:59:59Z'),
  frontendUrl: 'https://app.example.com',
  baseDomain: 'example.com',
};

Deno.test('sendInvitationEmail: catch path masks UUID/email in error.message', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error(
      'connect ECONNREFUSED for user 550e8400-e29b-41d4-a716-446655440000 with email leaked@x.com',
    );
  };

  try {
    const result = await sendInvitationEmail('rsk_test_123', baseParams);
    assertEquals(result.success, false);
    assertStringIncludes(result.error ?? '', 'Failed to send email: ');
    assertStringIncludes(result.error ?? '', '<uuid>');
    assertStringIncludes(result.error ?? '', '<email>');
    assert(!(result.error ?? '').includes('550e8400'));
    assert(!(result.error ?? '').includes('leaked@x.com'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('sendInvitationEmail: Resend non-OK response masks errorData.message', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          message: 'Validation error: invalid recipient leaked@x.com',
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      ),
    );

  try {
    const result = await sendInvitationEmail('rsk_test_123', baseParams);
    assertEquals(result.success, false);
    assertStringIncludes(result.error ?? '', 'Resend API error: 422');
    assertStringIncludes(result.error ?? '', '<email>');
    assert(!(result.error ?? '').includes('leaked@x.com'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
