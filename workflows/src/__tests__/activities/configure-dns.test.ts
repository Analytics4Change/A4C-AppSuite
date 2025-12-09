/**
 * ConfigureDNS Activity Tests
 *
 * Tests DNS configuration with idempotency and provider mocking.
 */

import { configureDNS } from '@activities/organization-bootstrap';
import type { ConfigureDNSParams } from '@shared/types';
import { createDNSProvider } from '@shared/providers/dns/factory';

// Mock DNS provider factory
jest.mock('@shared/providers/dns/factory');
jest.mock('@shared/utils/emit-event', () => ({
  emitEvent: jest.fn().mockResolvedValue(undefined),
  buildTags: jest.fn().mockReturnValue([])
}));
jest.mock('@shared/config/env-schema', () => ({
  getWorkflowsEnv: jest.fn().mockReturnValue({
    PLATFORM_BASE_DOMAIN: 'firstovertheline.com',
    FRONTEND_URL: 'https://a4c.firstovertheline.com',
    TARGET_DOMAIN: 'a4c.firstovertheline.com'
  })
}));

describe('ConfigureDNS Activity', () => {
  const mockDNSProvider = {
    listZones: jest.fn(),
    listRecords: jest.fn(),
    createRecord: jest.fn(),
    deleteRecord: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (createDNSProvider as jest.Mock).mockReturnValue(mockDNSProvider);
  });

  describe('Happy Path', () => {
    it('should create DNS CNAME record successfully', async () => {
      // Mock: Zone found
      mockDNSProvider.listZones.mockResolvedValueOnce([
        { id: 'zone-123', name: 'firstovertheline.com' }
      ]);

      // Mock: No existing records
      mockDNSProvider.listRecords.mockResolvedValueOnce([]);

      // Mock: Record created
      mockDNSProvider.createRecord.mockResolvedValueOnce({
        id: 'record-456',
        type: 'CNAME',
        name: 'test-org.firstovertheline.com',
        content: 'firstovertheline.com',
        ttl: 3600,
        proxied: false
      });

      const params: ConfigureDNSParams = {
        orgId: 'org-123',
        subdomain: 'test-org',
        targetDomain: 'firstovertheline.com'
      };

      const result = await configureDNS(params);

      expect(result.fqdn).toBe('test-org.firstovertheline.com');
      expect(result.recordId).toBe('record-456');
      expect(mockDNSProvider.createRecord).toHaveBeenCalledWith(
        'zone-123',
        expect.objectContaining({
          type: 'CNAME',
          name: 'test-org.firstovertheline.com',
          content: 'firstovertheline.com'
        })
      );
    });
  });

  describe('Idempotency', () => {
    it('should return existing record if already exists', async () => {
      mockDNSProvider.listZones.mockResolvedValueOnce([
        { id: 'zone-123', name: 'firstovertheline.com' }
      ]);

      // Mock: Existing record found
      mockDNSProvider.listRecords.mockResolvedValueOnce([
        {
          id: 'existing-record-456',
          type: 'CNAME',
          name: 'test-org.firstovertheline.com',
          content: 'firstovertheline.com',
          ttl: 3600,
          proxied: false
        }
      ]);

      const params: ConfigureDNSParams = {
        orgId: 'org-123',
        subdomain: 'test-org',
        targetDomain: 'firstovertheline.com'
      };

      const result = await configureDNS(params);

      expect(result.recordId).toBe('existing-record-456');
      expect(mockDNSProvider.createRecord).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should throw error if no zone found', async () => {
      mockDNSProvider.listZones.mockResolvedValueOnce([]);

      const params: ConfigureDNSParams = {
        orgId: 'org-123',
        subdomain: 'test-org',
        targetDomain: 'nonexistent.com'
      };

      await expect(configureDNS(params)).rejects.toThrow(
        'No DNS zone found for domain'
      );
    });

    it('should throw error if DNS provider fails', async () => {
      mockDNSProvider.listZones.mockRejectedValueOnce(
        new Error('DNS provider unavailable')
      );

      const params: ConfigureDNSParams = {
        orgId: 'org-123',
        subdomain: 'test-org',
        targetDomain: 'firstovertheline.com'
      };

      await expect(configureDNS(params)).rejects.toThrow(
        'DNS provider unavailable'
      );
    });
  });
});
