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

import { assert, assertEquals } from 'https://deno.land/std@0.220.1/assert/mod.ts';

import {
  assignRolesToExistingUser,
  checkEmailStatus,
  checkResendSupersede,
  fetchResendToken,
} from '../index.ts';

type RpcResponse = { data: unknown; error: unknown };

/**
 * Minimal Supabase client stub: `.rpc(name)` returns a configured response.
 * `onRpc` optionally spies on the call so a test can assert what was probed,
 * not just what came back.
 */
function mockClient(
  responses: Record<string, RpcResponse>,
  onRpc?: (name: string, args: unknown) => void,
): Parameters<typeof checkEmailStatus>[0] {
  return {
    rpc(name: string, args: unknown) {
      onRpc?.(name, args);
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

// ---------------------------------------------------------------------------
// assignRolesToExistingUser — envelope handling (narrow-scope fallback + N3)
// ---------------------------------------------------------------------------

/** Stub whose `.schema('api').rpc()` resolves to a configured modify_user_roles result. */
function mockUserClient(rpcResult: RpcResponse): Parameters<typeof assignRolesToExistingUser>[0] {
  return {
    schema() {
      return { rpc: () => Promise.resolve(rpcResult) };
    },
  } as unknown as Parameters<typeof assignRolesToExistingUser>[0];
}

const CORS = { 'Access-Control-Allow-Origin': '*' };

Deno.test('assignRolesToExistingUser → fallback_to_invite on tenancy NOT_FOUND (cross-org)', async () => {
  // Deployed modify_user_roles tenancy shape: error code is top-level `error`.
  const client = mockUserClient({
    data: {
      success: false,
      error: 'NOT_FOUND',
      errorDetails: { code: 'NOT_FOUND', message: 'User not found in this organization' },
    },
    error: null,
  });
  const outcome = await assignRolesToExistingUser(client, 'u1', ['r1'], 'reason', 'role_assigned', 'corr', CORS);
  assertEquals(outcome.kind, 'fallback_to_invite');
});

Deno.test('assignRolesToExistingUser → done 200 with action on success', async () => {
  const client = mockUserClient({ data: { success: true }, error: null });
  const outcome = await assignRolesToExistingUser(client, 'u2', ['r1'], 'reason', 'role_assigned', 'corr', CORS);
  assertEquals(outcome.kind, 'done');
  if (outcome.kind !== 'done') return;
  assertEquals(outcome.response.status, 200);
  const body = await outcome.response.json();
  assertEquals(body.success, true);
  assertEquals(body.action, 'role_assigned');
  assertEquals(body.userId, 'u2');
});

Deno.test('assignRolesToExistingUser → done 400 threading violations + code (VALIDATION_FAILED, N3)', async () => {
  const client = mockUserClient({
    data: { success: false, error: 'VALIDATION_FAILED', violations: [{ role_id: 'r1', error_code: 'X' }] },
    error: null,
  });
  const outcome = await assignRolesToExistingUser(client, 'u3', ['r1'], 'reason', 'role_assigned', 'corr', CORS);
  assertEquals(outcome.kind, 'done');
  if (outcome.kind !== 'done') return;
  assertEquals(outcome.response.status, 400);
  const body = await outcome.response.json();
  assertEquals(body.success, false);
  assertEquals(body.errorDetails.code, 'VALIDATION_FAILED');
  assert(Array.isArray(body.errorDetails.context.violations));
});

Deno.test('assignRolesToExistingUser → done 400 with errorDetails.message for TARGET_DEACTIVATED', async () => {
  const client = mockUserClient({
    data: {
      success: false,
      error: 'TARGET_DEACTIVATED',
      errorDetails: { code: 'TARGET_DEACTIVATED', message: 'Cannot modify roles on a deactivated user' },
    },
    error: null,
  });
  const outcome = await assignRolesToExistingUser(client, 'u4', ['r1'], 'reason', 'role_assigned', 'corr', CORS);
  assertEquals(outcome.kind, 'done');
  if (outcome.kind !== 'done') return;
  assertEquals(outcome.response.status, 400);
  const body = await outcome.response.json();
  assertEquals(body.error, 'Cannot modify roles on a deactivated user');
  assertEquals(body.errorDetails.code, 'TARGET_DEACTIVATED');
});

// ---------------------------------------------------------------------------
// Fail-closed lookup probes.
//
// Each of the three probes used to log its error and fall through, so a
// transient RPC failure classified an existing member as `not_found` and the
// caller minted a fresh invitation for them. These lock the fix: an unknown
// state is never reported as a negative result.
// ---------------------------------------------------------------------------

Deno.test('checkEmailStatus → lookup_failed when the membership probe errors', async () => {
  const client = mockClient({
    check_user_org_membership: { data: null, error: { message: 'boom' } },
    // Would classify as not_found if the error were swallowed and we fell through.
    check_pending_invitation: { data: [], error: null },
    check_user_exists: { data: [], error: null },
  });
  const result = await checkEmailStatus(client, 'a@b.com', 'org1');
  assertEquals(result.status, 'lookup_failed');
});

Deno.test('checkEmailStatus → lookup_failed when the pending-invitation probe errors', async () => {
  const client = mockClient({
    check_user_org_membership: { data: [], error: null },
    check_pending_invitation: { data: null, error: { message: 'boom' } },
    check_user_exists: { data: [], error: null },
  });
  const result = await checkEmailStatus(client, 'a@b.com', 'org1');
  assertEquals(result.status, 'lookup_failed');
});

Deno.test('checkEmailStatus → lookup_failed when the user-exists probe errors', async () => {
  const client = mockClient({
    check_user_org_membership: { data: [], error: null },
    check_pending_invitation: { data: [], error: null },
    check_user_exists: { data: null, error: { message: 'boom' } },
  });
  const result = await checkEmailStatus(client, 'a@b.com', 'org1');
  assertEquals(result.status, 'lookup_failed');
});

Deno.test('checkEmailStatus → an errored probe never yields not_found', async () => {
  // Regression fence for the whole class: whichever probe fails, the answer is
  // "unknown", never the confident negative that triggers an invitation.
  for (const failing of ['check_user_org_membership', 'check_pending_invitation', 'check_user_exists']) {
    const responses: Record<string, RpcResponse> = {
      check_user_org_membership: { data: [], error: null },
      check_pending_invitation: { data: [], error: null },
      check_user_exists: { data: [], error: null },
    };
    responses[failing] = { data: null, error: { message: 'boom' } };
    const result = await checkEmailStatus(mockClient(responses), 'a@b.com', 'org1');
    assert(result.status !== 'not_found', `${failing} error must not classify as not_found`);
  }
});

// ---------------------------------------------------------------------------
// checkResendSupersede — the expired-invitation collision guard (PR E)
// ---------------------------------------------------------------------------
//
// This exists because `handle_invitation_resent` flips status to 'pending'
// unconditionally. With uq_invitations_pending_org_email in place, resending an
// expired invitation that has already been superseded is a 23505 raised INSIDE
// an event handler — which `process_domain_event` absorbs into a processing_error
// without re-raising. Refusing at the wire keeps that from becoming an opaque
// failure the admin cannot act on.

Deno.test('checkResendSupersede → superseded when a pending invitation already exists', async () => {
  const client = mockClient({
    check_pending_invitation: { data: [{ id: 'proj-pk-1' }], error: null },
  });
  const result = await checkResendSupersede(client, 'bob@x.com', 'org1');
  assertEquals(result.verdict, 'superseded');
  // The PROJECTION PK is what the admin needs to act on the live invitation.
  assert(result.verdict === 'superseded' && result.supersedingInvitationId === 'proj-pk-1');
});

Deno.test('checkResendSupersede → proceed when nothing has superseded it', async () => {
  // The narrowness matters: resending an expired invitation is a legitimate,
  // common action. Only the collision is refused.
  const client = mockClient({
    check_pending_invitation: { data: [], error: null },
  });
  const result = await checkResendSupersede(client, 'bob@x.com', 'org1');
  assertEquals(result.verdict, 'proceed');
});

Deno.test('checkResendSupersede → fails CLOSED when the probe errors', async () => {
  // An unknown state is not a negative result. Falling through here would resend
  // into the duplicate the guard exists to prevent.
  const client = mockClient({
    check_pending_invitation: { data: null, error: { message: 'boom' } },
  });
  const result = await checkResendSupersede(client, 'bob@x.com', 'org1');
  assertEquals(result.verdict, 'lookup_failed');
});

Deno.test('checkResendSupersede → a null data payload is not treated as superseded', async () => {
  // PostgREST returns null (not []) in some shapes; that is "no pending row",
  // and must not be misread as a collision that blocks a legitimate resend.
  const client = mockClient({
    check_pending_invitation: { data: null, error: null },
  });
  const result = await checkResendSupersede(client, 'bob@x.com', 'org1');
  assertEquals(result.verdict, 'proceed');
});

// ---------------------------------------------------------------------------
// fetchResendToken — the write-once token read (PR A commit 2)
// ---------------------------------------------------------------------------
//
// `handle_invitation_resent` no longer writes `token`, so a resend must email the
// invitation's EXISTING token. Minting one would send a link that resolves to
// nothing — the exact "Invitation not found" dead end this PR exists to remove.

Deno.test('fetchResendToken → returns the existing token', async () => {
  const client = mockClient({
    get_invitation_token_for_resend: { data: 'existing-token-abc', error: null },
  });
  const result = await fetchResendToken(client, 'inv-1', 'org1');
  assertEquals(result.token, 'existing-token-abc');
  assertEquals(result.error, null);
});

Deno.test('fetchResendToken → fails CLOSED when the RPC errors', async () => {
  // Emailing a link we could not verify is worse than refusing to send one.
  const client = mockClient({
    get_invitation_token_for_resend: { data: null, error: { message: 'boom' } },
  });
  const result = await fetchResendToken(client, 'inv-1', 'org1');
  assertEquals(result.token, null);
  assert(result.error !== null);
});

Deno.test('fetchResendToken → fails CLOSED on a NULL token (not-found or cross-tenant)', async () => {
  // The RPC returns NULL for both, deliberately, so no existence leak. The
  // caller must treat NULL as a refusal rather than sending a tokenless link.
  const client = mockClient({
    get_invitation_token_for_resend: { data: null, error: null },
  });
  const result = await fetchResendToken(client, 'inv-1', 'org-other');
  assertEquals(result.token, null);
  assert(result.error !== null, 'a NULL token must surface as an error, not a silent pass');
});

Deno.test('fetchResendToken → passes both the invitation id and the org (tenancy guard)', async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const client = mockClient(
    { get_invitation_token_for_resend: { data: 'tok', error: null } },
    (name, args) => calls.push({ name, args }),
  );

  await fetchResendToken(client, 'inv-1', 'org1');

  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, 'get_invitation_token_for_resend');
  // Dropping p_org_id would turn this into a cross-tenant token read.
  assertEquals(calls[0].args, { p_invitation_id: 'inv-1', p_org_id: 'org1' });
});

Deno.test('checkResendSupersede → probes by email + org, never by invitation id', async () => {
  // The guard's whole premise is "is there ANOTHER live invitation for this
  // ADDRESS", because that is what uq_invitations_pending_org_email keys on
  // (organization_id, btrim(lower(email))). A probe keyed on the invitation
  // being resent would always come back empty and the guard would be inert.
  const calls: Array<{ name: string; args: unknown }> = [];
  const client = mockClient(
    { check_pending_invitation: { data: [], error: null } },
    (name, args) => calls.push({ name, args }),
  );

  await checkResendSupersede(client, 'bob@x.com', 'org1', 'corr-1');

  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, 'check_pending_invitation');
  assertEquals(calls[0].args, { p_email: 'bob@x.com', p_org_id: 'org1' });
});
