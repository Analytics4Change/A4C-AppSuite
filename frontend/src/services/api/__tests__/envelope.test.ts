/**
 * unwrapApiEnvelope — boundary masking + field-preservation tests
 *
 * Addresses architect review NT-3 on PR #56: the `count` field on
 * EnvelopeErrorDetails was added to preserve the real-world contract for
 * blocking-dependency errors (HAS_USERS / HAS_ROLES → cannot-delete dialog
 * at OrganizationUnitsManagePage.tsx:562). Without a test, PR-B/PR-C could
 * re-strip the field unintentionally.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PostgrestSingleResponse } from '@supabase/supabase-js';
import { unwrapApiEnvelope } from '../envelope';

// Stub maskPii to be identity so tests assert on shape, not masking behavior.
vi.mock('@/utils/maskPii', () => ({
  maskPii: (s: string) => s,
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
