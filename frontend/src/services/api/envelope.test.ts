import { describe, it, expect } from 'vitest';
import type { PostgrestError, PostgrestSingleResponse } from '@supabase/supabase-js';
import { unwrapApiEnvelope, maskPostgrestError } from './envelope';

function pgError(overrides: Partial<PostgrestError> = {}): PostgrestError {
  return {
    name: 'PostgrestError',
    code: '42501',
    message: 'permission denied',
    details: '',
    hint: '',
    ...overrides,
  } as PostgrestError;
}

function rpcResult<T>(
  data: T | null,
  error: PostgrestError | null = null
): PostgrestSingleResponse<T> {
  return {
    data,
    error,
    count: null,
    status: error ? 401 : 200,
    statusText: error ? 'Unauthorized' : 'OK',
  } as PostgrestSingleResponse<T>;
}

describe('maskPostgrestError', () => {
  it('masks message + details + hint', () => {
    const err = pgError({
      message: 'duplicate key - Key (email)=(a@b.com) already exists',
      details: 'conflict on row 550e8400-e29b-41d4-a716-446655440000',
      hint: 'try x@y.com instead',
    });
    const out = maskPostgrestError(err);
    expect(out.message).toContain('Key (email)=(<redacted>)');
    expect(out.message).not.toContain('a@b.com');
    expect(out.details).toContain('<uuid>');
    expect(out.details).not.toContain('550e8400');
    expect(out.hint).toContain('<email>');
    expect(out.hint).not.toContain('x@y.com');
    expect(out.code).toBe('42501');
  });

  it('preserves undefined for empty details/hint', () => {
    const err = pgError({ message: 'plain', details: '', hint: '' });
    const out = maskPostgrestError(err);
    expect(out.details).toBeUndefined();
    expect(out.hint).toBeUndefined();
  });
});

describe('unwrapApiEnvelope', () => {
  describe('PostgREST error path', () => {
    it('returns ApiEnvelopeFailure with masked postgrestError', () => {
      const env = unwrapApiEnvelope(
        rpcResult(
          null,
          pgError({ message: 'denied for user 550e8400-e29b-41d4-a716-446655440000' })
        )
      );
      expect(env.success).toBe(false);
      if (!env.success) {
        expect(env.error).toContain('<uuid>');
        expect(env.error).not.toContain('550e8400');
        expect(env.postgrestError?.code).toBe('42501');
        expect(env.postgrestError?.message).toContain('<uuid>');
      }
    });

    it('masks all three string fields on PostgrestError', () => {
      const env = unwrapApiEnvelope(
        rpcResult(
          null,
          pgError({
            message: 'Key (email)=(a@b.com) already exists',
            details: 'row 550e8400-e29b-41d4-a716-446655440000',
            hint: 'see x@y.com',
          })
        )
      );
      expect(env.success).toBe(false);
      if (!env.success) {
        expect(env.error).toContain('Key (email)=(<redacted>)');
        expect(env.postgrestError?.details).toContain('<uuid>');
        expect(env.postgrestError?.hint).toContain('<email>');
      }
    });
  });

  describe('Pattern A v2 envelope failure path', () => {
    it('masks data.error string', () => {
      const env = unwrapApiEnvelope(
        rpcResult({
          success: false,
          error: 'Event processing failed: Key (email)=(other-user@acme.com) already exists',
        })
      );
      expect(env.success).toBe(false);
      if (!env.success) {
        expect(env.error).toContain('Event processing failed: ');
        expect(env.error).toContain('Key (email)=(<redacted>)');
        expect(env.error).not.toContain('other-user@acme.com');
        expect(env.postgrestError).toBeUndefined();
      }
    });

    it('handles missing error string with fallback', () => {
      const env = unwrapApiEnvelope(rpcResult({ success: false }));
      expect(env.success).toBe(false);
      if (!env.success) {
        expect(env.error).toBe('Unknown error');
      }
    });
  });

  describe('success path (intersection-type spread)', () => {
    it('spreads flat fields onto envelope', () => {
      type Result = { user: { id: string; name: string }; event_id: string };
      const env = unwrapApiEnvelope<Result>(
        rpcResult({
          success: true,
          user: { id: 'u1', name: 'Alice' },
          event_id: 'e1',
        })
      );
      expect(env.success).toBe(true);
      if (env.success) {
        // Intersection-type contract: fields are flat on the envelope, not nested under .data
        expect(env.user).toEqual({ id: 'u1', name: 'Alice' });
        expect(env.event_id).toBe('e1');
      }
    });

    it('handles success with no extra fields', () => {
      const env = unwrapApiEnvelope(rpcResult({ success: true }));
      expect(env.success).toBe(true);
    });

    it('handles null data as success (defensive default)', () => {
      const env = unwrapApiEnvelope(rpcResult(null));
      expect(env.success).toBe(true);
    });
  });

  describe('masking-applied-once invariant', () => {
    it('does not double-mask already-masked text', () => {
      const env = unwrapApiEnvelope(
        rpcResult({
          success: false,
          error: 'Key (email)=(<redacted>) already exists',
        })
      );
      expect(env.success).toBe(false);
      if (!env.success) {
        expect(env.error).toBe('Key (email)=(<redacted>) already exists');
      }
    });
  });
});
