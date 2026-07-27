/**
 * OrphanedDeletionService — correlation-id threading test (service-mints variant).
 *
 * `getOrphanedDeletions` owns its read-failure log (the caller,
 * OrphanedDeletionsPage, only sets error state), so it mints a fresh id
 * internally via a defaulted param and pins it as the 3rd `apiRpc` arg. The
 * `generateCorrelationId` stub makes the minted id assertable.
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

import { OrphanedDeletionService } from '../OrphanedDeletionService';

describe('OrphanedDeletionService — correlation-id threading (service-mints)', () => {
  let service: OrphanedDeletionService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRpc.mockResolvedValue({ data: [], error: null });
    service = new OrphanedDeletionService();
  });

  it('getOrphanedDeletions pins the internally-minted id on the RPC call', async () => {
    await service.getOrphanedDeletions(48);
    expect(mockApiRpc).toHaveBeenCalledWith(
      'get_orphaned_deletions',
      { p_hours_threshold: 48 },
      { correlationId: 'fixed-corr' }
    );
  });
});
