/**
 * Unit tests for `readBackUserCreated` — the wire-tier half of Pattern A v2 on
 * the accept path.
 *
 * Run with:
 *   deno test --allow-net accept-invitation/__tests__/user-created-readback.test.ts
 *
 * # Why this gate exists (PR E — uq_users_email_normalized)
 *
 * `process_domain_event` catches every handler exception with `WHEN OTHERS`,
 * writes `domain_events.processing_error`, and does NOT re-raise. So the outer
 * INSERT commits and `emit_domain_event` returns an id with no error even when
 * `handle_user_created` blew up. Checking only the RPC's `error` cannot detect
 * that — it is null in both cases.
 *
 * Before PR E nothing could make `handle_user_created` raise: it INSERTs
 * `ON CONFLICT (id) DO UPDATE`. PR E adds a UNIQUE index on
 * `btrim(lower(email))` over live rows, and `ON CONFLICT (id)` cannot absorb a
 * collision from a DIFFERENT id. Without this gate, that 23505 produced an auth
 * account with no `public.users` row, no membership, no roles — and a 200 OK.
 *
 * # Test scope
 *
 * The helper's contract only: null to proceed, a 500 Response to abort, and
 * fail-CLOSED when the read-back itself cannot answer. The RPC's own logic is
 * covered by `_shared/__tests__/read-processing-error.test.ts`.
 */

import { assertEquals } from 'https://deno.land/std@0.220.1/assert/mod.ts';

import { readBackUserCreated } from '../index.ts';

// =============================================================================
// Mock Supabase client
// =============================================================================

interface RpcFixture {
  data?: unknown;
  error?: { message: string } | null;
}

function makeMockClient(
  fixture: RpcFixture,
  onRpc?: (name: string, args: unknown) => void,
) {
  return {
    rpc(name: string, args: unknown) {
      onRpc?.(name, args);
      return Promise.resolve({ data: fixture.data ?? null, error: fixture.error ?? null });
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

const EVENT_ID = '00000000-0000-0000-0000-0000000000ee';
const CORRELATION_ID = '00000000-0000-0000-0000-0000000000cc';
const CORS = { 'Access-Control-Allow-Origin': '*' };

// =============================================================================
// Tests
// =============================================================================

Deno.test('readBackUserCreated → null when the event processed cleanly', async () => {
  const client = makeMockClient({ data: null });

  const result = await readBackUserCreated(
    client,
    EVENT_ID,
    CORRELATION_ID,
    CORS,
    'test',
  );

  assertEquals(result, null, 'a clean event must not block the accept flow');
});

Deno.test('readBackUserCreated → 500 when the handler failed', async () => {
  const client = makeMockClient({
    data: 'duplicate key value violates unique constraint "uq_users_email_normalized"',
  });

  const result = await readBackUserCreated(
    client,
    EVENT_ID,
    CORRELATION_ID,
    CORS,
    'test',
  );

  assertEquals(result instanceof Response, true);
  assertEquals(result!.status, 500);

  const body = await result!.json();
  assertEquals(body.errorDetails.code, 'PROCESSING_FAILED');
  assertEquals(body.correlationId, CORRELATION_ID);
});

Deno.test('readBackUserCreated → FAILS CLOSED when the read-back itself errors', async () => {
  // The whole point: "I could not determine whether this worked" must abort,
  // not proceed. A permissive branch here would reopen the silent-failure hole
  // for every caller whose read-back is the thing that broke.
  const client = makeMockClient({ error: { message: 'connection reset' } });

  const result = await readBackUserCreated(
    client,
    EVENT_ID,
    CORRELATION_ID,
    CORS,
    'test',
  );

  assertEquals(result instanceof Response, true);
  assertEquals(result!.status, 500);
});

Deno.test('readBackUserCreated → calls api.get_event_processing_error with the event id', async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const client = makeMockClient({ data: null }, (name, args) => {
    calls.push({ name, args });
  });

  await readBackUserCreated(client, EVENT_ID, CORRELATION_ID, CORS, 'test');

  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, 'get_event_processing_error');
  assertEquals(calls[0].args, { p_event_id: EVENT_ID });
});

Deno.test('readBackUserCreated → masks PII in the surfaced handler message', async () => {
  // Rule: never surface a raw email address. The handler message for a 23505 on
  // uq_users_email_normalized can embed the colliding address verbatim.
  const client = makeMockClient({
    data: 'Key (btrim(lower(email)))=(bob@example.com) already exists.',
  });

  const result = await readBackUserCreated(
    client,
    EVENT_ID,
    CORRELATION_ID,
    CORS,
    'test',
  );

  const body = await result!.json();
  assertEquals(
    body.errorDetails.message.includes('bob@example.com'),
    false,
    'the raw email must not reach the response body',
  );
});
