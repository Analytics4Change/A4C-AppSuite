/**
 * SupabaseOrganizationUnitService — PR-D observability backfill test
 *
 * Verifies `logIfPostgrestError` fires on PostgREST 4xx/5xx for all 5
 * envelope return-contract methods (create, update, deactivate, reactivate,
 * delete unit), and does NOT fire on handler-driven envelope failures (e.g.
 * HAS_ROLES blocking-dependency error).
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

import { SupabaseOrganizationUnitService } from '../SupabaseOrganizationUnitService';

function pgFailure(msg: string) {
  return {
    success: false as const,
    error: msg,
    postgrestError: { code: '42501', message: msg, details: '', hint: '' },
  };
}

describe('SupabaseOrganizationUnitService — logIfPostgrestError integration (PR-D)', () => {
  let service: SupabaseOrganizationUnitService;

  beforeEach(() => {
    mockApiRpcEnvelope.mockReset();
    mockApiRpc.mockReset();
    mockLogError.mockReset();
    service = new SupabaseOrganizationUnitService();
  });

  it('all 5 envelope methods emit log.error with correct verbs on PostgREST failure', async () => {
    const cases: Array<[() => Promise<unknown>, string]> = [
      [
        () => service.createUnit({ parentId: 'p1', name: 'n', displayName: 'n' } as never),
        'create organization unit',
      ],
      [() => service.updateUnit({ id: 'u1' } as never), 'update organization unit'],
      [() => service.deactivateUnit('u1'), 'deactivate organization unit'],
      [() => service.reactivateUnit('u1'), 'reactivate organization unit'],
      [() => service.deleteUnit('u1'), 'delete organization unit'],
    ];

    for (const [call, expectedVerb] of cases) {
      mockLogError.mockReset();
      mockApiRpcEnvelope.mockResolvedValueOnce(pgFailure('permission denied'));
      await call();
      expect(mockLogError).toHaveBeenCalledWith(`Failed to ${expectedVerb}`, {
        error: 'permission denied',
      });
    }
  });

  it('does NOT emit log.error on HAS_ROLES handler-driven failure (blocking-dependency)', async () => {
    mockApiRpcEnvelope.mockResolvedValueOnce({
      success: false,
      error: 'Cannot delete: 5 roles assigned',
      errorDetails: { code: 'HAS_ROLES', count: 5, message: 'Cannot delete: 5 roles assigned' },
    });

    const result = await service.deleteUnit('u1');

    expect(result.success).toBe(false);
    expect(result.errorDetails?.code).toBe('HAS_ROLES');
    expect(result.errorDetails?.count).toBe(5);
    expect(mockLogError).not.toHaveBeenCalled();
  });
});
