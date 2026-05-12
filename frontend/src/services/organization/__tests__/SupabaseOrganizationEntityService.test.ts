/**
 * SupabaseOrganizationEntityService — callEntityRpc pattern tests
 *
 * Addresses architect review NT-2a on PR #56: the typed-dynamic-name wrapper
 * is the pilot for PR-B/PR-C to replicate (~70 more sites). Lock the failure
 * + success paths before the bulk wave inherits the pattern.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockApiRpcEnvelope, mockLogError } = vi.hoisted(() => ({
  mockApiRpcEnvelope: vi.fn(),
  mockLogError: vi.fn(),
}));

vi.mock('@/services/auth/supabase.service', () => ({
  supabaseService: { apiRpcEnvelope: mockApiRpcEnvelope },
}));

vi.mock('@/utils/logger', () => ({
  Logger: {
    getLogger: () => ({
      error: mockLogError,
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import { SupabaseOrganizationEntityService } from '../SupabaseOrganizationEntityService';

describe('SupabaseOrganizationEntityService', () => {
  let service: SupabaseOrganizationEntityService;

  beforeEach(() => {
    mockApiRpcEnvelope.mockReset();
    mockLogError.mockReset();
    service = new SupabaseOrganizationEntityService();
  });

  describe('callEntityRpc — failure path', () => {
    it('propagates env.error from envelope failure', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'Contact email already exists',
        errorDetails: { code: 'DUPLICATE_EMAIL', message: 'm' },
      });

      const result = await service.createContact('org-1', {
        label: 'Primary',
        type: 'admin',
        first_name: 'A',
        last_name: 'B',
        email: 'a@b.com',
      } as never);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Contact email already exists');
    });

    it('returns error message on thrown exception', async () => {
      mockApiRpcEnvelope.mockRejectedValueOnce(new Error('network down'));

      const result = await service.createContact('org-1', { label: 'x' } as never);

      expect(result.success).toBe(false);
      expect(result.error).toBe('network down');
    });
  });

  describe('callEntityRpc — success path', () => {
    it('spreads contact onto result on createContact success', async () => {
      const contact = { id: 'c1', label: 'Primary', email: 'a@b.com' };
      mockApiRpcEnvelope.mockResolvedValueOnce({ success: true, contact });

      const result = await service.createContact('org-1', { label: 'Primary' } as never);

      expect(result.success).toBe(true);
      expect(result.contact).toEqual(contact);
      expect(result.address).toBeUndefined();
      expect(result.phone).toBeUndefined();
    });

    it('spreads address onto result on createAddress success', async () => {
      const address = { id: 'a1', street: '1 Main St' };
      mockApiRpcEnvelope.mockResolvedValueOnce({ success: true, address });

      const result = await service.createAddress('org-1', { street: '1 Main St' } as never);

      expect(result.success).toBe(true);
      expect(result.address).toEqual(address);
    });

    it('spreads phone onto result on createPhone success', async () => {
      const phone = { id: 'p1', phone: '+15551234567' };
      mockApiRpcEnvelope.mockResolvedValueOnce({ success: true, phone });

      const result = await service.createPhone('org-1', { phone: '+15551234567' } as never);

      expect(result.success).toBe(true);
      expect(result.phone).toEqual(phone);
    });
  });

  describe('logIfPostgrestError integration (PR-D backfill — verb from rpcName)', () => {
    it('derives verb from rpcName via snake→space transform on PostgREST failure', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'permission denied',
        postgrestError: { code: '42501', message: 'permission denied', details: '', hint: '' },
      });

      await service.createContact('org-1', {} as never);

      // Verb is derived from rpcName ('create_organization_contact' → 'create organization contact')
      // per the Q2 architect-revised plan: no caller changes, single-line transform inside wrapper.
      expect(mockLogError).toHaveBeenCalledWith('Failed to create organization contact', {
        error: 'permission denied',
      });
    });

    it('uses correct verb for each of the 9 entity RPCs', async () => {
      const cases: Array<[() => Promise<unknown>, string]> = [
        [() => service.createContact('o', {} as never), 'create organization contact'],
        [() => service.updateContact('c', {} as never), 'update organization contact'],
        [() => service.deleteContact('c'), 'delete organization contact'],
        [() => service.createAddress('o', {} as never), 'create organization address'],
        [() => service.updateAddress('a', {} as never), 'update organization address'],
        [() => service.deleteAddress('a'), 'delete organization address'],
        [() => service.createPhone('o', {} as never), 'create organization phone'],
        [() => service.updatePhone('p', {} as never), 'update organization phone'],
        [() => service.deletePhone('p'), 'delete organization phone'],
      ];

      for (const [call, expectedVerb] of cases) {
        mockLogError.mockReset();
        mockApiRpcEnvelope.mockResolvedValueOnce({
          success: false,
          error: 'boom',
          postgrestError: { code: '500', message: 'boom', details: '', hint: '' },
        });
        await call();
        expect(mockLogError).toHaveBeenCalledWith(`Failed to ${expectedVerb}`, { error: 'boom' });
      }
    });

    it('does NOT emit log.error on handler-driven envelope failure', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'Duplicate contact',
      });

      await service.createContact('o', {} as never);

      expect(mockLogError).not.toHaveBeenCalled();
    });
  });

  describe('callEntityRpc — typed dynamic name', () => {
    it('forwards the static-literal rpcName through to apiRpcEnvelope (9 callers)', async () => {
      mockApiRpcEnvelope.mockResolvedValue({ success: true });

      await service.createContact('o1', {} as never);
      await service.updateContact('c1', {} as never);
      await service.deleteContact('c1');
      await service.createAddress('o1', {} as never);
      await service.updateAddress('a1', {} as never);
      await service.deleteAddress('a1');
      await service.createPhone('o1', {} as never);
      await service.updatePhone('p1', {} as never);
      await service.deletePhone('p1');

      const calls = mockApiRpcEnvelope.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls).toEqual([
        'create_organization_contact',
        'update_organization_contact',
        'delete_organization_contact',
        'create_organization_address',
        'update_organization_address',
        'delete_organization_address',
        'create_organization_phone',
        'update_organization_phone',
        'delete_organization_phone',
      ]);
    });
  });
});
