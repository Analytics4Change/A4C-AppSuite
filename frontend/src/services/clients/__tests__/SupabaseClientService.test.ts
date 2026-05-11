/**
 * SupabaseClientService — envelope-contract tests (F4 closure)
 *
 * Addresses PR #58 architect review F4: PR-C migrated 30 sites with zero
 * coverage. This file pins the load-bearing contracts that are at risk of
 * silent regression in PR-D and future migrations:
 *
 *  - Query throw contract (listClients / getClient) — PostgREST + envelope failure
 *  - Lifecycle return contract — log.error fires on PostgREST failure (F1 helper)
 *  - updateClient refetch fallback — when RPC returns success without projection row
 *  - Representative mutation (addClientPhone) — success-path envelope spread + return
 *
 * Test-mock pattern matches the helper-mock template from PR-A
 * (SupabaseUserCommandService.mapping.test.ts) and PR-B
 * (SupabaseClientFieldService.test.ts).
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

import { SupabaseClientService } from '../SupabaseClientService';

function pgFailure(msg: string) {
  return {
    success: false as const,
    error: msg,
    postgrestError: { code: '500', message: msg, details: '', hint: '' },
  };
}

describe('SupabaseClientService', () => {
  let service: SupabaseClientService;

  beforeEach(() => {
    mockApiRpcEnvelope.mockReset();
    mockLogError.mockReset();
    service = new SupabaseClientService();
  });

  // ---------------------------------------------------------------------------
  // Query throw contract (listClients / getClient)
  // ---------------------------------------------------------------------------

  describe('listClients — throw contract', () => {
    it('returns data array on success', async () => {
      const clients = [{ id: 'c1' }, { id: 'c2' }];
      mockApiRpcEnvelope.mockResolvedValueOnce({ success: true, data: clients });

      const result = await service.listClients();

      expect(mockApiRpcEnvelope).toHaveBeenCalledWith('list_clients', {
        p_status: null,
        p_search_term: null,
      });
      expect(result).toEqual(clients);
    });

    it('throws with verb-prefixed message on PostgREST failure (via throwIfPostgrestError)', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce(pgFailure('permission denied'));

      await expect(service.listClients()).rejects.toThrow(
        'Failed to list clients: permission denied'
      );
    });

    it('throws on envelope-driven failure (no postgrestError)', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'Invalid status filter',
      });

      await expect(service.listClients()).rejects.toThrow('Invalid status filter');
    });
  });

  describe('getClient — throw contract', () => {
    it('returns client on success', async () => {
      const client = { id: 'c1', first_name: 'Alex' };
      mockApiRpcEnvelope.mockResolvedValueOnce({ success: true, data: client });

      const result = await service.getClient('c1');

      expect(result).toEqual(client);
    });

    it('throws "Client not found" on envelope success with null data', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({ success: true });

      await expect(service.getClient('c1')).rejects.toThrow('Client not found');
    });

    it('throws verb-prefixed message on PostgREST failure', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce(pgFailure('row not visible'));

      await expect(service.getClient('c1')).rejects.toThrow(
        'Failed to get client: row not visible'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle return contract (F1 — logIfPostgrestError observability)
  // ---------------------------------------------------------------------------

  describe('registerClient — return contract + F1 observability', () => {
    it('returns success envelope on success', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: true,
        client_id: 'c1',
        client: { id: 'c1' },
      });

      const result = await service.registerClient({
        client_data: { first_name: 'Alex' },
      } as never);

      expect(result.success).toBe(true);
      expect(result.client_id).toBe('c1');
    });

    it('logs error AND returns {success: false} on PostgREST failure (F1)', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce(pgFailure('database timeout'));

      const result = await service.registerClient({ client_data: {} } as never);

      expect(result.success).toBe(false);
      expect(result.error).toBe('database timeout');
      expect(mockLogError).toHaveBeenCalledWith('Failed to register client', {
        error: 'database timeout',
      });
    });

    it('does NOT log on handler-driven envelope failure (F1 — only fires on PostgREST)', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'Duplicate client_data hash',
      });

      const result = await service.registerClient({ client_data: {} } as never);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Duplicate client_data hash');
      expect(mockLogError).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // updateClient — refetch fallback
  // ---------------------------------------------------------------------------

  describe('updateClient — refetch fallback', () => {
    it('returns the RPC-provided client when present (no refetch)', async () => {
      const client = { id: 'c1', first_name: 'Alex (updated)' };
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: true,
        client_id: 'c1',
        client,
      });

      const result = await service.updateClient('c1', { changes: { first_name: 'Alex' } } as never);

      expect(result.success).toBe(true);
      expect(result.client).toEqual(client);
      // No refetch: only the original RPC call
      expect(mockApiRpcEnvelope).toHaveBeenCalledTimes(1);
    });

    it('refetches via getClient when RPC succeeds without client', async () => {
      // First call: update returns success but no client
      mockApiRpcEnvelope.mockResolvedValueOnce({ success: true, client_id: 'c1' });
      // Second call: getClient refetch returns the client
      const refetched = { id: 'c1', first_name: 'Alex' };
      mockApiRpcEnvelope.mockResolvedValueOnce({ success: true, data: refetched });

      const result = await service.updateClient('c1', { changes: { first_name: 'Alex' } } as never);

      expect(result.success).toBe(true);
      expect(result.client).toEqual(refetched);
      expect(mockApiRpcEnvelope).toHaveBeenCalledTimes(2);
      expect(mockApiRpcEnvelope.mock.calls[1][0]).toBe('get_client');
    });

    it('logs warning and continues if refetch fails', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({ success: true, client_id: 'c1' });
      mockApiRpcEnvelope.mockResolvedValueOnce(pgFailure('refetch failed'));

      const result = await service.updateClient('c1', { changes: {} } as never);

      expect(result.success).toBe(true);
      expect(result.client_id).toBe('c1');
      expect(result.client).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Representative mutation — addClientPhone (envelope spread → typed result)
  // ---------------------------------------------------------------------------

  describe('addClientPhone — mutation envelope contract', () => {
    it('returns envelope spread on success (Omit<ResultType, success> pattern — F2)', async () => {
      const phone = { id: 'p1', phone_number: '+15551234567' };
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: true,
        phone_id: 'p1',
        phone,
      });

      const result = await service.addClientPhone('c1', {
        phone_number: '+15551234567',
      } as never);

      expect(result.success).toBe(true);
      expect(result.phone_id).toBe('p1');
      expect(result.phone).toEqual(phone);
    });

    it('returns {success: false, error} on envelope failure without throwing', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'Phone number invalid',
      });

      const result = await service.addClientPhone('c1', { phone_number: 'bad' } as never);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Phone number invalid');
      // Phone mutations do NOT call logIfPostgrestError (only lifecycle methods do per
      // pre-migration contract — F1 scope was the 4 lifecycle methods).
      expect(mockLogError).not.toHaveBeenCalled();
    });
  });
});
