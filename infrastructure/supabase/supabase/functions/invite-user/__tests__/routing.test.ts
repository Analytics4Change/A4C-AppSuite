/**
 * Unit tests for invite-user state-based routing (checkEmailStatus).
 *
 * Run with: deno test --allow-net invite-user/__tests__/routing.test.ts
 *
 * Covers the epic-PR-3 routing: the overloaded "user exists but not in this org"
 * case is split by api.check_user_has_any_role into existing_user_no_roles
 * (zombie → direct assign) vs other_org_member (≥1 role elsewhere → gate then
 * assign). Also locks active_member / deactivated / not_found classification.
 *
 * Per-Edge-Function test pattern from PR #42.
 */

import { assertEquals } from 'https://deno.land/std@0.220.1/assert/mod.ts';

import { checkEmailStatus } from '../index.ts';

type RpcResponse = { data: unknown; error: unknown };

/** Minimal Supabase client stub: `.rpc(name)` returns a configured response. */
function mockClient(responses: Record<string, RpcResponse>): Parameters<typeof checkEmailStatus>[0] {
  return {
    rpc(name: string) {
      return Promise.resolve(responses[name] ?? { data: null, error: null });
    },
  } as unknown as Parameters<typeof checkEmailStatus>[0];
}

Deno.test('checkEmailStatus → active_member when active membership exists in this org', async () => {
  const client = mockClient({
    check_user_org_membership: { data: [{ user_id: 'u1', is_active: true }], error: null },
  });
  const result = await checkEmailStatus(client, 'a@b.com', 'org1');
  assertEquals(result.status, 'active_member');
  assertEquals(result.userId, 'u1');
});

Deno.test('checkEmailStatus → deactivated when membership exists but user is inactive', async () => {
  const client = mockClient({
    check_user_org_membership: { data: [{ user_id: 'u2', is_active: false }], error: null },
  });
  const result = await checkEmailStatus(client, 'a@b.com', 'org1');
  assertEquals(result.status, 'deactivated');
  assertEquals(result.userId, 'u2');
});

Deno.test('checkEmailStatus → existing_user_no_roles (zombie) when user exists with no roles anywhere', async () => {
  const client = mockClient({
    check_user_org_membership: { data: [], error: null },
    check_pending_invitation: { data: [], error: null },
    check_user_exists: { data: [{ user_id: 'u9' }], error: null },
    check_user_has_any_role: { data: false, error: null },
  });
  const result = await checkEmailStatus(client, 'z@b.com', 'org1');
  assertEquals(result.status, 'existing_user_no_roles');
  assertEquals(result.userId, 'u9');
});

Deno.test('checkEmailStatus → other_org_member when user holds a role elsewhere', async () => {
  const client = mockClient({
    check_user_org_membership: { data: [], error: null },
    check_pending_invitation: { data: [], error: null },
    check_user_exists: { data: [{ user_id: 'u8' }], error: null },
    check_user_has_any_role: { data: true, error: null },
  });
  const result = await checkEmailStatus(client, 'o@b.com', 'org1');
  assertEquals(result.status, 'other_org_member');
  assertEquals(result.userId, 'u8');
});

Deno.test('checkEmailStatus → other_org_member (conservative) when has-any-role check errors', async () => {
  const client = mockClient({
    check_user_org_membership: { data: [], error: null },
    check_pending_invitation: { data: [], error: null },
    check_user_exists: { data: [{ user_id: 'u7' }], error: null },
    check_user_has_any_role: { data: null, error: { message: 'boom' } },
  });
  const result = await checkEmailStatus(client, 'e@b.com', 'org1');
  // On error we must NOT route to the zombie (direct-assign) path — fall back to
  // other_org_member so the cross-provider eligibility gate still runs.
  assertEquals(result.status, 'other_org_member');
});

Deno.test('checkEmailStatus → not_found when no user and no invitation exist', async () => {
  const client = mockClient({
    check_user_org_membership: { data: [], error: null },
    check_pending_invitation: { data: [], error: null },
    check_user_exists: { data: [], error: null },
  });
  const result = await checkEmailStatus(client, 'new@b.com', 'org1');
  assertEquals(result.status, 'not_found');
});
