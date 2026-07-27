/**
 * SupabaseOrganizationQueryService — correlation-id threading tests.
 *
 * Verifies the `apiRpc`-based read methods forward a caller-supplied correlation
 * id to `supabaseService.apiRpc(fn, params, { correlationId })`, where it is
 * pinned as the `X-Correlation-ID` header so the server logs the SAME id the VM
 * logs (end-to-end read-path traceability). `getOrganizationDetails` uses the
 * envelope helper `apiRpcEnvelope`, which now ALSO forwards the id — covered by
 * the dedicated block below (mocks `apiRpcEnvelope` returning a success envelope).
 *
 * See dev/active/surface-correlation-id-on-apiRpcEnvelope-reads.md.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockApiRpc, mockApiRpcEnvelope } = vi.hoisted(() => ({
  mockApiRpc: vi.fn(),
  mockApiRpcEnvelope: vi.fn(),
}));

vi.mock('@/services/auth/supabase.service', () => ({
  supabaseService: { apiRpc: mockApiRpc, apiRpcEnvelope: mockApiRpcEnvelope },
}));

import { SupabaseOrganizationQueryService } from '../SupabaseOrganizationQueryService';

describe('SupabaseOrganizationQueryService — correlation-id threading', () => {
  let service: SupabaseOrganizationQueryService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRpc.mockResolvedValue({ data: [], error: null });
    mockApiRpcEnvelope.mockResolvedValue({
      success: true,
      organization: { name: 'Acme' },
      contacts: [],
      addresses: [],
      phones: [],
    });
    service = new SupabaseOrganizationQueryService();
  });

  it('getOrganizations pins the correlation id on the RPC call', async () => {
    await service.getOrganizations(undefined, 'corr-orgs');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_organizations',
      { p_type: null, p_is_active: null, p_search_term: null },
      { correlationId: 'corr-orgs' }
    );
  });

  it('getOrganizationById pins the correlation id on the RPC call', async () => {
    await service.getOrganizationById('org-1', 'corr-org');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_organization_by_id',
      { p_org_id: 'org-1' },
      { correlationId: 'corr-org' }
    );
  });

  it('getChildOrganizations pins the correlation id on the RPC call', async () => {
    await service.getChildOrganizations('parent-1', 'corr-children');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_child_organizations',
      { p_parent_org_id: 'parent-1' },
      { correlationId: 'corr-children' }
    );
  });

  it('getOrganizationsPaginated pins the correlation id on the RPC call', async () => {
    await service.getOrganizationsPaginated(undefined, 'corr-paged');
    const call = mockApiRpc.mock.calls.find((c) => c[0] === 'get_organizations_paginated');
    expect(call?.[2]).toEqual({ correlationId: 'corr-paged' });
  });

  it('omits the id cleanly when none is supplied (backward compatible)', async () => {
    await service.getOrganizationById('org-2');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_organization_by_id',
      { p_org_id: 'org-2' },
      { correlationId: undefined }
    );
  });

  // getOrganizationDetails routes through the ENVELOPE helper (apiRpcEnvelope),
  // which now also forwards { correlationId } as its 3rd arg.
  it('getOrganizationDetails pins the correlation id on the envelope RPC call', async () => {
    await service.getOrganizationDetails('org-1', 'corr-details');
    expect(mockApiRpcEnvelope).toHaveBeenCalledWith(
      'get_organization_details',
      { p_org_id: 'org-1' },
      { correlationId: 'corr-details' }
    );
  });

  it('getOrganizationDetails omits the id cleanly when none is supplied', async () => {
    await service.getOrganizationDetails('org-2');
    expect(mockApiRpcEnvelope).toHaveBeenCalledWith(
      'get_organization_details',
      { p_org_id: 'org-2' },
      { correlationId: undefined }
    );
  });
});
