/**
 * Unit tests for the Edge Function PII masking utility (_shared/maskPii.ts).
 *
 * Run with: deno test --allow-net _shared/__tests__/maskPii.test.ts
 *
 * Mirrors frontend/src/utils/maskPii.test.ts coverage. Both consumer copies must
 * stay byte-equivalent in the underlying utility — these tests guard regression
 * in the Deno port specifically.
 */

import { assertEquals, assertStringIncludes, assert } from 'https://deno.land/std@0.220.1/assert/mod.ts';

import { maskPii } from '../maskPii.ts';

Deno.test('maskPii: canonical PG_EXCEPTION_DETAIL — Key (email)=(value)', () => {
  const out = maskPii(
    'Event processing failed: duplicate key value - Key (email)=(other-user@acme.com) already exists.',
  );
  assertStringIncludes(out, 'Event processing failed: ');
  assertStringIncludes(out, 'Key (email)=(<redacted>)');
  assert(!out.includes('other-user@acme.com'));
  assert(!out.includes('acme.com'));
});

Deno.test('maskPii: phone PHI in Key (phone)=(value)', () => {
  assertEquals(
    maskPii('Key (phone)=(+15551234567) already exists.'),
    'Key (phone)=(<redacted>) already exists.',
  );
});

Deno.test('maskPii: multi-column key (last_name, first_name)', () => {
  assertEquals(
    maskPii('Key (last_name, first_name)=(Smith, John) already exists.'),
    'Key (last_name, first_name)=(<redacted>) already exists.',
  );
});

Deno.test('maskPii: DOB+name composite key (HIPAA identifier collision)', () => {
  const out = maskPii('Key (date_of_birth, last_name)=(1985-06-12, Smith) already exists.');
  assertEquals(out, 'Key (date_of_birth, last_name)=(<redacted>) already exists.');
});

Deno.test('maskPii: Failing row contains (...) shape', () => {
  const out = maskPii(
    'DETAIL: Failing row contains (550e8400-e29b-41d4-a716-446655440000, john@x.com, John, Smith, 1985-06-12, null).',
  );
  assertStringIncludes(out, 'Failing row contains (<redacted>)');
  assert(!out.includes('john@x.com'));
  assert(!out.includes('Smith'));
});

Deno.test('maskPii: structural strip subsumes inner UUID/email match', () => {
  const out = maskPii(
    'Key (organization_id, email)=(550e8400-e29b-41d4-a716-446655440000, other@acme.com) already exists.',
  );
  assertEquals(out, 'Key (organization_id, email)=(<redacted>) already exists.');
});

Deno.test('maskPii: free-form UUID outside structural shape', () => {
  assertEquals(
    maskPii('User 550e8400-e29b-41d4-a716-446655440000 not found'),
    'User <uuid> not found',
  );
});

Deno.test('maskPii: free-form email outside structural shape', () => {
  assertEquals(maskPii('No invitation found for x@y.com'), 'No invitation found for <email>');
});

Deno.test('maskPii: case-insensitive UUID', () => {
  assertEquals(
    maskPii('User A1B2C3D4-E5F6-7890-ABCD-EF1234567890 not found'),
    'User <uuid> not found',
  );
});

Deno.test('maskPii: non-PII passthrough preserves verbatim', () => {
  const text = 'duplicate key value violates unique constraint "users_email_key"';
  assertEquals(maskPii(text), text);
});

Deno.test('maskPii: null / undefined / empty → empty string', () => {
  assertEquals(maskPii(null), '');
  assertEquals(maskPii(undefined), '');
  assertEquals(maskPii(''), '');
});

Deno.test('maskPii: idempotent on already-masked text', () => {
  const masked = 'Key (email)=(<redacted>) and id=<uuid>';
  assertEquals(maskPii(masked), masked);
});

Deno.test('maskPii: idempotent on doubly-masked structural shape', () => {
  const once = maskPii('Key (email)=(other-user@acme.com) already exists.');
  assertEquals(maskPii(once), once);
});
