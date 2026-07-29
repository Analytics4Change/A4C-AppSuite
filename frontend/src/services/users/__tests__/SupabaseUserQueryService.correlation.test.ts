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

  // Secondary reads threaded in the residual-apirpc-reads sweep.

  it('getInvitations (standalone) pins the correlation id', async () => {
    await service.getInvitations('corr-inv-list');
    const call = mockApiRpc.mock.calls.find((c) => c[0] === 'list_invitations');
    expect(call?.[2]).toEqual({ correlationId: 'corr-inv-list' });
  });

  it('getUserOrganizations pins the correlation id', async () => {
    await service.getUserOrganizations('corr-orgs');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'list_user_org_access',
      { p_user_id: 'user-test' },
      { correlationId: 'corr-orgs' }
    );
  });

  it('getUserAddresses pins the correlation id', async () => {
    await service.getUserAddresses('u1', 'corr-addr');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_user_addresses',
      { p_user_id: 'u1' },
      { correlationId: 'corr-addr' }
    );
  });

  it('getUserPhones pins the correlation id', async () => {
    await service.getUserPhones('u1', 'corr-phones');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_user_phones',
      { p_user_id: 'u1', p_organization_id: 'org-test' },
      { correlationId: 'corr-phones' }
    );
  });

  it('getUserOrgAccess pins the correlation id', async () => {
    await service.getUserOrgAccess('u1', 'org-9', 'corr-access');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_user_org_access',
      { p_user_id: 'u1', p_org_id: 'org-9' },
      { correlationId: 'corr-access' }
    );
  });

  it('getUserNotificationPreferences pins the correlation id', async () => {
    await service.getUserNotificationPreferences('u1', 'corr-prefs');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_user_notification_preferences',
      { p_user_id: 'u1', p_organization_id: 'org-test' },
      { correlationId: 'corr-prefs' }
    );
  });

  it('checkEmailStatus pins ONE id across all three lookup probes', async () => {
    // This method escaped the original PR #98-#100 sweep: it called its RPCs via
    // a bare `client.rpc(...)` rather than the helper, so the completeness grep
    // (`supabaseService.apiRpc<`) could not see it. Keeping it in this suite is
    // what stops it drifting back out.
    await service.checkEmailStatus('someone@example.com', 'corr-email');
    const names = mockApiRpc.mock.calls.map((c) => c[0]);
    expect(names).toContain('check_user_org_membership');
    expect(names).toContain('check_pending_invitation');
    expect(names).toContain('check_user_exists');
    for (const call of mockApiRpc.mock.calls) {
      expect(call[2]).toEqual({ correlationId: 'corr-email' });
    }
  });
});
