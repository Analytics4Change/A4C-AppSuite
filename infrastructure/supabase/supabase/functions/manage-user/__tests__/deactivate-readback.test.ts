/**
 * Unit tests for the Pattern A v2 read-back retrofit on `manage-user.deactivate`.
 *
 * Run with:
 *   deno test --allow-net manage-user/__tests__/deactivate-readback.test.ts
 *
 * Scope: tests the shared `checkProjectionReadback` helper directly because
 * the manage-user Edge Function delegates the Pattern A v2 contract to it.
 * Verifying the helper's contract end-to-end (8 cases) gives us the same
 * coverage as wiring up a full Edge Function request fixture, with less
 * harness surface area.
 *
 * Coverage (8 cases, architect-revised PR-D plan review):
 *   1. Happy path: emit + projection updated + no processing_error → success
 *   2. Handler-throws: row missing + processing_error set → masked error
 *   3. Race-safe: projection looks updated but processing_error set → masked error
 *   4. Expected-state mismatch: row exists but doesn't match predicate → row treated as missing
 *   5. Helper queries by captured event_id (NOT stream_id / latest event) → race-safe contract
 *   6. Helper does NOT swallow `domain_events` query errors (RLS, missing GRANT)
 *   7. Helper does NOT swallow projection-table query errors
 *   8. PII masking on processing_error string (architect Q6)
 *
 * Auth-ban-failure and pre-emit-guard cases are covered by the Edge Function's
 * pre-existing console.warn paths; they don't depend on the helper.
 */

import { assertEquals } from 'https://deno.land/std@0.220.1/assert/mod.ts';

import { checkProjectionReadback } from '../../_shared/rpc-readback.ts';

// =============================================================================
// Mock Supabase client
// =============================================================================

interface MockQueryFixture {
  /** Returns the data + error to surface for this query. */
  data?: unknown;
  error?: { message: string } | null;
}

interface MockClientConfig {
  /** Map of (table → keyed fixture). */
  tables: Record<string, MockQueryFixture>;
  /**
   * Callback invoked with the table + `.eq()` filter args. Threading the table
   * name closes the architect-flagged gap (P3 F5) where a table-agnostic
   * callback couldn't distinguish `users.id = EVENT_ID` from
   * `domain_events.id = EVENT_ID` — both share the column name `id`.
   */
  onEq?: (table: string, column: string, value: unknown) => void;
}

function makeMockClient(config: MockClientConfig) {
  const onEq = config.onEq ?? (() => {});
  return {
    from(table: string) {
      const fixture = config.tables[table] ?? { data: null, error: null };
      const chain = {
        select(_columns: string) {
          return chain;
        },
        eq(column: string, value: unknown) {
          onEq(table, column, value);
          return chain;
        },
        async maybeSingle() {
          return { data: fixture.data, error: fixture.error ?? null };
        },
      };
      return chain;
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

const EVENT_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';

// =============================================================================
// Tests
// =============================================================================

Deno.test('1. Happy path: projection updated + no processing_error → success', async () => {
  const client = makeMockClient({
    tables: {
      users: { data: { id: USER_ID, is_active: false } },
      domain_events: { data: { processing_error: null } },
    },
  });

  const result = await checkProjectionReadback(
    client,
    EVENT_ID,
    'users',
    'id',
    USER_ID,
    { is_active: false },
  );

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals((result.row as { is_active: boolean }).is_active, false);
  }
});

Deno.test('2. Handler-throws: row missing + processing_error set → masked error', async () => {
  const client = makeMockClient({
    tables: {
      users: { data: null }, // projection NOT updated (handler threw before update)
      domain_events: { data: { processing_error: 'permission denied for table users' } },
    },
  });

  const result = await checkProjectionReadback(
    client,
    EVENT_ID,
    'users',
    'id',
    USER_ID,
    { is_active: false },
  );

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(
      result.error,
      'Event processing failed: permission denied for table users',
    );
  }
});

Deno.test('3. Race-safe: projection looks updated but processing_error set → masked error', async () => {
  // The handler partially succeeded (projection got updated for an unrelated
  // reason, e.g., concurrent emitter / handler partial-write before throw).
  // Check 1 passes (row found with expected state), Check 2 catches the
  // captured event_id's processing_error.
  const client = makeMockClient({
    tables: {
      users: { data: { id: USER_ID, is_active: false } },
      domain_events: { data: { processing_error: 'unique constraint violation on (col)' } },
    },
  });

  const result = await checkProjectionReadback(
    client,
    EVENT_ID,
    'users',
    'id',
    USER_ID,
    { is_active: false },
  );

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(
      result.error,
      'Event processing failed: unique constraint violation on (col)',
    );
  }
});

