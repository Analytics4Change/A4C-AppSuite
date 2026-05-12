/**
 * SupabaseOrganizationCommandService — PR-D observability backfill test
 *
 * Verifies `logIfPostgrestError` fires at the SDK boundary on PostgREST 4xx/5xx
 * failures for all 4 return-contract methods (update, deactivate, reactivate,
 * delete organization), and does NOT fire on handler-driven envelope failures.
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

// WorkflowClientFactory is invoked from deleteOrganization on success; not in scope here.
vi.mock('@/services/workflow/WorkflowClientFactory', () => ({
  WorkflowClientFactory: {
    create: () => ({ startDeletionWorkflow: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { SupabaseOrganizationCommandService } from '../SupabaseOrganizationCommandService';

function pgFailure(msg: string) {
  return {
    success: false as const,
    error: msg,
    postgrestError: { code: '42501', message: msg, details: '', hint: '' },
  };
}

describe('SupabaseOrganizationCommandService — logIfPostgrestError integration (PR-D)', () => {
  let service: SupabaseOrganizationCommandService;

  beforeEach(() => {
    mockApiRpcEnvelope.mockReset();
    mockLogError.mockReset();
    service = new SupabaseOrganizationCommandService();
  });

  it('updateOrganization emits log.error on PostgREST failure with correct verb', async () => {
    mockApiRpcEnvelope.mockResolvedValueOnce(pgFailure('permission denied'));

    const result = await service.updateOrganization('o1', {} as never);

    expect(result.success).toBe(false);
    expect(mockLogError).toHaveBeenCalledWith('Failed to update organization', {
      error: 'permission denied',
    });
  });

  it('deactivateOrganization, reactivateOrganization, deleteOrganization all use correct verbs', async () => {
    const cases: Array<[() => Promise<unknown>, string]> = [
      [() => service.deactivateOrganization('o1'), 'deactivate organization'],
      [() => service.reactivateOrganization('o1'), 'reactivate organization'],
      [() => service.deleteOrganization('o1'), 'delete organization'],
    ];

    for (const [call, expectedVerb] of cases) {
      mockLogError.mockReset();
      mockApiRpcEnvelope.mockResolvedValueOnce(pgFailure('db down'));
      await call();
      expect(mockLogError).toHaveBeenCalledWith(`Failed to ${expectedVerb}`, { error: 'db down' });
    }
  });

  it('does NOT emit log.error on handler-driven envelope failure', async () => {
    mockApiRpcEnvelope.mockResolvedValueOnce({
      success: false,
      error: 'Validation failed',
    });

    await service.updateOrganization('o1', {} as never);

    expect(mockLogError).not.toHaveBeenCalled();
  });
});
