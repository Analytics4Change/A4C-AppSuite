/**
 * Regression tests for `checkExistingUserPath` schema-pinning.
 *
 * Hotfix 2026-05-12: pre-fix, the Edge Function's `supabase` client was
 * constructed with `db: { schema: 'api' }` for RPC ergonomics, and the two
 * inline `.from()` queries (users + user_roles_projection) silently resolved
 * to `api.users` / `api.user_roles_projection` (missing tables). The rolesCheckError
 * catch swallowed the failure, causing every existing-user OAuth/SSO invitation
 * accept to re-emit `user.created` and pollute the audit trail.
 *
 * Fix: explicit `.schema('public')` on every `.from()` call in the extracted
 * `checkExistingUserPath` helper.
 *
 * Run with:
 *   deno test --allow-net accept-invitation/__tests__/existing-user-check-schema.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.220.1/assert/mod.ts';

import { checkExistingUserPath } from '../index.ts';

// =============================================================================
// Mock Supabase client with schema-pinning invariant enforcement
// =============================================================================

interface MockFixture {
  data?: unknown;
  error?: { message: string } | null;
}

interface MockClientConfig {
  /** Per-table fixtures keyed by table name. */
  tables: Record<string, MockFixture>;
  /** Optional callback to spy on `.schema()` calls. */
  onSchema?: (schema: string) => void;
  /**
   * Optional callback to spy on `.from(table)` calls. Receives both `table`
   * and the most-recent `.schema()` value (or null if `.from()` was called
   * without a preceding `.schema()` — the regression we're guarding against).
   */
  onFrom?: (table: string, currentSchema: string | null) => void;
}

function makeMockClient(config: MockClientConfig) {
  const onSchema = config.onSchema ?? (() => {});
  const onFrom = config.onFrom ?? (() => {});

  const fromImpl = (table: string, currentSchema: string | null) => {
    onFrom(table, currentSchema);
    const fixture = config.tables[table] ?? { data: null, error: null };
    const chain = {
      select(_columns: string) {
        return chain;
      },
      eq(_column: string, _value: unknown) {
        return chain;
      },
      limit(_n: number) {
        return chain;
      },
      async maybeSingle() {
        return { data: fixture.data, error: fixture.error ?? null };
      },
      then(onResolve: (value: { data: unknown; error: unknown }) => void) {
        // Allows `await client.schema('public').from(...)...limit(N)` to resolve.
        return Promise.resolve({ data: fixture.data, error: fixture.error ?? null }).then(
          onResolve,
        );
      },
    };
    return chain;
  };

  const schemaImpl = (schema: string) => {
    onSchema(schema);
    return { from: (table: string) => fromImpl(table, schema) };
  };

  return {
    schema: schemaImpl,
    from: (table: string) => fromImpl(table, null),
    // deno-lint-ignore no-explicit-any
  } as any;
}

const USER_ID = '00000000-0000-0000-0000-000000000001';

// =============================================================================
// Tests
// =============================================================================

Deno.test('1. New user (no roles, not deleted): isExistingUser=false', async () => {
  const client = makeMockClient({
    tables: {
      users: { data: { deleted_at: null } },
      user_roles_projection: { data: [] },
    },
  });

  const result = await checkExistingUserPath(client, USER_ID);

  assertEquals(result.isExistingUser, false);
  assertEquals(result.isDeleted, false);
  assertEquals(result.rolesCheckError, null);
});

Deno.test('2. Existing user with role (Sally scenario): isExistingUser=true', async () => {
  const client = makeMockClient({
    tables: {
      users: { data: { deleted_at: null } },
      user_roles_projection: { data: [{ id: 'role-1' }] },
    },
  });

  const result = await checkExistingUserPath(client, USER_ID);

  assertEquals(result.isExistingUser, true);
  assertEquals(result.isDeleted, false);
});

Deno.test('3. Soft-deleted user treated as NEW (re-invitation flow)', async () => {
  const client = makeMockClient({
    tables: {
      users: { data: { deleted_at: '2026-05-01T00:00:00Z' } },
      user_roles_projection: { data: [{ id: 'orphaned-role' }] }, // would-be existing
    },
  });

  const result = await checkExistingUserPath(client, USER_ID);

  // Deleted users get the full user.created flow even if orphan role rows exist.
  assertEquals(result.isExistingUser, false);
  assertEquals(result.isDeleted, true);
});

Deno.test('4. Roles-check error surfaces (caller decides whether to fail open or closed)', async () => {
  const client = makeMockClient({
    tables: {
      users: { data: { deleted_at: null } },
      user_roles_projection: { error: { message: 'permission denied' } },
    },
  });

  const result = await checkExistingUserPath(client, USER_ID);

  assertEquals(result.isExistingUser, false); // no rows returned
  assertEquals(result.rolesCheckError, { message: 'permission denied' });
});

// =============================================================================
// Schema-pinning regression (the 2026-05-12 hotfix)
// =============================================================================

Deno.test(
  '5. Schema-pinning invariant: every .from() preceded by .schema("public")',
  async () => {
    // .from() spy that asserts the schema-pinning invariant at every call site.
    // Architectural invariant: ANY .from() call without a preceding
    // .schema('public') chain is a regression. Failure mode if someone removes
    // the .schema() calls: this assertion fires with the offending table name.
    let currentSchema: string | null = null;
    const fromCallLog: Array<{ table: string; schema: string | null }> = [];

    const client = makeMockClient({
      tables: {
        users: { data: { deleted_at: null } },
        user_roles_projection: { data: [] },
      },
      onSchema: (schema) => {
        currentSchema = schema;
      },
      onFrom: (table, schemaAtCall) => {
        fromCallLog.push({ table, schema: schemaAtCall });
        // After consuming the schema scope, reset so the next .from() must be
        // preceded by its own .schema('public') call.
        currentSchema = null;
      },
    });

    await checkExistingUserPath(client, USER_ID);

    // Invariant: every .from() call MUST have been preceded by .schema('public').
    for (const call of fromCallLog) {
      assertEquals(
        call.schema,
        'public',
        `.from('${call.table}') called without preceding .schema('public') — schema-pinning regression`,
      );
    }

    // Belt: at least the two known queries (users + user_roles_projection).
    assertEquals(
      fromCallLog.length >= 2,
      true,
      `expected ≥2 .from() calls, got ${fromCallLog.length}`,
    );
    // Suppress unused-var lint for currentSchema (tracking-only in this test).
    void currentSchema;
  },
);

Deno.test('6. Skip user_roles_projection lookup when user is deleted', async () => {
  // Optimization: when isDeleted, the helper short-circuits and does NOT
  // query user_roles_projection. Verify by counting .from() calls.
  const fromCallLog: string[] = [];

  const client = makeMockClient({
    tables: {
      users: { data: { deleted_at: '2026-05-01T00:00:00Z' } },
      user_roles_projection: { data: [{ id: 'should-not-be-read' }] },
    },
    onFrom: (table) => {
      fromCallLog.push(table);
    },
  });

  const result = await checkExistingUserPath(client, USER_ID);

  assertEquals(result.isDeleted, true);
  assertEquals(result.isExistingUser, false);
  assertEquals(
    fromCallLog,
    ['users'],
    `deleted user should skip user_roles_projection; got: ${JSON.stringify(fromCallLog)}`,
  );
});
