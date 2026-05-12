/**
 * SupabaseRoleService — error mapping + count round-trip tests
 *
 * Addresses architect review NT-2b on PR #56: `mapErrorDetails` is the only
 * place `count` (preserved via envelope.ts NT-3 fix) enters the service-level
 * result. End-to-end test locks the count-preservation chain before PR-B/PR-C
 * replicate the mapping pattern across more services (e.g. OrganizationUnits
 * has structurally identical mapErrorDetails with HAS_ROLES + count).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockApiRpcEnvelope, mockApiRpc, mockLogError } = vi.hoisted(() => ({
  mockApiRpcEnvelope: vi.fn(),
  mockApiRpc: vi.fn(),
  mockLogError: vi.fn(),
}));

vi.mock('@/services/auth/supabase.service', () => ({
  supabaseService: { apiRpcEnvelope: mockApiRpcEnvelope, apiRpc: mockApiRpc },
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

import { SupabaseRoleService } from '../SupabaseRoleService';

describe('SupabaseRoleService', () => {
  let service: SupabaseRoleService;

  beforeEach(() => {
    mockApiRpcEnvelope.mockReset();
    mockApiRpc.mockReset();
    mockLogError.mockReset();
    service = new SupabaseRoleService();
  });

  // ---------------------------------------------------------------------------
  // PR-D observability backfill — logIfPostgrestError on return-contract methods
  // ---------------------------------------------------------------------------

  describe('logIfPostgrestError integration (PR-D backfill)', () => {
    it('updateRole emits log.error on PostgREST failure with verb-prefixed message', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'permission denied',
        postgrestError: { code: '42501', message: 'permission denied', details: '', hint: '' },
      });

      await service.updateRole({ id: 'r1', name: 'r' } as never);

      expect(mockLogError).toHaveBeenCalledWith('Failed to update role', {
        error: 'permission denied',
      });
    });

    it('deleteRole emits log.error with the right verb', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'db timeout',
        postgrestError: { code: '500', message: 'db timeout', details: '', hint: '' },
      });

      await service.deleteRole('r1');

      expect(mockLogError).toHaveBeenCalledWith('Failed to delete role', { error: 'db timeout' });
    });

    it('does NOT emit log.error on handler-driven failure (HAS_USERS envelope)', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'Cannot delete',
        errorDetails: { code: 'HAS_USERS', count: 5, message: 'm' },
      });

      await service.deleteRole('r1');

      expect(mockLogError).not.toHaveBeenCalled();
    });
  });

  describe('deleteRole — count round-trip (NT-2b regression guard)', () => {
    it('preserves errorDetails.count for HAS_USERS blocking error', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'Cannot delete: role has users assigned',
        errorDetails: {
          code: 'HAS_USERS',
          count: 5,
          message: 'Cannot delete: 5 users assigned',
        },
      });

      const result = await service.deleteRole('role-1');

      expect(result.success).toBe(false);
      expect(result.errorDetails?.code).toBe('HAS_USERS');
      expect(result.errorDetails?.count).toBe(5);
      expect(result.errorDetails?.message).toBe('Cannot delete: 5 users assigned');
    });

    it('preserves count = 0 (falsy but defined)', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'err',
        errorDetails: { code: 'HAS_USERS', count: 0, message: 'm' },
      });

      const result = await service.deleteRole('role-1');
      expect(result.errorDetails?.count).toBe(0);
    });

    it('handles missing errorDetails (undefined mapping)', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({ success: false, error: 'bare error' });

      const result = await service.deleteRole('role-1');
      expect(result.success).toBe(false);
      expect(result.error).toBe('bare error');
      expect(result.errorDetails).toBeUndefined();
    });
  });

  describe('mapErrorDetails — code translation', () => {
    it('maps known error codes', async () => {
      const cases: Array<[string, string]> = [
        ['NOT_FOUND', 'NOT_FOUND'],
        ['ALREADY_ACTIVE', 'ALREADY_ACTIVE'],
        ['ALREADY_INACTIVE', 'ALREADY_INACTIVE'],
        ['HAS_USERS', 'HAS_USERS'],
        ['SUBSET_ONLY_VIOLATION', 'SUBSET_ONLY_VIOLATION'],
        ['PERMISSION_DENIED', 'PERMISSION_DENIED'],
      ];

      for (const [input, expected] of cases) {
        mockApiRpcEnvelope.mockResolvedValueOnce({
          success: false,
          error: 'e',
          errorDetails: { code: input, message: 'm' },
        });
        const result = await service.deleteRole('r1');
        expect(result.errorDetails?.code).toBe(expected);
      }
    });

    it('falls back to UNKNOWN for unrecognized code', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'e',
        errorDetails: { code: 'SOMETHING_NEW', message: 'm' },
      });

      const result = await service.deleteRole('r1');
      expect(result.errorDetails?.code).toBe('UNKNOWN');
    });
  });

  describe('PostgREST-level failure path (NT-1 — DIAG_RPC_ERROR signal)', () => {
    it('createRole returns UNKNOWN errorDetails when env.postgrestError is set', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: false,
        error: 'permission denied',
        postgrestError: { code: '42501', message: 'permission denied', details: '', hint: '' },
      });

      const result = await service.createRole({
        name: 'r',
        description: 'd',
        permissionIds: [],
      } as never);

      expect(result.success).toBe(false);
      expect(result.error).toBe('permission denied');
      expect(result.errorDetails?.code).toBe('UNKNOWN');
    });
  });

  describe('read-path throw contract', () => {
    it('getRoles throws on apiRpc error', async () => {
      mockApiRpc.mockResolvedValueOnce({
        data: null,
        error: { code: '500', message: 'db down', details: '', hint: '' },
      });

      await expect(service.getRoles()).rejects.toThrow('Failed to fetch roles: db down');
    });

    it('listUsersForBulkAssignment throws on apiRpc error', async () => {
      mockApiRpc.mockResolvedValueOnce({
        data: null,
        error: { code: '500', message: 'db down', details: '', hint: '' },
      });

      await expect(
        service.listUsersForBulkAssignment({
          roleId: 'r1',
          scopePath: 'org_root',
          limit: 10,
          offset: 0,
        } as never)
      ).rejects.toThrow('Failed to list users: db down');
    });
  });

  describe('success path mapping', () => {
    it('createRole maps camelCase RPC fields to camelCase Role with permissionCount', async () => {
      mockApiRpcEnvelope.mockResolvedValueOnce({
        success: true,
        role: {
          id: 'r1',
          name: 'Provider Admin',
          description: 'd',
          organizationId: 'o1',
          orgHierarchyScope: null,
          isActive: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      });

      const result = await service.createRole({
        name: 'Provider Admin',
        description: 'd',
        permissionIds: ['p1', 'p2', 'p3'],
      } as never);

      expect(result.success).toBe(true);
      expect(result.role?.id).toBe('r1');
      expect(result.role?.permissionCount).toBe(3); // from request, not from RPC
      expect(result.role?.userCount).toBe(0);
      expect(result.role?.createdAt).toBeInstanceOf(Date);
    });
  });
});
