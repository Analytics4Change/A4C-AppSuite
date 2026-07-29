/**
 * SupabaseUserQueryService.checkEmailStatus — verdict mapping and failure channel.
 *
 * This method was doubly broken before PR A: it called its three RPCs via a bare
 * `client.rpc(...)` (no `.schema('api')`), which targets the DEFAULT `public`
 * schema where none of them exists, and it guarded every result with
 * `if (!error && data?.length)` — so all three 404s fell through to
 * `status: 'not_found'`. The UI renders that as a confident "new user, go ahead
 * and invite", for every address, including active members.
 *
 * The tests below fence both halves:
 *  - routing through `supabaseService.apiRpc`, which is the ONLY caller that
 *    applies `.schema('api')` — so asserting the helper is used implicitly
 *    asserts the schema is right;
 *  - the failure channel: every way the lookup can fail yields `lookup_failed`,
 *    and NOTHING yields `not_found` when a probe errored.
 *
 * Harness (vi.hoisted + apiRpc/decodeJWT mocks) mirrors
 * SupabaseUserQueryService.correlation.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockApiRpc, mockGetSession, mockGetClient, mockDecodeJWT } = vi.hoisted(() => {
  const getSession = vi.fn();
  return {
    mockApiRpc: vi.fn(),
    mockGetSession: getSession,
    mockGetClient: vi.fn(() => ({ auth: { getSession } })),
    mockDecodeJWT: vi.fn(),
  };
});

vi.mock('@/services/auth/supabase.service', () => ({
  supabaseService: { apiRpc: mockApiRpc, getClient: mockGetClient },
}));

vi.mock('@/utils/jwt', () => ({ decodeJWT: mockDecodeJWT }));

const mockLog = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/utils/logger', () => ({
  Logger: { getLogger: () => mockLog },
}));

import { SupabaseUserQueryService } from '../SupabaseUserQueryService';

const EMAIL = 'someone@example.com';

/** Configure the three probes by RPC name; anything unset returns empty. */
function probes(responses: Record<string, { data: unknown; error: unknown }>) {
  mockApiRpc.mockImplementation((fn: string) =>
    Promise.resolve(responses[fn] ?? { data: [], error: null })
  );
}

const EMPTY = { data: [], error: null };
const RPC_ERROR = { data: null, error: { message: 'boom' } };

