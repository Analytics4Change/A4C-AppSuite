/**
 * Unit tests for the masked HTTP response helpers (_shared/error-response.ts).
 *
 * Run with: deno test --allow-net _shared/__tests__/error-response.test.ts
 *
 * Covers the PII-masking patches at handleRpcError() and createInternalError() —
 * both of which surface error.message into HTTP response body.details and were
 * pre-mask the primary leak vector for Edge Functions.
 */

import { assertEquals, assertStringIncludes, assert } from 'https://deno.land/std@0.220.1/assert/mod.ts';

import { handleRpcError, createInternalError } from '../error-response.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

async function readBody(res: Response): Promise<{ details?: string; error?: string }> {
  return await res.json();
}

Deno.test('handleRpcError masks PG_EXCEPTION_DETAIL in details field', async () => {
  const res = handleRpcError(
    {
      message: 'duplicate key value - Key (email)=(other@acme.com) already exists',
    },
    'corr-1',
    corsHeaders,
    'invite',
  );
  const body = await readBody(res);
  assertStringIncludes(body.details ?? '', 'Key (email)=(<redacted>)');
  assert(!(body.details ?? '').includes('other@acme.com'));
});

Deno.test('handleRpcError masks UUID in error string surfaced to UI', async () => {
  const res = handleRpcError(
    {
      message: 'User 550e8400-e29b-41d4-a716-446655440000 not found',
    },
    'corr-2',
    corsHeaders,
    'lookup',
  );
  const body = await readBody(res);
  // The 'Event processing failed:' prefix-detection short-circuits to a generic UI message;
  // the un-prefixed input should preserve the operation prefix and mask the UUID in details.
  assertStringIncludes(body.details ?? '', '<uuid>');
  assert(!(body.details ?? '').includes('550e8400'));
});

Deno.test('handleRpcError preserves Event processing failed prefix', async () => {
  const res = handleRpcError(
    {
      message: 'Event processing failed: handler raised',
    },
    'corr-3',
    corsHeaders,
  );
  const body = await readBody(res);
  // userMessage is replaced with friendly text when prefix matches; details still has masked input.
  assertStringIncludes(body.details ?? '', 'Event processing failed: handler raised');
});

Deno.test('createInternalError masks UUID/email in details', async () => {
  const res = createInternalError(
    'corr-4',
    corsHeaders,
    'rpc failed for 550e8400-e29b-41d4-a716-446655440000 with email a@b.com',
  );
  const body = await readBody(res);
  assertStringIncludes(body.details ?? '', '<uuid>');
  assertStringIncludes(body.details ?? '', '<email>');
  assert(!(body.details ?? '').includes('550e8400'));
  assert(!(body.details ?? '').includes('a@b.com'));
});

Deno.test('createInternalError omits details when not provided', async () => {
  const res = createInternalError('corr-5', corsHeaders);
  const body = await readBody(res);
  assertEquals(body.details, undefined);
});