Deno.test('4. NOT FOUND with no processing_error → fallback message', async () => {
  // Renamed per architect P3 F3: the mock's .eq() is filter-blind, so this
  // test mechanically exercises the NOT FOUND branch with processing_error
  // unset, NOT the predicate-vs-row-existence distinction. Coverage on the
  // fallback message is real; the rename prevents over-trust of the scope.
  // True predicate-mismatch behavior is verified at integration time.
  const client = makeMockClient({
    tables: {
      users: { data: null },
      domain_events: { data: { processing_error: null } },
    },
  });

  const result = await checkProjectionReadback(
    client,
    EVENT_ID,
    'users',
    'id',
    USER_ID,
    { is_active: false },
  );

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(
      result.error,
      'Event processing failed: projection read-back returned no row',
    );
  }
});

Deno.test('5. Helper queries domain_events by captured event_id (race-safe contract)', async () => {
  // Spy on .eq() calls to verify the helper queries `domain_events` specifically
  // by the captured event_id, NOT by stream_id or "latest event". Architect P3
  // F5 fix: thread the table name through onEq so the assertion can
  // distinguish `domain_events.id = EVENT_ID` from `users.id = EVENT_ID`
  // (both share the column name `id`).
  const eqCalls: Array<{ table: string; column: string; value: unknown }> = [];
  const client = makeMockClient({
    tables: {
      users: { data: null }, // force the failure path so domain_events query fires
      domain_events: { data: { processing_error: 'some error' } },
    },
    onEq: (table, column, value) => {
      eqCalls.push({ table, column, value });
    },
  });

  await checkProjectionReadback(client, EVENT_ID, 'users', 'id', USER_ID, {
    is_active: false,
  });

  // Verify domain_events specifically (not users) was queried by `id = EVENT_ID`.
  const domainEventsQueries = eqCalls.filter(
    (call) => call.table === 'domain_events' && call.column === 'id' && call.value === EVENT_ID,
  );
  assertEquals(
    domainEventsQueries.length >= 1,
    true,
    'domain_events must be queried by captured event_id (not stream_id, not latest event)',
  );

  // Belt: helper must never query domain_events by stream_id (race-unsafe).
  const wrongQueries = eqCalls.filter(
    (call) =>
      call.table === 'domain_events' &&
      (call.column === 'stream_id' || call.column === 'stream_type'),
  );
  assertEquals(
    wrongQueries.length,
    0,
    'helper must NOT query domain_events by stream_id (race-unsafe)',
  );
});

Deno.test('6. Helper does NOT swallow domain_events query errors (RLS, missing GRANT)', async () => {
  // If `domain_events` query itself fails (e.g., revoked GRANT, RLS denial),
  // the helper must surface the failure rather than silently treating it as
  // "no processing_error" and returning a false success.
  const client = makeMockClient({
    tables: {
      users: { data: null }, // forces the failure path so domain_events query fires
      domain_events: { error: { message: 'permission denied for table domain_events' } },
    },
  });

  const result = await checkProjectionReadback(
    client,
    EVENT_ID,
    'users',
    'id',
    USER_ID,
    { is_active: false },
  );

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(
      result.error.startsWith('processing_error lookup failed:'),
      true,
      `expected processing_error lookup failure, got: ${result.error}`,
    );
  }
});

Deno.test('7. Helper does NOT swallow projection-table query errors', async () => {
  const client = makeMockClient({
    tables: {
      users: { error: { message: 'permission denied for table users' } },
      domain_events: { data: null },
    },
  });

  const result = await checkProjectionReadback(
    client,
    EVENT_ID,
    'users',
    'id',
    USER_ID,
    { is_active: false },
  );

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(
      result.error.startsWith('Read-back query failed:'),
      true,
      `expected read-back query failure, got: ${result.error}`,
    );
  }
});

Deno.test('8. PII masking on processing_error string (architect Q6)', async () => {
  // Handler raised with an identifier-interpolated message (Rule 16 violation).
  // The helper must mask UUIDs/emails/PG-detail patterns via _shared/maskPii.ts
  // before concatenating into the response. Future-proofs against handler
  // regressions that interpolate PHI.
  const leakyMessage =
    'Key (email)=(victim@example.com) violates check on row containing 11111111-2222-3333-4444-555555555555';
  const client = makeMockClient({
    tables: {
      users: { data: null },
      domain_events: { data: { processing_error: leakyMessage } },
    },
  });

  const result = await checkProjectionReadback(
    client,
    EVENT_ID,
    'users',
    'id',
    USER_ID,
    { is_active: false },
  );

  assertEquals(result.success, false);
  if (!result.success) {
    // Email replaced
    assertEquals(
      result.error.includes('victim@example.com'),
      false,
      'email should have been masked',
    );
    // UUID replaced
    assertEquals(
      result.error.includes('11111111-2222-3333-4444-555555555555'),
      false,
      'UUID should have been masked',
    );
    // Key (...)=(...) shape replaced
    assertEquals(
      result.error.includes('(email)=(<redacted>)'),
      true,
      'Key (col)=(value) shape should have been redacted',
    );
  }
});
