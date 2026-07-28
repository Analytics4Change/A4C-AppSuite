/**
 * SupabaseDirectCareSettingsService — correlation-id threading test.
 *
 * `getSettings` is a read-shape RPC (apiRpc). Its VM callers
 * (DirectCareSettingsViewModel, AssignmentListViewModel) mint a fresh id per load
 * and log it on failure; the service forwards it as the 3rd `apiRpc` arg.
 *
 * See dev/active/seed-thread-correlation-id-residual-apirpc-reads.md.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockApiRpc } = vi.hoisted(() => ({
  mockApiRpc: vi.fn(),
}));

vi.mock('@/services/auth/supabase.service', () => ({
  supabaseService: { apiRpc: mockApiRpc },
}));

import { SupabaseDirectCareSettingsService } from '../SupabaseDirectCareSettingsService';

describe('SupabaseDirectCareSettingsService — correlation-id threading', () => {
  let service: SupabaseDirectCareSettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRpc.mockResolvedValue({ data: null, error: null });
    service = new SupabaseDirectCareSettingsService();
  });

  it('getSettings pins the correlation id on the RPC call', async () => {
    await service.getSettings('org-1', 'corr-dc');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_organization_direct_care_settings',
      { p_org_id: 'org-1' },
      { correlationId: 'corr-dc' }
    );
  });

  it('omits the id cleanly when none is supplied (backward compatible)', async () => {
    await service.getSettings('org-2');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_organization_direct_care_settings',
      { p_org_id: 'org-2' },
      { correlationId: undefined }
    );
  });
});
