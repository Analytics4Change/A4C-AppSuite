/**
 * CreateOrganization Activity Tests
 *
 * Tests organization creation with idempotency and tags support.
 */

import { createOrganization } from '@activities/organization-bootstrap';
import type { CreateOrganizationParams } from '@shared/types';
import { getSupabaseClient, resetSupabaseClient } from '@shared/utils/supabase';

// Mock Supabase client
jest.mock('@shared/utils/supabase');

describe('CreateOrganization Activity', () => {
  const mockSupabase = {
    from: jest.fn(() => mockSupabase),
    select: jest.fn(() => mockSupabase),
    insert: jest.fn(() => mockSupabase),
    eq: jest.fn(() => mockSupabase),
    maybeSingle: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getSupabaseClient as jest.Mock).mockReturnValue(mockSupabase);
  });

  describe('Happy Path', () => {
    it('should create organization and return ID', async () => {
      // Mock: No existing organization
      mockSupabase.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null
      });

      // Mock: Successful insert
      mockSupabase.insert.mockResolvedValueOnce({
        error: null
      });

      const params: CreateOrganizationParams = {
        name: 'Test Organization',
        type: 'provider',
        contactEmail: 'admin@test.com',
        subdomain: 'test-org'
      };

      const orgId = await createOrganization(params);

      expect(orgId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(mockSupabase.from).toHaveBeenCalledWith('organizations_projection');
      expect(mockSupabase.insert).toHaveBeenCalled();
    });

    it('should create partner organization with parent', async () => {
      mockSupabase.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null
      });

      mockSupabase.insert.mockResolvedValueOnce({
        error: null
      });

      const params: CreateOrganizationParams = {
        name: 'Partner Organization',
        type: 'partner',
        parentOrgId: 'parent-org-id',
        contactEmail: 'admin@partner.com',
        subdomain: 'partner-org'
      };

      const orgId = await createOrganization(params);

      expect(orgId).toBeDefined();
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'partner',
          parent_org_id: 'parent-org-id'
        })
      );
    });
  });

  describe('Idempotency', () => {
    it('should return existing organization ID if subdomain exists', async () => {
      const existingOrgId = 'existing-org-id';

      // Mock: Organization exists
      mockSupabase.maybeSingle.mockResolvedValueOnce({
        data: { id: existingOrgId },
        error: null
      });

      const params: CreateOrganizationParams = {
        name: 'Test Organization',
        type: 'provider',
        contactEmail: 'admin@test.com',
        subdomain: 'existing-org'
      };

      const orgId = await createOrganization(params);

      expect(orgId).toBe(existingOrgId);
      expect(mockSupabase.insert).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should throw error if check query fails', async () => {
      mockSupabase.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database connection error' }
      });

      const params: CreateOrganizationParams = {
        name: 'Test Organization',
        type: 'provider',
        contactEmail: 'admin@test.com',
        subdomain: 'test-org'
      };

      await expect(createOrganization(params)).rejects.toThrow(
        'Failed to check existing organization'
      );
    });

    it('should throw error if insert fails', async () => {
      mockSupabase.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null
      });

      mockSupabase.insert.mockResolvedValueOnce({
        error: { message: 'Unique constraint violation' }
      });

      const params: CreateOrganizationParams = {
        name: 'Test Organization',
        type: 'provider',
        contactEmail: 'admin@test.com',
        subdomain: 'test-org'
      };

      await expect(createOrganization(params)).rejects.toThrow(
        'Failed to create organization'
      );
    });
  });

  describe('Tags Support', () => {
    it('should apply tags when TAG_DEV_ENTITIES=true', async () => {
      process.env.TAG_DEV_ENTITIES = 'true';
      process.env.WORKFLOW_MODE = 'development';

      mockSupabase.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null
      });

      mockSupabase.insert.mockResolvedValueOnce({
        error: null
      });

      const params: CreateOrganizationParams = {
        name: 'Test Organization',
        type: 'provider',
        contactEmail: 'admin@test.com',
        subdomain: 'test-org'
      };

      await createOrganization(params);

      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: expect.arrayContaining(['development'])
        })
      );
    });

    it('should not apply tags when TAG_DEV_ENTITIES=false', async () => {
      process.env.TAG_DEV_ENTITIES = 'false';

      mockSupabase.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null
      });

      mockSupabase.insert.mockResolvedValueOnce({
        error: null
      });

      const params: CreateOrganizationParams = {
        name: 'Test Organization',
        type: 'provider',
        contactEmail: 'admin@test.com',
        subdomain: 'test-org'
      };

      await createOrganization(params);

      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: []
        })
      );
    });
  });
});
