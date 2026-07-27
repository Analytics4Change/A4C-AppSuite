/**
 * SupabaseClientFieldService — correlation-id threading tests.
 *
 * Verifies the `apiRpc`-based read methods forward a caller-supplied correlation
 * id to `supabaseService.apiRpc(fn, params, { correlationId })`, where it is
 * pinned as the `X-Correlation-ID` header so the server logs the SAME id the VM
 * logs (end-to-end read-path traceability). The client-field VM reuses its
 * session correlation id for these reads (load→edit→batch-save is one audit
 * trail), so the id is caller-supplied exactly as asserted here.
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

import { SupabaseClientFieldService } from '../SupabaseClientFieldService';

describe('SupabaseClientFieldService — correlation-id threading', () => {
  let service: SupabaseClientFieldService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRpc.mockResolvedValue({ data: [], error: null });
    service = new SupabaseClientFieldService();
  });

  it('listFieldDefinitions pins the correlation id on the RPC call', async () => {
    await service.listFieldDefinitions(true, 'corr-defs');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'list_field_definitions',
      { p_include_inactive: true },
      { correlationId: 'corr-defs' }
    );
  });

  it('listFieldCategories pins the correlation id on the RPC call', async () => {
    await service.listFieldCategories(true, 'corr-cats');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'list_field_categories',
      { p_include_inactive: true },
      { correlationId: 'corr-cats' }
    );
  });

  it('omits the id cleanly when none is supplied (backward compatible)', async () => {
    await service.listFieldDefinitions();
    expect(mockApiRpc).toHaveBeenCalledWith(
      'list_field_definitions',
      { p_include_inactive: false },
      { correlationId: undefined }
    );
  });
});
