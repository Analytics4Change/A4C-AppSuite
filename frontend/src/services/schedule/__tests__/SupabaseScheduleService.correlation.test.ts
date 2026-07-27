/**
 * SupabaseScheduleService — correlation-id threading tests (envelope reads).
 *
 * Verifies `listTemplates`/`getTemplate` forward a caller-supplied correlation id
 * to `supabaseService.apiRpcEnvelope(fn, params, { correlationId })`, pinning it as
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

import { SupabaseScheduleService } from '../SupabaseScheduleService';

describe('SupabaseScheduleService — correlation-id threading (envelope reads)', () => {
  let service: SupabaseScheduleService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRpcEnvelope.mockResolvedValue({ success: true, data: [] });
    service = new SupabaseScheduleService();
  });

  it('listTemplates pins the correlation id on the RPC call', async () => {
    await service.listTemplates({ status: 'all' }, 'corr-templates');
    expect(mockApiRpcEnvelope).toHaveBeenCalledWith(
      'list_schedule_templates',
      { p_org_id: null, p_status: 'all', p_search: null },
      { correlationId: 'corr-templates' }
    );
  });

  it('getTemplate pins the correlation id on the RPC call', async () => {
    await service.getTemplate('tpl-1', 'corr-template');
    expect(mockApiRpcEnvelope).toHaveBeenCalledWith(
      'get_schedule_template',
      { p_template_id: 'tpl-1' },
      { correlationId: 'corr-template' }
    );
  });

  it('omits the id cleanly when none is supplied (backward compatible)', async () => {
    await service.getTemplate('tpl-2');
    expect(mockApiRpcEnvelope).toHaveBeenCalledWith(
      'get_schedule_template',
      { p_template_id: 'tpl-2' },
      { correlationId: undefined }
    );
  });
});
