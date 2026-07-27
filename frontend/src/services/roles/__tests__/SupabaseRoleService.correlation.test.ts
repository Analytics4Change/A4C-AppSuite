/**
 * SupabaseRoleService — correlation-id threading tests.
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
const { mockApiRpc } = vi.hoisted(() => ({
  mockApiRpc: vi.fn(),
}));

vi.mock('@/services/auth/supabase.service', () => ({
  supabaseService: { apiRpc: mockApiRpc },
}));

import { SupabaseRoleService } from '../SupabaseRoleService';

describe('SupabaseRoleService — correlation-id threading', () => {
  let service: SupabaseRoleService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRpc.mockResolvedValue({ data: [], error: null });
    service = new SupabaseRoleService();
  });

  it('getRoles pins the correlation id on the RPC call', async () => {
    await service.getRoles(undefined, 'corr-roles');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_roles',
      { p_status: 'all', p_search_term: null },
      { correlationId: 'corr-roles' }
    );
  });

  it('getRoleById pins the correlation id on the RPC call', async () => {
    await service.getRoleById('role-1', 'corr-role');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_role_by_id',
      { p_role_id: 'role-1' },
      { correlationId: 'corr-role' }
    );
  });

  it('getPermissions pins the correlation id on the RPC call', async () => {
    await service.getPermissions('corr-perms');
    expect(mockApiRpc).toHaveBeenCalledWith('get_permissions', {}, { correlationId: 'corr-perms' });
  });

  it('getUserPermissions pins the correlation id on the RPC call', async () => {
    await service.getUserPermissions('corr-user-perms');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_user_permissions',
      {},
      { correlationId: 'corr-user-perms' }
    );
  });

  it('omits the id cleanly when none is supplied (backward compatible)', async () => {
    await service.getRoles();
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_roles',
      { p_status: 'all', p_search_term: null },
      { correlationId: undefined }
    );
  });
});
