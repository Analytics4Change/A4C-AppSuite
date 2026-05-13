/**
 * Unit tests for the shared cross-provider invitation eligibility gate
 * (`_shared/check-invitation-eligibility.ts`).
 *
 * Run with:
 *   deno test --allow-import _shared/__tests__/check-invitation-eligibility.test.ts
 *
 * Test scope:
 *   - Calls `api.check_invitation_acceptance_eligibility` with the documented
 *     arg shape `{ p_invitee_user_id, p_target_org_id }`.
 *   - Returns `{ ok: true }` on eligible=true.
 *   - Returns `{ response }` on eligible=false (translated to the
 *     caller-specified status: 403 for acceptance-time, 422 for pre-issuance).
 *   - Returns `{ response }` on RPC-level error (delegated to handleRpcError).
 *   - Architect cases C4a/b/c: super_admin, future-dated, expired, deactivated-
 *     org — these are RPC-side logic and are exercised in the RPC's SQL-level
 *     tests (live DB via Management API). At the helper layer, we test the
 *     transport / wiring contract only.
 */

import { assertEquals } from 'https://deno.land/std@0.220.1/assert/mod.ts';

import {
  checkInvitationEligibility,
  type EligibilityRpcResponse,
} from '../check-invitation-eligibility.ts';

// =============================================================================
// Mock client + harness
// =============================================================================

interface CapturedRpcCall {
  fnName: string;
  args: Record<string, unknown>;
}

function makeMockClient(opts: {
  fixture: { data?: EligibilityRpcResponse; error?: { message: string } | null };
  onRpc?: (call: CapturedRpcCall) => void;
}) {
  return {
    async rpc(fnName: string, args: Record<string, unknown>) {
      opts.onRpc?.({ fnName, args });
      return { data: opts.fixture.data ?? null, error: opts.fixture.error ?? null };
    },
  };
}

const INVITEE = '00000000-0000-0000-0000-000000000111';
const TARGET = '00000000-0000-0000-0000-000000000222';
const CORS = { 'Access-Control-Allow-Origin': '*' };

// =============================================================================
// Tests
// =============================================================================

Deno.test('eligible=true → ok:true; RPC called with documented arg shape', async () => {
  const calls: CapturedRpcCall[] = [];
  const client = makeMockClient({
    fixture: { data: { eligible: true } },
    onRpc: (c) => calls.push(c),
  });

  const result = await checkInvitationEligibility({
    client,
    inviteeUserId: INVITEE,
    targetOrgId: TARGET,
    correlationId: 'c-1',
    corsHeaders: CORS,
    blockedStatus: 403,
    logTag: '[test]',
  });

  assertEquals(result, { ok: true });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fnName, 'check_invitation_acceptance_eligibility');
  assertEquals(calls[0].args, {
    p_invitee_user_id: INVITEE,
    p_target_org_id: TARGET,
  });
});

Deno.test('eligible=false (cross_provider) → 403 response with RPC error code/message', async () => {
  const client = makeMockClient({
    fixture: {
      data: {
        eligible: false,
        error: 'cross_provider_invitation_blocked',
        message: 'This user is already a member of another provider organization.',
        details: {
          existing_provider_org_id: '00000000-0000-0000-0000-000000000333',
          target_provider_org_id: TARGET,
        },
      },
    },
  });

  const result = await checkInvitationEligibility({
    client,
    inviteeUserId: INVITEE,
    targetOrgId: TARGET,
    correlationId: 'c-2',
    corsHeaders: CORS,
    blockedStatus: 403,
    logTag: '[test-accept]',
  });

  if (!('response' in result)) throw new Error('expected response');
  assertEquals(result.response.status, 403);
  const body = await result.response.json();
  assertEquals(body.error, 'This user is already a member of another provider organization.');
  assertEquals(body.code, 'cross_provider_invitation_blocked');
  assertEquals(body.correlation_id, 'c-2');
  // details should be surfaced via context
  assertEquals(
    (body.context as { existing_provider_org_id: string }).existing_provider_org_id,
    '00000000-0000-0000-0000-000000000333',
  );
});

Deno.test('eligible=false (cross_provider) with blockedStatus=422 → 422 response (pre-issuance gate)', async () => {
  const client = makeMockClient({
    fixture: {
      data: {
        eligible: false,
        error: 'cross_provider_invitation_blocked',
        message: 'Blocked.',
      },
    },
  });

  const result = await checkInvitationEligibility({
    client,
    inviteeUserId: INVITEE,
    targetOrgId: TARGET,
    correlationId: 'c-3',
    corsHeaders: CORS,
    blockedStatus: 422,
    logTag: '[test-invite]',
  });

  if (!('response' in result)) throw new Error('expected response');
  assertEquals(result.response.status, 422);
});

Deno.test('eligible=false (target_org_not_found) → response with RPC error code', async () => {
  const client = makeMockClient({
    fixture: {
      data: {
        eligible: false,
        error: 'target_org_not_found',
        message: 'Target organization does not exist.',
      },
    },
  });

  const result = await checkInvitationEligibility({
    client,
    inviteeUserId: INVITEE,
    targetOrgId: TARGET,
    correlationId: 'c-4',
    corsHeaders: CORS,
    blockedStatus: 403,
    logTag: '[test]',
  });

  if (!('response' in result)) throw new Error('expected response');
  assertEquals(result.response.status, 403);
  const body = await result.response.json();
  assertEquals(body.code, 'target_org_not_found');
});

Deno.test('RPC error → response from handleRpcError (no role events leak)', async () => {
  const client = makeMockClient({
    fixture: { error: { message: 'permission denied for function ...' } },
  });

  const result = await checkInvitationEligibility({
    client,
    inviteeUserId: INVITEE,
    targetOrgId: TARGET,
    correlationId: 'c-5',
    corsHeaders: CORS,
    blockedStatus: 403,
    logTag: '[test]',
  });

  if (!('response' in result)) throw new Error('expected response on RPC error');
  // handleRpcError uses 400 status for RPC errors (non-event-processing)
  assertEquals(result.response.status, 400);
});

Deno.test('malformed RPC response (missing eligible field) treated as blocked (fail-closed)', async () => {
  // Defense in depth: if the RPC ever returns an unexpected shape (schema
  // drift, partial response), we MUST NOT default to allow. The helper
  // coerces a missing `eligible` field to a block.
  const client = makeMockClient({
    fixture: { data: {} as EligibilityRpcResponse },
  });

  const result = await checkInvitationEligibility({
    client,
    inviteeUserId: INVITEE,
    targetOrgId: TARGET,
    correlationId: 'c-6',
    corsHeaders: CORS,
    blockedStatus: 403,
    logTag: '[test]',
  });

  if (!('response' in result)) throw new Error('expected fail-closed response');
  assertEquals(result.response.status, 403);
});
