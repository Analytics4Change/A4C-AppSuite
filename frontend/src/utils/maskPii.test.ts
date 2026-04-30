import { describe, it, expect } from 'vitest';
import { maskPii } from './maskPii';

describe('maskPii', () => {
  describe('canonical PG_EXCEPTION_DETAIL shapes', () => {
    it('masks Key (email)=(value) preserving column name', () => {
      const input =
        'Event processing failed: duplicate key value - Key (email)=(other-user@acme.com) already exists.';
      const out = maskPii(input);
      expect(out).toContain('Event processing failed: '); // prefix preserved
      expect(out).toContain('Key (email)=(<redacted>)');
      expect(out).not.toContain('other-user@acme.com');
      expect(out).not.toContain('acme.com');
    });

    it('masks phone number in Key (phone)=(value)', () => {
      const out = maskPii('Key (phone)=(+15551234567) already exists.');
      expect(out).toBe('Key (phone)=(<redacted>) already exists.');
      expect(out).not.toContain('5551234567');
    });

    it('masks multi-column key including names', () => {
      const out = maskPii('Key (last_name, first_name)=(Smith, John) already exists.');
      expect(out).toBe('Key (last_name, first_name)=(<redacted>) already exists.');
      expect(out).not.toContain('Smith');
      expect(out).not.toContain('John');
    });

    it('masks DOB+name composite key (HIPAA identifier collision)', () => {
      const out = maskPii('Key (date_of_birth, last_name)=(1985-06-12, Smith) already exists.');
      expect(out).toBe('Key (date_of_birth, last_name)=(<redacted>) already exists.');
      expect(out).not.toContain('1985-06-12');
      expect(out).not.toContain('Smith');
    });

    it('masks Failing row contains (...) shape', () => {
      const input =
        'DETAIL: Failing row contains (550e8400-e29b-41d4-a716-446655440000, john@x.com, John, Smith, 1985-06-12, null).';
      const out = maskPii(input);
      expect(out).toContain('Failing row contains (<redacted>)');
      expect(out).not.toContain('john@x.com');
      expect(out).not.toContain('Smith');
      expect(out).not.toContain('1985-06-12');
    });

    it('masks UUID + email inside structural shape (single replacement wins)', () => {
      const out = maskPii(
        'Key (organization_id, email)=(550e8400-e29b-41d4-a716-446655440000, other@acme.com) already exists.'
      );
      // Structural strip subsumes inner UUID/email match.
      expect(out).toBe('Key (organization_id, email)=(<redacted>) already exists.');
      expect(out).not.toContain('550e8400');
      expect(out).not.toContain('other@acme.com');
    });
  });

  describe('free-form belt-and-braces', () => {
    it('masks free-form UUID outside structural shape', () => {
      const out = maskPii('User 550e8400-e29b-41d4-a716-446655440000 not found');
      expect(out).toBe('User <uuid> not found');
    });

    it('masks free-form email outside structural shape', () => {
      const out = maskPii('No invitation found for x@y.com');
      expect(out).toBe('No invitation found for <email>');
    });

    it('masks UPPER-CASE UUID (case-insensitive)', () => {
      const out = maskPii('User A1B2C3D4-E5F6-7890-ABCD-EF1234567890 not found');
      expect(out).toBe('User <uuid> not found');
    });

    it('masks multiple UUIDs and emails in one string', () => {
      const out = maskPii(
        'Conflict between 550e8400-e29b-41d4-a716-446655440000 and a@b.com vs 660e8400-e29b-41d4-a716-446655440000 and c@d.com'
      );
      expect(out).toBe('Conflict between <uuid> and <email> vs <uuid> and <email>');
    });
  });

  describe('non-PII passthrough', () => {
    it('preserves non-PII text verbatim', () => {
      const out = maskPii('duplicate key value violates unique constraint "users_email_key"');
      expect(out).toBe('duplicate key value violates unique constraint "users_email_key"');
    });

    it('preserves the "Event processing failed: " prefix (ADR Decision 5 contract)', () => {
      const out = maskPii('Event processing failed: handler raised exception');
      expect(out).toContain('Event processing failed: ');
      expect(out).toBe('Event processing failed: handler raised exception');
    });
  });

  describe('edge cases', () => {
    it('returns empty string for null', () => {
      expect(maskPii(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(maskPii(undefined)).toBe('');
    });

    it('returns empty string for empty string', () => {
      expect(maskPii('')).toBe('');
    });

    it('is idempotent (already-masked input returns unchanged)', () => {
      const masked = 'Key (email)=(<redacted>) and id=<uuid>';
      expect(maskPii(masked)).toBe(masked);
    });

    it('idempotent on doubly-masked structural shape', () => {
      const once = maskPii('Key (email)=(other-user@acme.com) already exists.');
      const twice = maskPii(once);
      expect(twice).toBe(once);
    });
  });
});
