/**
 * SupabaseClientService — correlation-id threading tests (envelope reads).
 *
 * Verifies the envelope-shape read methods forward a caller-supplied correlation
 * id to `supabaseService.apiRpcEnvelope(fn, params, { correlationId })`, where it
 * is pinned as the `X-Correlation-ID` header so the server logs the SAME id the
 * caller logs (end-to-end read-path traceability). Mocks `apiRpcEnvelope` (NOT
 * `apiRpc`) returning an `{ success: true, ... }` envelope.
 *
 * See dev/active/surface-correlation-id-on-apiRpcEnvelope-reads.md.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockApiRpcEnvelope } = vi.hoisted(() => ({
  mockApiRpcEnvelope: vi.fn(),
}));

vi.mock('@/services/auth/supabase.service', () => ({
  supabaseService: { apiRpcEnvelope: mockApiRpcEnvelope },
}));

import { SupabaseClientService } from '../SupabaseClientService';

describe('SupabaseClientService — correlation-id threading (envelope reads)', () => {
  let service: SupabaseClientService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRpcEnvelope.mockResolvedValue({ success: true, data: [] });
    service = new SupabaseClientService();
  });

  it('listClients pins the correlation id on the RPC call', async () => {
    await service.listClients('active', 'jo', 'corr-clients');
    expect(mockApiRpcEnvelope).toHaveBeenCalledWith(
      'list_clients',
      { p_status: 'active', p_search_term: 'jo' },
      { correlationId: 'corr-clients' }
    );
  });

  it('getClient pins the correlation id on the RPC call', async () => {
    mockApiRpcEnvelope.mockResolvedValueOnce({ success: true, data: { id: 'c1' } });
    await service.getClient('c1', 'corr-client');
    expect(mockApiRpcEnvelope).toHaveBeenCalledWith(
      'get_client',
      { p_client_id: 'c1' },
      { correlationId: 'corr-client' }
    );
  });

  it('omits the id cleanly when none is supplied (backward compatible)', async () => {
    await service.listClients();
    expect(mockApiRpcEnvelope).toHaveBeenCalledWith(
      'list_clients',
      { p_status: null, p_search_term: null },
      { correlationId: undefined }
    );
  });
});
