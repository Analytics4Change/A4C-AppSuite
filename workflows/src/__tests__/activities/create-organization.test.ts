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

      // Mock: Successful inserts (org + events)
      mockSupabase.insert.mockResolvedValue({
        error: null
      });

      const params: CreateOrganizationParams = {
        name: 'Test Organization',
        type: 'provider',
        subdomain: 'test-org',
        contacts: [{
          firstName: 'John',
          lastName: 'Doe',
          email: 'admin@test.com',
          type: 'a4c_admin',
          label: 'Primary Contact'
        }],
        addresses: [{
          street1: '123 Main St',
          city: 'Portland',
          state: 'OR',
          zipCode: '97201',
          type: 'physical',
          label: 'Main Office'
        }],
        phones: [{
          number: '555-1234',
          type: 'office',
          label: 'Main Line'
        }]
      };

      const orgId = await createOrganization(params);

      expect(orgId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(mockSupabase.from).toHaveBeenCalledWith('domain_events');
      expect(mockSupabase.insert).toHaveBeenCalled();
    });

    it('should create partner organization with parent', async () => {
      mockSupabase.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null
      });

      mockSupabase.insert.mockResolvedValue({
        error: null
      });

      const params: CreateOrganizationParams = {
        name: 'Partner Organization',
        type: 'partner',
        parentOrgId: 'parent-org-id',
        subdomain: 'partner-org',
        partnerType: 'var',
        contacts: [{
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'admin@partner.com',
          type: 'a4c_admin',
          label: 'Partner Admin'
        }],
        addresses: [{
          street1: '456 Partner St',
          city: 'Seattle',
          state: 'WA',
          zipCode: '98101',
          type: 'physical',
          label: 'Partner Office'
        }],
        phones: [{
          number: '555-5678',
          type: 'office',
          label: 'Partner Phone'
        }]
      };

      const orgId = await createOrganization(params);

      expect(orgId).toBeDefined();
      // Check that events were emitted (mock was called multiple times)
      expect(mockSupabase.insert).toHaveBeenCalled();
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
        subdomain: 'existing-org',
        contacts: [{
          firstName: 'John',
          lastName: 'Doe',
          email: 'admin@test.com',
          type: 'a4c_admin',
          label: 'Primary Contact'
        }],
        addresses: [{
          street1: '123 Main St',
          city: 'Portland',
          state: 'OR',
          zipCode: '97201',
          type: 'physical',
          label: 'Main Office'
        }],
        phones: [{
          number: '555-1234',
          type: 'office',
          label: 'Main Line'
        }]
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
        subdomain: 'test-org',
        contacts: [{
          firstName: 'John',
          lastName: 'Doe',
          email: 'admin@test.com',
          type: 'a4c_admin',
          label: 'Primary Contact'
        }],
        addresses: [{
          street1: '123 Main St',
          city: 'Portland',
          state: 'OR',
          zipCode: '97201',
          type: 'physical',
          label: 'Main Office'
        }],
        phones: [{
          number: '555-1234',
          type: 'office',
          label: 'Main Line'
        }]
      };

      await expect(createOrganization(params)).rejects.toThrow(
        'Failed to check existing organization'
      );
    });

    it('should throw error if event emission fails', async () => {
      mockSupabase.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null
      });

      // First insert succeeds (organization event), second fails (contact event)
      mockSupabase.insert
        .mockResolvedValueOnce({ error: null })
        .mockResolvedValueOnce({ error: { message: 'Unique constraint violation' } });

      const params: CreateOrganizationParams = {
        name: 'Test Organization',
        type: 'provider',
        subdomain: 'test-org',
        contacts: [{
          firstName: 'John',
          lastName: 'Doe',
          email: 'admin@test.com',
          type: 'a4c_admin',
          label: 'Primary Contact'
        }],
        addresses: [{
          street1: '123 Main St',
          city: 'Portland',
          state: 'OR',
          zipCode: '97201',
          type: 'physical',
          label: 'Main Office'
        }],
        phones: [{
          number: '555-1234',
          type: 'office',
          label: 'Main Line'
        }]
      };

      await expect(createOrganization(params)).rejects.toThrow(
        'Failed to emit event'
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

      mockSupabase.insert.mockResolvedValue({
        error: null
      });

      const params: CreateOrganizationParams = {
        name: 'Test Organization',
        type: 'provider',
        subdomain: 'test-org',
        contacts: [{
          firstName: 'John',
          lastName: 'Doe',
          email: 'admin@test.com',
          type: 'a4c_admin',
          label: 'Primary Contact'
        }],
        addresses: [{
          street1: '123 Main St',
          city: 'Portland',
          state: 'OR',
          zipCode: '97201',
          type: 'physical',
          label: 'Main Office'
        }],
        phones: [{
          number: '555-1234',
          type: 'office',
          label: 'Main Line'
        }]
      };

      await createOrganization(params);

      // Check that events were emitted with tags in event_metadata
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          event_metadata: expect.objectContaining({
            tags: expect.arrayContaining(['development'])
          })
        })
      );
    });

    it('should not apply tags when TAG_DEV_ENTITIES=false', async () => {
      process.env.TAG_DEV_ENTITIES = 'false';

      mockSupabase.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null
      });

      mockSupabase.insert.mockResolvedValue({
        error: null
      });

      const params: CreateOrganizationParams = {
        name: 'Test Organization',
        type: 'provider',
        subdomain: 'test-org',
        contacts: [{
          firstName: 'John',
          lastName: 'Doe',
          email: 'admin@test.com',
          type: 'a4c_admin',
          label: 'Primary Contact'
        }],
        addresses: [{
          street1: '123 Main St',
          city: 'Portland',
          state: 'OR',
          zipCode: '97201',
          type: 'physical',
          label: 'Main Office'
        }],
        phones: [{
          number: '555-1234',
          type: 'office',
          label: 'Main Line'
        }]
      };

      await createOrganization(params);

      // Check that events were emitted without tags (no event_metadata.tags)
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          event_metadata: expect.not.objectContaining({
            tags: expect.anything()
          })
        })
      );
    });
  });
});