describe('SupabaseUserQueryService.checkEmailStatus', () => {
  let service: SupabaseUserQueryService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } });
    mockDecodeJWT.mockReturnValue({ org_id: 'org-test', sub: 'user-test' });
    probes({});
    service = new SupabaseUserQueryService();
  });

  describe('transport', () => {
    it('routes every probe through apiRpc (the only path that targets the api schema)', async () => {
      await service.checkEmailStatus(EMAIL);
      const names = mockApiRpc.mock.calls.map((c) => c[0]);
      expect(names).toEqual([
        'check_user_org_membership',
        'check_pending_invitation',
        'check_user_exists',
      ]);
    });

    it('pins the SAME correlation id on all three probes', async () => {
      await service.checkEmailStatus(EMAIL, 'corr-lookup');
      expect(mockApiRpc.mock.calls).toHaveLength(3);
      for (const call of mockApiRpc.mock.calls) {
        expect(call[2]).toEqual({ correlationId: 'corr-lookup' });
      }
    });

    it('mints its own correlation id when the caller supplies none', async () => {
      // services/CLAUDE.md §"Service-mints variant": this method owns its failure
      // logging and its caller only reads the returned status, so the param is
      // DEFAULTED, not optional. With an optional param a no-arg call would log
      // `undefined` while the server auto-generated a different id — silently
      // breaking the very join the id exists to make.
      await service.checkEmailStatus(EMAIL);

      expect(mockApiRpc.mock.calls).toHaveLength(3);
      const ids = mockApiRpc.mock.calls.map((c) => c[2]?.correlationId);
      for (const id of ids) {
        expect(id).toEqual(expect.any(String));
        expect(id).not.toBe('');
      }
      // ...and it is ONE id across all three probes, not three different ones.
      expect(new Set(ids).size).toBe(1);
    });

    it('logs the minted id on failure, never undefined', async () => {
      probes({ check_user_org_membership: RPC_ERROR });
      await service.checkEmailStatus(EMAIL);
      const [, payload] = mockLog.warn.mock.calls[0];
      expect(payload.correlationId).toEqual(expect.any(String));
      expect(payload.correlationId).not.toBe('');
    });

    it('short-circuits after a membership hit — one probe, not three', async () => {
      probes({
        check_user_org_membership: { data: [{ user_id: 'u1', is_active: true }], error: null },
      });
      await service.checkEmailStatus(EMAIL);
      expect(mockApiRpc).toHaveBeenCalledTimes(1);
    });
  });

  describe('verdicts', () => {
    it('active_member when membership exists and the user is active', async () => {
      probes({
        check_user_org_membership: { data: [{ user_id: 'u1', is_active: true }], error: null },
      });
      const r = await service.checkEmailStatus(EMAIL);
      expect(r.status).toBe('active_member');
      expect(r.status !== 'lookup_failed' && r.userId).toBe('u1');
    });

    it('deactivated when membership exists but the user is inactive', async () => {
      probes({
        check_user_org_membership: { data: [{ user_id: 'u2', is_active: false }], error: null },
      });
      expect((await service.checkEmailStatus(EMAIL)).status).toBe('deactivated');
    });

    it('pending when an invitation exists and has not expired', async () => {
      const future = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
      probes({
        check_user_org_membership: EMPTY,
        check_pending_invitation: { data: [{ id: 'inv-1', expires_at: future }], error: null },
      });
      const r = await service.checkEmailStatus(EMAIL);
      expect(r.status).toBe('pending');
      expect(r.status !== 'lookup_failed' && r.invitationId).toBe('inv-1');
    });

    it('expired when the invitation expiry is in the past', async () => {
      const past = new Date(Date.now() - 24 * 3600_000).toISOString();
      probes({
        check_user_org_membership: EMPTY,
        check_pending_invitation: { data: [{ id: 'inv-2', expires_at: past }], error: null },
      });
      expect((await service.checkEmailStatus(EMAIL)).status).toBe('expired');
    });

    it('other_org when the user exists but is not in this org', async () => {
      probes({
        check_user_org_membership: EMPTY,
        check_pending_invitation: EMPTY,
        check_user_exists: { data: [{ user_id: 'u9' }], error: null },
      });
      const r = await service.checkEmailStatus(EMAIL);
      expect(r.status).toBe('other_org');
      expect(r.status !== 'lookup_failed' && r.userId).toBe('u9');
    });

    it('not_found only when all three probes genuinely come back empty', async () => {
      probes({
        check_user_org_membership: EMPTY,
        check_pending_invitation: EMPTY,
        check_user_exists: EMPTY,
      });
      expect((await service.checkEmailStatus(EMAIL)).status).toBe('not_found');
    });
  });

  describe('failure channel', () => {
    it.each([['check_user_org_membership'], ['check_pending_invitation'], ['check_user_exists']])(
      'lookup_failed when %s errors',
      async (failing) => {
        probes({
          check_user_org_membership: EMPTY,
          check_pending_invitation: EMPTY,
          check_user_exists: EMPTY,
          [failing]: RPC_ERROR,
        });
        expect((await service.checkEmailStatus(EMAIL)).status).toBe('lookup_failed');
      }
    );

    it('lookup_failed when there is no session', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null } });
      expect((await service.checkEmailStatus(EMAIL)).status).toBe('lookup_failed');
      expect(mockApiRpc).not.toHaveBeenCalled();
    });

    it('lookup_failed when the token carries no org context', async () => {
      // Empty-string sentinel: decodeJWT coerces a NULL org_id to ''. With no
      // tenant to look in, "not found" would be a lie.
      mockDecodeJWT.mockReturnValue({ org_id: '', sub: 'user-test' });
      expect((await service.checkEmailStatus(EMAIL)).status).toBe('lookup_failed');
      expect(mockApiRpc).not.toHaveBeenCalled();
    });

    it('lookup_failed when a probe rejects outright', async () => {
      mockApiRpc.mockRejectedValue(new Error('network down'));
      expect((await service.checkEmailStatus(EMAIL)).status).toBe('lookup_failed');
    });

    it('never returns not_found when any probe errored (regression fence)', async () => {
      for (const failing of [
        'check_user_org_membership',
        'check_pending_invitation',
        'check_user_exists',
      ]) {
        vi.clearAllMocks();
        mockGetSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } });
        mockDecodeJWT.mockReturnValue({ org_id: 'org-test' });
        probes({
          check_user_org_membership: EMPTY,
          check_pending_invitation: EMPTY,
          check_user_exists: EMPTY,
          [failing]: RPC_ERROR,
        });
        const r = await service.checkEmailStatus(EMAIL);
        expect(r.status, `${failing} error must not read as not_found`).not.toBe('not_found');
      }
    });

    it('carries no identity fields on the failure result', async () => {
      probes({ check_user_org_membership: RPC_ERROR });
      const r = await service.checkEmailStatus(EMAIL);
      expect(r).toEqual({ status: 'lookup_failed' });
    });
  });

  describe('PII', () => {
    it('never logs the email address on any path', async () => {
      probes({ check_user_org_membership: RPC_ERROR });
      await service.checkEmailStatus(EMAIL, 'corr-1');
      mockGetSession.mockResolvedValue({ data: { session: null } });
      await service.checkEmailStatus(EMAIL);
      mockApiRpc.mockRejectedValue(new Error('network down'));
      await service.checkEmailStatus(EMAIL);

      const logged = JSON.stringify([
        ...mockLog.debug.mock.calls,
        ...mockLog.info.mock.calls,
        ...mockLog.warn.mock.calls,
        ...mockLog.error.mock.calls,
      ]);
      expect(logged).not.toContain(EMAIL);
    });

    it('logs the failure reason with the correlation id so it joins the server trace', async () => {
      probes({ check_user_org_membership: RPC_ERROR });
      await service.checkEmailStatus(EMAIL, 'corr-join');
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ reason: 'rpc_error', correlationId: 'corr-join' })
      );
    });
  });
});
