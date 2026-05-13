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
 *     org — RPC-side filter logic. Wiring-tier coverage for these branches
 *     is appended below (RPC returns eligible=true → helper returns ok:true,
 *     regardless of which SQL filter produced the result). True SQL-level
 *     regression coverage is parked at `dev/parked/eligibility-rpc-pgtap-coverage/`
 *     pending a pg_tap (or equivalent) test harness in the project.
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
  // PR #64 closeout (Finding #1): RPC no longer returns a `details` object on
  // cross_provider_invitation_blocked. Operator correlation continues via the
  // server-side log line (warn path) in the helper, which carries the full
  // RPC response including any details that may appear on other branches.
  const client = makeMockClient({
    fixture: {
      data: {
        eligible: false,
        error: 'cross_provider_invitation_blocked',
        message: 'This user is already a member of another provider organization.',
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
  // PR #64 closeout (Finding #1): body.context is no longer populated on this
  // branch — verifying the disclosure-surface removal.
  assertEquals(body.context, undefined);
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

// =============================================================================
// PR #64 closeout — wiring-tier coverage for RPC-side filter branches
// =============================================================================
// These tests pin down EF behavior given each documented RPC return shape.
// They do NOT exercise the SQL itself — that's tracked at
// `dev/parked/eligibility-rpc-pgtap-coverage/` (follow-up card).
//
// Per the architect review (Finding #4), the RPC's C4a/b/c filter branches
// are tightly-bounded WHERE clauses that all collapse to `eligible=true` at
// the response shape. The helper must not second-guess that signal —
// regardless of which SQL filter caused the role to be excluded, eligible=true
// means proceed. These tests pin that invariant.
// =============================================================================

Deno.test('super_admin caller path: RPC returns eligible=true (C4a filter excluded global role) → ok:true', async () => {
  // Scenario: invitee has a super_admin role with organization_id IS NULL.
  // RPC's WHERE clause includes `urp.organization_id IS NOT NULL`, so the
  // super_admin row is excluded from the cross-provider check. With no other
  // type='provider' role, the RPC returns eligible=true. The helper MUST
  // propagate that as ok:true without inspecting the cause.
  const client = makeMockClient({ fixture: { data: { eligible: true } } });
  const result = await checkInvitationEligibility({
    client,
    inviteeUserId: INVITEE,
    targetOrgId: TARGET,
    correlationId: 'c-super-admin',
    corsHeaders: CORS,
    blockedStatus: 403,
    logTag: '[test-super-admin]',
  });
  assertEquals(result, { ok: true });
});

Deno.test('stale-role paths (C4b future-dated / C4b expired / C4c deactivated-org): RPC returns eligible=true → ok:true', async () => {
  // Scenarios bundled — all collapse to the same RPC response shape:
  //   C4b future-dated: role_valid_from > today → excluded
  //   C4b expired:      role_valid_until < today → excluded
  //   C4c deactivated:  op.is_active = false → excluded
  // RPC returns eligible=true in all three. Helper must not infer blocked
  // from the absence of an explicit error.
  const client = makeMockClient({ fixture: { data: { eligible: true } } });
  const result = await checkInvitationEligibility({
    client,
    inviteeUserId: INVITEE,
    targetOrgId: TARGET,
    correlationId: 'c-stale-role',
    corsHeaders: CORS,
    blockedStatus: 422,
    logTag: '[test-stale-role]',
  });
  assertEquals(result, { ok: true });
});
