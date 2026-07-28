/**
 * getOrganizationSubdomainInfo — correlation-id threading test (service-mints variant).
 *
 * This standalone auth-flow function owns its `'RPC error'` log and returns null;
 * its callers (LoginPage/AuthCallback) observe null and don't log the read
 * failure. So it mints a fresh id internally via a defaulted param and pins it as
 * the 3rd `apiRpc` arg. NOTE: this calls the same RPC name (`get_organization_by_id`)
 * as `SupabaseOrganizationQueryService.getOrganizationById` (threaded in #98) — a
 * DIFFERENT call site; this test scopes to the standalone function.
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

vi.mock('@/utils/trace-ids', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/trace-ids')>()),
  generateCorrelationId: () => 'fixed-corr',
}));

import { getOrganizationSubdomainInfo } from '../getOrganizationSubdomainInfo';

describe('getOrganizationSubdomainInfo — correlation-id threading (service-mints)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRpc.mockResolvedValue({
      data: [{ slug: 'acme', subdomain_status: 'verified' }],
      error: null,
    });
  });

  it('pins the internally-minted id on the RPC call', async () => {
    await getOrganizationSubdomainInfo('org-1');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_organization_by_id',
      { p_org_id: 'org-1' },
      { correlationId: 'fixed-corr' }
    );
  });

  it('accepts a caller-supplied id (overriding the default)', async () => {
    await getOrganizationSubdomainInfo('org-2', 'caller-corr');
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_organization_by_id',
      { p_org_id: 'org-2' },
      { correlationId: 'caller-corr' }
    );
  });
});
