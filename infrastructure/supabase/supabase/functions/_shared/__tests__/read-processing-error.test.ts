/**
 * Unit tests for readProcessingError — the wire-tier half of Pattern A v2.
 *
 * Run with: deno test --allow-net _shared/__tests__/read-processing-error.test.ts
 *
 * ## What this is guarding
 *
 * `api.emit_domain_event` returning a UUID with no error does NOT mean the
 * projection was written. `process_domain_event` catches every handler failure
 * with `EXCEPTION WHEN OTHERS`, records it on `domain_events.processing_error`,
 * and does not re-raise — so the outer INSERT commits and the RPC hands back an
 * id. The handler's own write has already rolled back.
 *
 * Before this helper existed, `invite-user` checked only the RPC's `error` and
 * proceeded: 200 OK, invitation email sent, no row in invitations_projection,
 * and a token that 404s when the recipient clicks it. Nothing in the logs.
 *
 * The fail-closed case below is the one that matters most: if we cannot
 * determine whether processing succeeded, we must not report success.
 *
 * Per-Edge-Function test pattern from PR #42.
 */

import { assert, assertEquals } from 'https://deno.land/std@0.220.1/assert/mod.ts';

import { readProcessingError } from '../emit-event.ts';

type RpcResponse = { data: unknown; error: unknown };

/** Minimal Supabase client stub: `.rpc(name, args)` returns a configured response. */
function mockClient(response: RpcResponse, capture?: { name?: string; args?: unknown }) {
  return {
    rpc(name: string, args: unknown) {
      if (capture) {
        capture.name = name;
        capture.args = args;
      }
      return Promise.resolve(response);
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test('readProcessingError → null when the event processed cleanly', async () => {
  const client = mockClient({ data: null, error: null });
  const result = await readProcessingError(client, 'evt-1');
  assertEquals(result, null);
});

Deno.test('readProcessingError → returns the handler failure message', async () => {
  const client = mockClient({
    data: 'null value in column "organization_id" violates not-null constraint',
    error: null,
  });
  const result = await readProcessingError(client, 'evt-2');
  assertEquals(
    result,
    'null value in column "organization_id" violates not-null constraint'
  );
});

Deno.test('readProcessingError → calls api.get_event_processing_error with the event id', async () => {
  const capture: { name?: string; args?: unknown } = {};
  const client = mockClient({ data: null, error: null }, capture);
  await readProcessingError(client, 'evt-3');
  assertEquals(capture.name, 'get_event_processing_error');
  assertEquals(capture.args, { p_event_id: 'evt-3' });
});

Deno.test('readProcessingError → FAILS CLOSED when the read-back itself errors', async () => {
  // An undeterminable outcome must not be reported as success. Returning null
  // here would let the caller send an invitation email for a row that may not
  // exist — exactly the bug this helper was added to remove.
  const client = mockClient({ data: null, error: { message: 'permission denied' } });
  const result = await readProcessingError(client, 'evt-4');
  assert(result !== null, 'a failed read-back must not look like a clean event');
  assert(
    result!.includes('Unable to verify event processing'),
    `expected a verification-failure message, got: ${result}`
  );
});

Deno.test('readProcessingError → treats undefined data as clean', async () => {
  // PostgREST returns undefined rather than null for a void/NULL scalar in some
  // client versions; both mean "no processing error recorded".
  const client = mockClient({ data: undefined, error: null });
  assertEquals(await readProcessingError(client, 'evt-5'), null);
});
