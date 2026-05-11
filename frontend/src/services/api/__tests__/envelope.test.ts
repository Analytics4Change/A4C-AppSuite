/**
 * unwrapApiEnvelope — boundary masking + field-preservation tests
 *
 * Addresses architect review NT-3 on PR #56: the `count` field on
 * EnvelopeErrorDetails was added to preserve the real-world contract for
 * blocking-dependency errors (HAS_USERS / HAS_ROLES → cannot-delete dialog
 * at OrganizationUnitsManagePage.tsx:562). Without a test, PR-B/PR-C could
 * re-strip the field unintentionally.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PostgrestSingleResponse } from '@supabase/supabase-js';
import type { ApiEnvelope } from '../envelope';
import { unwrapApiEnvelope, throwIfPostgrestError } from '../envelope';

// Stub maskPii to be identity so tests assert on shape, not masking behavior.
vi.mock('@/utils/maskPii', () => ({
  maskPii: (s: string) => s,
}));

// Stub Logger so tests can assert on the service-boundary error-emission contract
// (architect-approved 2026-05-11). `mockLogError` is the only handle we need —
// the helper only ever calls `log.error`.
const { mockLogError } = vi.hoisted(() => ({ mockLogError: vi.fn() }));
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

function rpcOk<T>(data: T): PostgrestSingleResponse<unknown> {
  return {
    data: data as unknown,
    error: null,
    count: null,
    status: 200,
    statusText: 'OK',
  } as PostgrestSingleResponse<unknown>;
}

describe('unwrapApiEnvelope', () => {
  describe('count preservation (NT-3 — regression guard)', () => {
    it('preserves errorDetails.count on envelope failure (HAS_USERS path)', () => {
      const result = unwrapApiEnvelope(
        rpcOk({
          success: false,
          error: 'Role has users assigned',
          errorDetails: {
            code: 'HAS_USERS',
            count: 5,
            message: 'Cannot delete: 5 users assigned',
          },
        })
      );

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.errorDetails?.code).toBe('HAS_USERS');
      expect(result.errorDetails?.count).toBe(5);
      expect(result.errorDetails?.message).toBe('Cannot delete: 5 users assigned');
    });

    it('preserves errorDetails.count = 0 (falsy but defined)', () => {
      const result = unwrapApiEnvelope(
        rpcOk({
          success: false,
          error: 'No blocking deps',
          errorDetails: { code: 'NONE', count: 0, message: 'm' },
        })
      );
      if (result.success) return;
      expect(result.errorDetails?.count).toBe(0);
    });

    it('leaves errorDetails.count undefined when RPC omits it', () => {
      const result = unwrapApiEnvelope(
        rpcOk({
          success: false,
          error: 'Validation failed',
          errorDetails: { code: 'VALIDATION_ERROR', message: 'm' },
        })
      );
      if (result.success) return;
      expect(result.errorDetails?.count).toBeUndefined();
    });
  });

  describe('success-path intersection', () => {
    it('spreads success-path fields onto {success: true}', () => {
      const result = unwrapApiEnvelope<{ role: { id: string }; event_id: string }>(
        rpcOk({ success: true, role: { id: 'r1' }, event_id: 'e1' })
      );
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.role.id).toBe('r1');
      expect(result.event_id).toBe('e1');
    });
  });

  describe('PostgREST-level failure', () => {
    it('surfaces postgrestError on wrapper-level error', () => {
      const result = unwrapApiEnvelope({
        data: null,
        error: { code: '42501', message: 'permission denied', details: '', hint: '' },
        count: null,
        status: 403,
        statusText: 'Forbidden',
      } as unknown as PostgrestSingleResponse<unknown>);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.postgrestError?.code).toBe('42501');
      expect(result.error).toBe('permission denied');
    });
  });
});

describe('throwIfPostgrestError', () => {
  beforeEach(() => {
    mockLogError.mockReset();
  });

  it('throws "Failed to <verb>: <error>" on PostgREST-shape failure', () => {
    const env: ApiEnvelope<Record<string, unknown>> = {
      success: false,
      error: 'permission denied',
      postgrestError: { code: '42501', message: 'permission denied', details: '', hint: '' },
    };

    expect(() => throwIfPostgrestError(env, 'create field')).toThrow(
      'Failed to create field: permission denied'
    );
  });

  it('does NOT throw on handler-driven envelope failure (no postgrestError)', () => {
    const env: ApiEnvelope<Record<string, unknown>> = {
      success: false,
      error: 'Field key already exists',
      errorDetails: { code: 'DUPLICATE_KEY', message: 'm' },
    };

    expect(() => throwIfPostgrestError(env, 'create field')).not.toThrow();
  });

  it('does NOT throw on success envelope', () => {
    const env: ApiEnvelope<{ field_id: string }> = {
      success: true,
      field_id: 'f1',
    };

    expect(() => throwIfPostgrestError(env, 'create field')).not.toThrow();
  });

  it('passes through the verb verbatim in the thrown message', () => {
    const env: ApiEnvelope<Record<string, unknown>> = {
      success: false,
      error: 'boom',
      postgrestError: { code: '500', message: 'boom', details: '', hint: '' },
    };

    expect(() => throwIfPostgrestError(env, 'deactivate category')).toThrow(
      'Failed to deactivate category: boom'
    );
  });

  describe('log emission contract (architect-approved 2026-05-11)', () => {
    it('calls log.error exactly once on PostgREST-shape failure', () => {
      const env: ApiEnvelope<Record<string, unknown>> = {
        success: false,
        error: 'permission denied',
        postgrestError: { code: '42501', message: 'permission denied', details: '', hint: '' },
      };

      expect(() => throwIfPostgrestError(env, 'create field')).toThrow();

      expect(mockLogError).toHaveBeenCalledTimes(1);
      expect(mockLogError).toHaveBeenCalledWith('Failed to create field', {
        error: 'permission denied',
      });
    });

    it('does NOT call log.error on handler-driven envelope failure', () => {
      const env: ApiEnvelope<Record<string, unknown>> = {
        success: false,
        error: 'Field key already exists',
        errorDetails: { code: 'DUPLICATE_KEY', message: 'm' },
      };

      expect(() => throwIfPostgrestError(env, 'create field')).not.toThrow();
      expect(mockLogError).not.toHaveBeenCalled();
    });

    it('does NOT call log.error on success envelope', () => {
      const env: ApiEnvelope<{ field_id: string }> = {
        success: true,
        field_id: 'f1',
      };

      expect(() => throwIfPostgrestError(env, 'create field')).not.toThrow();
      expect(mockLogError).not.toHaveBeenCalled();
    });

    it('log.error count exactly tracks PostgREST-failure count across a mixed batch', () => {
      // Three PostgREST failures interleaved with two success and one
      // handler-driven failure; expect log.error to fire exactly 3×.
      const pgFail = (): ApiEnvelope<Record<string, unknown>> => ({
        success: false,
        error: 'permission denied',
        postgrestError: { code: '42501', message: 'permission denied', details: '', hint: '' },
      });
      const handlerFail: ApiEnvelope<Record<string, unknown>> = {
        success: false,
        error: 'business rule',
        errorDetails: { code: 'X', message: 'm' },
      };
      const successEnv: ApiEnvelope<Record<string, unknown>> = { success: true };

      try {
        throwIfPostgrestError(pgFail(), 'a');
      } catch {
        /* expected */
      }
      throwIfPostgrestError(successEnv, 'b');
      try {
        throwIfPostgrestError(pgFail(), 'c');
      } catch {
        /* expected */
      }
      throwIfPostgrestError(handlerFail, 'd');
      try {
        throwIfPostgrestError(pgFail(), 'e');
      } catch {
        /* expected */
      }
      throwIfPostgrestError(successEnv, 'f');

      expect(mockLogError).toHaveBeenCalledTimes(3);
      expect(mockLogError).toHaveBeenNthCalledWith(1, 'Failed to a', {
        error: 'permission denied',
      });
      expect(mockLogError).toHaveBeenNthCalledWith(2, 'Failed to c', {
        error: 'permission denied',
      });
      expect(mockLogError).toHaveBeenNthCalledWith(3, 'Failed to e', {
        error: 'permission denied',
      });
    });
  });
});
