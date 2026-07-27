/**
 * SupabaseAssignmentService — correlation-id threading tests (envelope read).
 *
 * Verifies `listAssignments` forwards a caller-supplied correlation id to
 * `supabaseService.apiRpcEnvelope(fn, params, { correlationId })`, pinning it as
 * the `X-Correlation-ID` header for end-to-end read-path traceability. Mocks
 * `apiRpcEnvelope` returning an `{ success: true, ... }` envelope.
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

import { SupabaseAssignmentService } from '../SupabaseAssignmentService';

describe('SupabaseAssignmentService — correlation-id threading (envelope read)', () => {
  let service: SupabaseAssignmentService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRpcEnvelope.mockResolvedValue({ success: true, data: [] });
    service = new SupabaseAssignmentService();
  });

  it('listAssignments pins the correlation id on the RPC call', async () => {
    await service.listAssignments({ userId: 'u1' }, 'corr-assign');
    expect(mockApiRpcEnvelope).toHaveBeenCalledWith(
      'list_user_client_assignments',
      { p_org_id: null, p_user_id: 'u1', p_client_id: null, p_active_only: true },
      { correlationId: 'corr-assign' }
    );
  });

  it('omits the id cleanly when none is supplied (backward compatible)', async () => {
    await service.listAssignments({ clientId: 'c1' });
    expect(mockApiRpcEnvelope).toHaveBeenCalledWith(
      'list_user_client_assignments',
      { p_org_id: null, p_user_id: null, p_client_id: 'c1', p_active_only: true },
      { correlationId: undefined }
    );
  });
});
