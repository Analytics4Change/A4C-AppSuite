/**
 * Email-normalization behaviour in organization-validation.
 *
 * ## What this is guarding
 *
 * Two defects fixed in PR D, both on the form that heads the org-bootstrap
 * chain — the one path that normalized email at zero of its five layers:
 *
 * 1. `ValidationRules.email` checked `value.trim()` for emptiness but then
 *    regex-tested the RAW `value`. Because `EMAIL_REGEX` uses `[^\s@]+`, a
 *    padded address was rejected as "Invalid email format" — while its sibling
 *    `validateEmail()` in `types/user.types.ts` trims first and accepts it. Two
 *    validators, two answers, same address.
 *
 * 2. The provider-admin email/confirmation compare was case-sensitive and
 *    untrimmed, so typing `Bob@x.com` and `bob@x.com` produced "Email addresses
 *    must match" for two addresses that are identical to every consumer — the
 *    database now stores `btrim(lower(email))`.
 */

import { describe, it, expect } from 'vitest';
import { ValidationRules, validateOrganizationForm } from '../organization-validation';

describe('ValidationRules.email', () => {
  it('accepts a well-formed address', () => {
    expect(ValidationRules.email('bob@example.com')).toBeNull();
  });

  it('accepts a whitespace-padded address (agrees with validateEmail)', () => {
    // Previously "Invalid email format": the emptiness check trimmed, the regex
    // test did not.
    expect(ValidationRules.email('  bob@example.com  ')).toBeNull();
  });

  it('still requires a value', () => {
    expect(ValidationRules.email('')).toBe('Email is required');
    expect(ValidationRules.email('   ')).toBe('Email is required');
  });

  it('still rejects a genuinely malformed address', () => {
    // Loosening for whitespace must not loosen the format check itself.
    expect(ValidationRules.email('not-an-email')).toBe('Invalid email format');
    expect(ValidationRules.email('a@b')).toBe('Invalid email format');
    expect(ValidationRules.email('a b@example.com')).toBe('Invalid email format');
  });
});

describe('provider admin email confirmation', () => {
  // `validateOrganizationForm` validates the whole form and dereferences every
  // nested section, so the fixture has to be structurally complete. Only the
  // providerAdminContact.emailConfirmation error is asserted on — the other
  // fields are free to be invalid.
  const emptyAddress = { street1: '', street2: '', city: '', state: '', zipCode: '' };
  const emptyPhone = { number: '', extension: '' };

  const base = (email: string, emailConfirmation: string) =>
    ({
      type: 'provider',
      name: 'Acme',
      displayName: 'Acme',
      timeZone: 'America/New_York',
      subdomain: 'acme',
      generalAddress: { ...emptyAddress },
      generalPhone: { ...emptyPhone },
      providerAdminAddress: { ...emptyAddress },
      providerAdminPhone: { ...emptyPhone },
      billingAddress: { ...emptyAddress },
      billingPhone: { ...emptyPhone },
      billingContact: { firstName: '', lastName: '', email: '' },
      providerAdminContact: {
        firstName: 'Bob',
        lastName: 'Smith',
        email,
        emailConfirmation,
        type: 'provider_admin',
      },
    }) as unknown as Parameters<typeof validateOrganizationForm>[0];

  const confirmationError = (email: string, confirmation: string) =>
    validateOrganizationForm(base(email, confirmation)).errors.find(
      (e) => e.field === 'providerAdminContact.emailConfirmation'
    );

  it('accepts an exact match', () => {
    expect(confirmationError('bob@example.com', 'bob@example.com')).toBeUndefined();
  });

  it('accepts a case-only difference', () => {
    // The bug: these are the same address everywhere downstream.
    expect(confirmationError('Bob@Example.com', 'bob@example.com')).toBeUndefined();
  });

  it('accepts a whitespace-only difference', () => {
    expect(confirmationError('bob@example.com', '  bob@example.com  ')).toBeUndefined();
  });

  it('accepts a combined case + whitespace difference', () => {
    expect(confirmationError('  BOB@Example.COM ', 'bob@example.com')).toBeUndefined();
  });

  it('STILL rejects a genuine mismatch', () => {
    // The whole point of the field. Normalizing must not defeat it.
    const err = confirmationError('bob@example.com', 'robert@example.com');
    expect(err).toBeDefined();
    expect(err?.message).toBe('Email addresses must match');
  });

  it('still rejects a mismatch that differs only after the @', () => {
    expect(confirmationError('bob@example.com', 'bob@exampel.com')).toBeDefined();
  });
});
