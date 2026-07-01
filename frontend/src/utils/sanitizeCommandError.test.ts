import { describe, it, expect } from 'vitest';
import { sanitizeCommandError, DEFAULT_COMMAND_ERROR } from './sanitizeCommandError';

describe('sanitizeCommandError', () => {
  it('passes through a friendly, user-safe message unchanged', () => {
    const r = sanitizeCommandError('User is already a member of this organization');
    expect(r.display).toBe('User is already a member of this organization');
    expect(r.raw).toBe('User is already a member of this organization');
  });

  it('masks the "Event processing failed:" handler-internal prefix', () => {
    const raw =
      'Event processing failed: duplicate key value violates unique constraint "users_email_key"';
    const r = sanitizeCommandError(raw, 'Could not save. Please try again.');
    expect(r.display).toBe('Could not save. Please try again.');
    expect(r.raw).toBe(raw); // raw preserved for log.warn
  });

  it('masks Postgres SQLSTATE-style codes', () => {
    expect(sanitizeCommandError('violation P9002 at api.modify_user_roles').display).toBe(
      DEFAULT_COMMAND_ERROR
    );
  });

  it('masks strings that echo ERRCODE', () => {
    expect(sanitizeCommandError('USING ERRCODE = P0001').display).toBe(DEFAULT_COMMAND_ERROR);
  });

  it('uses the operation-specific fallback when provided', () => {
    const r = sanitizeCommandError('Event processing failed: x', 'Custom fallback');
    expect(r.display).toBe('Custom fallback');
  });

  it('falls back on an empty / null / undefined error', () => {
    expect(sanitizeCommandError('').display).toBe(DEFAULT_COMMAND_ERROR);
    expect(sanitizeCommandError(null).display).toBe(DEFAULT_COMMAND_ERROR);
    expect(sanitizeCommandError(undefined).display).toBe(DEFAULT_COMMAND_ERROR);
    expect(sanitizeCommandError(null).raw).toBe('');
  });

  it('reads .message from an Error instance', () => {
    const r = sanitizeCommandError(new Error('Network request failed'));
    expect(r.display).toBe('Network request failed');
    expect(r.raw).toBe('Network request failed');
  });

  it('never interpolates the raw constraint name into display', () => {
    const raw = 'Event processing failed: constraint "user_roles_projection_pkey"';
    const r = sanitizeCommandError(raw);
    expect(r.display).not.toContain('user_roles_projection_pkey');
    expect(r.display).toBe(DEFAULT_COMMAND_ERROR);
  });
});
