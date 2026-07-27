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

const { mockApiRpc, mockApiRpcEnvelope } = vi.hoisted(() => ({
  mockApiRpc: vi.fn(),
  mockApiRpcEnvelope: vi.fn(),
}));

vi.mock('@/services/auth/supabase.service', () => ({
  supabaseService: { apiRpc: mockApiRpc, apiRpcEnvelope: mockApiRpcEnvelope },
}));

import { SupabaseClientFieldService } from '../SupabaseClientFieldService';

describe('SupabaseClientFieldService — correlation-id threading', () => {
  let service: SupabaseClientFieldService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRpc.mockResolvedValue({ data: [], error: null });
    mockApiRpcEnvelope.mockResolvedValue({ success: true, count: 0, fields: [] });
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

  // The usage-count reads route through the ENVELOPE helper (apiRpcEnvelope),
  // which now also forwards { correlationId }. The VM reuses its SESSION id here.
  it('getFieldUsageCount pins the correlation id on the envelope RPC call', async () => {
    mockApiRpcEnvelope.mockResolvedValueOnce({ success: true, count: 0 });
    await service.getFieldUsageCount('weekend_hours', 'corr-usage');
    expect(mockApiRpcEnvelope).toHaveBeenCalledWith(
      'get_field_usage_count',
      { p_field_key: 'weekend_hours' },
      { correlationId: 'corr-usage' }
    );
  });

  it('getCategoryFieldCount pins the correlation id on the envelope RPC call', async () => {
    await service.getCategoryFieldCount('cat-1', true, 'corr-catcount');
    expect(mockApiRpcEnvelope).toHaveBeenCalledWith(
      'get_category_field_count',
      { p_category_id: 'cat-1', p_include_inactive: true },
      { correlationId: 'corr-catcount' }
    );
  });

  it('getCategoryFieldCount omits the id cleanly when none is supplied', async () => {
    await service.getCategoryFieldCount('cat-2');
    expect(mockApiRpcEnvelope).toHaveBeenCalledWith(
      'get_category_field_count',
      { p_category_id: 'cat-2', p_include_inactive: false },
      { correlationId: undefined }
    );
  });

  it('getFieldUsageCount omits the id cleanly when none is supplied', async () => {
    mockApiRpcEnvelope.mockResolvedValueOnce({ success: true, count: 0 });
    await service.getFieldUsageCount('weekend_hours');
    expect(mockApiRpcEnvelope).toHaveBeenCalledWith(
      'get_field_usage_count',
      { p_field_key: 'weekend_hours' },
      { correlationId: undefined }
    );
  });
});
