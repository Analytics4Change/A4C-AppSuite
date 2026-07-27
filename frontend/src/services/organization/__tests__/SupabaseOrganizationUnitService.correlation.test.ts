/**
 * SupabaseOrganizationUnitService — correlation-id threading tests.
 *
 * Verifies the `apiRpc`-based read methods forward a caller-supplied correlation
 * id to `supabaseService.apiRpc(fn, params, { correlationId })`, where it is
 * pinned as the `X-Correlation-ID` header so the server logs the SAME id the VM
 * logs (end-to-end read-path traceability). Stubs `apiRpc` so the mapping is
 * tested in isolation from any real Supabase client.
 *
 * See dev/active/surface-transport-correlation-id-into-read-path-logs.md.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockApiRpc } = vi.hoisted(() => ({
  mockApiRpc: vi.fn(),
}));

vi.mock('@/services/auth/supabase.service', () => ({
  supabaseService: { apiRpc: mockApiRpc },
}));

import { SupabaseOrganizationUnitService } from '../SupabaseOrganizationUnitService';

describe('SupabaseOrganizationUnitService — correlation-id threading', () => {
  let service: SupabaseOrganizationUnitService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRpc.mockResolvedValue({ data: [], error: null });
    service = new SupabaseOrganizationUnitService();
  });

  it('getUnits pins the correlation id on the RPC call', async () => {
    await service.getUnits(undefined, 'corr-units');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_organization_units',
      { p_status: 'all', p_search_term: null },
      { correlationId: 'corr-units' }
    );
  });

  it('getUnitById pins the correlation id on the RPC call', async () => {
    await service.getUnitById('unit-1', 'corr-unit');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_organization_unit_by_id',
      { p_unit_id: 'unit-1' },
      { correlationId: 'corr-unit' }
    );
  });

  it('getDescendants pins the correlation id on the RPC call', async () => {
    await service.getDescendants('unit-1', 'corr-desc');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_organization_unit_descendants',
      { p_unit_id: 'unit-1' },
      { correlationId: 'corr-desc' }
    );
  });

  it('omits the id cleanly when none is supplied (backward compatible)', async () => {
    await service.getUnitById('unit-2');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_organization_unit_by_id',
      { p_unit_id: 'unit-2' },
      { correlationId: undefined }
    );
  });
});
