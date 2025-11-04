/**
 * ActivateOrganization Activity Tests
 *
 * Tests organization activation with idempotency.
 */

import { activateOrganization } from '@activities/organization-bootstrap';
import type { ActivateOrganizationParams } from '@shared/types';
import { getSupabaseClient } from '@shared/utils/supabase';

jest.mock('@shared/utils/supabase');
jest.mock('@shared/utils/emit-event', () => ({
  emitEvent: jest.fn().mockResolvedValue(undefined),
  buildTags: jest.fn().mockReturnValue([])
}));

describe('ActivateOrganization Activity', () => {
  const mockSupabase = {
    from: jest.fn(() => mockSupabase),
    select: jest.fn(() => mockSupabase),
    update: jest.fn(() => mockSupabase),
    eq: jest.fn(() => Promise.resolve({ error: null })),
    single: jest.fn(),
    then: jest.fn((resolve) => resolve({ error: null })) // Make mockSupabase awaitable
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getSupabaseClient as jest.Mock).mockReturnValue(mockSupabase);
    // Reset eq to return mockSupabase by default (for chaining)
    mockSupabase.eq.mockImplementation(() => mockSupabase);
  });

  describe('Happy Path', () => {
    it('should activate organization successfully', async () => {
      // Mock: Organization exists in provisioning state
      mockSupabase.single.mockResolvedValueOnce({
        data: { status: 'provisioning' },
        error: null
      });

      const params: ActivateOrganizationParams = {
        orgId: 'org-123'
      };

      const result = await activateOrganization(params);

      expect(result).toBe(true);
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'active'
        })
      );
    });
  });

  describe('Idempotency', () => {
    it('should succeed if organization already active', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: { status: 'active' },
        error: null
      });

      const params: ActivateOrganizationParams = {
        orgId: 'org-123'
      };

      const result = await activateOrganization(params);

      expect(result).toBe(true);
      expect(mockSupabase.update).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should throw error if organization not found', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Organization not found' }
      });

      const params: ActivateOrganizationParams = {
        orgId: 'nonexistent-org'
      };

      await expect(activateOrganization(params)).rejects.toThrow(
        'Failed to check organization status'
      );
    });
  });
});
