/**
 * Unit tests for `checkExistingUserPath` — the SQL-RPC-pivot replacement.
 *
 * Run with:
 *   deno test --allow-net accept-invitation/__tests__/existing-user-check-schema.test.ts
 *
 * # History
 *
 *   pre-2026-05-12: Helper used naked `client.from('users')` /
 *     `client.from('user_roles_projection')` reads. The Edge Function's
 *     supabase client has `db: { schema: 'api' }` for RPC ergonomics, so
 *     `.from()` resolved as `api.users` — missing table, silent failure,
 *     `user.created` re-emitted on every existing-user OAuth/SSO accept.
 *
 *   2026-05-12 (PR #61 hotfix): Pinned every `.from()` with
 *     `.schema('public')`. UAT caught a second failure mode: the deployed
 *     PostgREST exposes ONLY the `api` schema and rejects `.schema('public')`
 *     chains at the gateway ("The schema must be one of the following: api").
 *
 *   2026-05-12 (this pivot): Replaced wire-tier reads with the
 *     `api.check_user_invitation_existence` RPC. RPC bodies have full SQL
 *     access regardless of PostgREST's exposed-schemas config. Mirrors the
 *     `api.delete_user` Pattern A v2 SQL-tier precedent.
 *
 * # Test scope
 *
 *   Verify `checkExistingUserPath` correctly invokes the SQL RPC and maps
 *   the response shape `{isExistingUser, isDeleted}` to the helper's
 *   `ExistingUserPathResult`. The RPC's own logic (deleted-tombstone
 *   handling, projection lookup) is covered by SQL-tier verification
 *   (plpgsql_check + UAT).
 */

import { assertEquals } from 'https://deno.land/std@0.220.1/assert/mod.ts';

import { checkExistingUserPath } from '../index.ts';

// =============================================================================
// Mock Supabase client with rpc-spy
// =============================================================================

interface RpcFixture {
  data?: unknown;
  error?: { message: string } | null;
}

interface MockClientConfig {
  /** Per-RPC-function fixtures keyed by function name. */
  rpcs: Record<string, RpcFixture>;
  /** Spy on `.rpc(name, args)` invocations. */
  onRpc?: (name: string, args: unknown) => void;
}

function makeMockClient(config: MockClientConfig) {
  const onRpc = config.onRpc ?? (() => {});

  return {
    async rpc(name: string, args: unknown) {
      onRpc(name, args);
      const fixture = config.rpcs[name] ?? { data: null, error: null };
      return { data: fixture.data, error: fixture.error ?? null };
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

const USER_ID = '00000000-0000-0000-0000-000000000001';

// =============================================================================
// Tests
// =============================================================================

Deno.test('1. New user (no roles, not deleted): isExistingUser=false', async () => {
  const client = makeMockClient({
    rpcs: {
      check_user_invitation_existence: {
        data: { isExistingUser: false, isDeleted: false },
      },
    },
  });

  const result = await checkExistingUserPath(client, USER_ID);

  assertEquals(result.isExistingUser, false);
  assertEquals(result.isDeleted, false);
  assertEquals(result.rolesCheckError, null);
});

Deno.test('2. Existing user with role (Sally scenario): isExistingUser=true', async () => {
  const client = makeMockClient({
    rpcs: {
      check_user_invitation_existence: {
        data: { isExistingUser: true, isDeleted: false },
      },
    },
  });

  const result = await checkExistingUserPath(client, USER_ID);

  assertEquals(result.isExistingUser, true);
  assertEquals(result.isDeleted, false);
  assertEquals(result.rolesCheckError, null);
});

Deno.test('3. Soft-deleted user treated as NEW (re-invitation flow)', async () => {
  const client = makeMockClient({
    rpcs: {
      check_user_invitation_existence: {
        data: { isExistingUser: false, isDeleted: true },
      },
    },
  });

  const result = await checkExistingUserPath(client, USER_ID);

  // Deleted users get the full user.created flow even if orphan role rows exist.
  // The SQL RPC handles this by short-circuiting before the role lookup.
  assertEquals(result.isExistingUser, false);
  assertEquals(result.isDeleted, true);
  assertEquals(result.rolesCheckError, null);
});

Deno.test('4. RPC error surfaces (caller decides whether to fail open or closed)', async () => {
  const client = makeMockClient({
    rpcs: {
      check_user_invitation_existence: {
        error: { message: 'permission denied for function check_user_invitation_existence' },
      },
    },
  });

  const result = await checkExistingUserPath(client, USER_ID);

  // Fail-safe semantics: on RPC error, return isExistingUser=false so the
  // caller re-emits user.created (idempotent via projections). Surface error
  // via rolesCheckError for structured-log continuity.
  assertEquals(result.isExistingUser, false);
  assertEquals(result.isDeleted, false);
  assertEquals(
    (result.rolesCheckError as { message: string }).message,
    'permission denied for function check_user_invitation_existence',
  );
});

Deno.test('5. Helper invokes api.check_user_invitation_existence with p_user_id', async () => {
  // SQL-RPC pivot contract: the helper MUST call `check_user_invitation_existence`
  // (and only that RPC), passing the userId as `p_user_id`. The architectural
  // invariant this test guards: future refactors must not re-introduce naked
  // `.from()` reads against the public schema — those fail at the deployed
  // PostgREST gateway. If anyone removes the RPC call and goes back to .from(),
  // this test still passes (false negative). The complement guard is the
  // explicit absence of `client.from()` on the mock — if a refactor calls
  // `client.from(...)` the test client will throw `client.from is not a
  // function` and the test will fail loudly.
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const client = makeMockClient({
    rpcs: {
      check_user_invitation_existence: {
        data: { isExistingUser: false, isDeleted: false },
      },
    },
    onRpc: (name, args) => {
      rpcCalls.push({ name, args });
    },
  });

  await checkExistingUserPath(client, USER_ID);

  assertEquals(rpcCalls.length, 1, 'helper must invoke exactly one RPC');
  assertEquals(rpcCalls[0].name, 'check_user_invitation_existence');
  assertEquals(rpcCalls[0].args, { p_user_id: USER_ID });
});

Deno.test('6. Malformed RPC response (missing fields) coerces to safe defaults', async () => {
  // Defense in depth: if the RPC returns an unexpected shape (e.g., schema drift,
  // partial response), the helper must coerce missing booleans to false rather
  // than propagating undefined into the caller's branching logic.
  const client = makeMockClient({
    rpcs: {
      check_user_invitation_existence: { data: {} },
    },
  });

  const result = await checkExistingUserPath(client, USER_ID);

  assertEquals(result.isExistingUser, false);
  assertEquals(result.isDeleted, false);
  assertEquals(result.rolesCheckError, null);
});
