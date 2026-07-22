/**
 * SupabaseUserQueryService — correlation-id threading tests.
 *
 * Verifies the read methods forward a caller-supplied correlation id to
 * `supabaseService.apiRpc(fn, params, { correlationId })`, where it is pinned as
 * the `X-Correlation-ID` header so the server logs the SAME id the VM logs
 * (end-to-end read-path traceability). Stubs `apiRpc` so the mapping is tested
 * in isolation from any real Supabase client.
 *
 * See dev/active/surface-transport-correlation-id-into-read-path-logs.md.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted; declare shared spies in the hoisted scope.
const { mockApiRpc, mockGetClient } = vi.hoisted(() => ({
  mockApiRpc: vi.fn(),
  mockGetClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'header.eyJvcmdfaWQiOiJvcmctdGVzdCJ9.sig' } },
      }),
    },
  })),
}));

vi.mock('@/services/auth/supabase.service', () => ({
  supabaseService: { apiRpc: mockApiRpc, getClient: mockGetClient },
}));

vi.mock('@/utils/jwt', () => ({
  decodeJWT: vi.fn(() => ({ org_id: 'org-test', sub: 'user-test' })),
}));

import { SupabaseUserQueryService } from '../SupabaseUserQueryService';

describe('SupabaseUserQueryService — correlation-id threading', () => {
  let service: SupabaseUserQueryService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRpc.mockResolvedValue({ data: [], error: null });
    service = new SupabaseUserQueryService();
  });

  it('getUserById pins the correlation id on the RPC call', async () => {
    await service.getUserById('u1', 'corr-user');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_user_by_id',
      { p_user_id: 'u1', p_org_id: 'org-test' },
      { correlationId: 'corr-user' }
    );
  });

  it('getUsersPaginated threads ONE id to both the users and invitations RPCs', async () => {
    await service.getUsersPaginated(undefined, 'corr-list');
    const calls = mockApiRpc.mock.calls;
    const listUsers = calls.find((c) => c[0] === 'list_users');
    const listInvitations = calls.find((c) => c[0] === 'list_invitations');
    expect(listUsers?.[2]).toEqual({ correlationId: 'corr-list' });
    expect(listInvitations?.[2]).toEqual({ correlationId: 'corr-list' });
  });

  it('getAssignableRoles pins the correlation id on the RPC call', async () => {
    await service.getAssignableRoles('corr-roles');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_assignable_roles',
      { p_org_id: 'org-test' },
      { correlationId: 'corr-roles' }
    );
  });

  it('getInvitationById pins the correlation id on the RPC call', async () => {
    await service.getInvitationById('inv-1', 'corr-inv');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_invitation_by_id',
      { p_invitation_id: 'inv-1' },
      { correlationId: 'corr-inv' }
    );
  });

  it('omits the opts arg cleanly when no correlation id is supplied (backward compatible)', async () => {
    await service.getInvitationById('inv-2');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_invitation_by_id',
      { p_invitation_id: 'inv-2' },
      { correlationId: undefined }
    );
  });
});
