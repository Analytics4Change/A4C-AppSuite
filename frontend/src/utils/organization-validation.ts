/**
 * Organization Validation Utilities
 *
 * Validation rules and formatting utilities for organization management forms.
 * Provides consistent validation logic across create and edit workflows.
 *
 * Features:
 * - Field-level validation rules
 * - Form-level validation
 * - Phone number formatting
 * - Subdomain validation
 * - Email validation
 */

import type { OrganizationFormData } from '@/types/organization.types';

/**
 * Validation error structure
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

/**
 * Email validation regex
 * RFC 5322 compliant
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Subdomain validation regex
 * - Lowercase letters, numbers, hyphens only
 * - Must start with letter
 * - 3-63 characters
 */
const SUBDOMAIN_REGEX = /^[a-z][a-z0-9-]{2,62}$/;

/**
 * Phone number formatting regex
 * Strips all non-numeric characters
 */
const PHONE_STRIP_REGEX = /\D/g;

/**
 * Zip code validation regex
 * Supports 5-digit and 9-digit formats
 */
const ZIP_CODE_REGEX = /^\d{5}(-\d{4})?$/;

/**
 * Validation Rules
 *
 * Each rule returns null if valid, error message if invalid.
 */
export const ValidationRules = {
  /**
   * Validate required field
   */
  required: (value: string, fieldName: string): string | null => {
    return value.trim().length > 0 ? null : `${fieldName} is required`;
  },

  /**
   * Validate email format
   */
  email: (value: string): string | null => {
    if (!value.trim()) {
      return 'Email is required';
    }
    return EMAIL_REGEX.test(value) ? null : 'Invalid email format';
  },

  /**
   * Validate subdomain format
   */
  subdomain: (value: string): string | null => {
    if (!value.trim()) {
      return 'Subdomain is required';
    }

    if (!SUBDOMAIN_REGEX.test(value)) {
      return 'Subdomain must start with a letter and contain only lowercase letters, numbers, and hyphens (3-63 characters)';
    }

    // Reserved subdomains
    const reserved = ['admin', 'api', 'www', 'app', 'mail', 'ftp'];
    if (reserved.includes(value.toLowerCase())) {
      return 'This subdomain is reserved';
    }

    return null;
  },

  /**
   * Validate phone number format
   */
  phone: (value: string): string | null => {
    if (!value.trim()) {
      return 'Phone number is required';
    }

    const digits = value.replace(PHONE_STRIP_REGEX, '');

    if (digits.length !== 10) {
      return 'Phone number must be 10 digits';
    }

    return null;
  },

  /**
   * Validate zip code format
   */
  zipCode: (value: string): string | null => {
    if (!value.trim()) {
      return 'Zip code is required';
    }

    return ZIP_CODE_REGEX.test(value) ? null : 'Invalid zip code format';
  },

  /**
   * Validate minimum length
   */
  minLength: (value: string, min: number, fieldName: string): string | null => {
    return value.trim().length >= min
      ? null
      : `${fieldName} must be at least ${min} characters`;
  },

  /**
   * Validate maximum length
   */
  maxLength: (value: string, max: number, fieldName: string): string | null => {
    return value.trim().length <= max
      ? null
      : `${fieldName} must be no more than ${max} characters`;
  }
};

/**
 * Format phone number to (XXX) XXX-XXXX format
 *
 * @param value - Raw phone input
 * @returns Formatted phone number or original value if invalid
 */
export function formatPhone(value: string): string {
  // Strip all non-numeric characters
  const digits = value.replace(PHONE_STRIP_REGEX, '');

  // Return original if not 10 digits
  if (digits.length !== 10) {
    return value;
  }

  // Format as (XXX) XXX-XXXX
  return `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}`;
}

/**
 * Strip phone formatting to get raw digits
 *
 * @param value - Formatted phone number
 * @returns Raw 10-digit string
 */
export function stripPhoneFormatting(value: string): string {
  return value.replace(PHONE_STRIP_REGEX, '');
}

/**
 * Format subdomain to lowercase with hyphens
 *
 * @param value - Raw subdomain input
 * @returns Formatted subdomain
 */
export function formatSubdomain(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '') // Remove invalid characters
    .replace(/^[^a-z]+/, '') // Ensure starts with letter
    .substring(0, 63); // Limit to 63 characters
}

/**
 * Validate organization form data
 * Enhanced for Part B with 3-section structure
 *
 * @param data - Organization form data
 * @returns Validation result with errors
 */
export function validateOrganizationForm(
  data: OrganizationFormData
): ValidationResult {
  const errors: ValidationError[] = [];

  // Determine if subdomain is required and if billing section should be validated
  const isProvider = data.type === 'provider';
  const isSubdomainRequired =
    data.type === 'provider' || (data.type === 'provider_partner' && data.partnerType === 'var');

  // General Information (Organization-level)
  addError(errors, 'name', ValidationRules.required(data.name, 'Organization name'));
  addError(errors, 'displayName', ValidationRules.required(data.displayName, 'Display name'));
  addError(errors, 'timeZone', ValidationRules.required(data.timeZone, 'Time zone'));

  // Subdomain (conditionally required)
  if (isSubdomainRequired) {
    addError(errors, 'subdomain', ValidationRules.subdomain(data.subdomain));
  }

  // Partner type (required if provider_partner)
  if (data.type === 'provider_partner' && !data.partnerType) {
    addError(errors, 'partnerType', 'Partner type is required');
  }

  // General Information (Headquarters - NO contact, just address and phone)
  addError(
    errors,
    'generalAddress.street1',
    ValidationRules.required(data.generalAddress.street1, 'Headquarters street address')
  );
  addError(
    errors,
    'generalAddress.city',
    ValidationRules.required(data.generalAddress.city, 'Headquarters city')
  );
  addError(
    errors,
    'generalAddress.state',
    ValidationRules.required(data.generalAddress.state, 'Headquarters state')
  );
  addError(
    errors,
    'generalAddress.zipCode',
    ValidationRules.zipCode(data.generalAddress.zipCode)
  );
  addError(errors, 'generalPhone.number', ValidationRules.phone(data.generalPhone.number));

  // Billing Information (Only for providers)
  if (isProvider) {
    // Billing Contact
    addError(
      errors,
      'billingContact.firstName',
      ValidationRules.required(data.billingContact.firstName, 'Billing contact first name')
    );
    addError(
      errors,
      'billingContact.lastName',
      ValidationRules.required(data.billingContact.lastName, 'Billing contact last name')
    );
    addError(errors, 'billingContact.email', ValidationRules.email(data.billingContact.email));

    // Billing Address (if not using general)
    if (!data.useBillingGeneralAddress) {
      addError(
        errors,
        'billingAddress.street1',
        ValidationRules.required(data.billingAddress.street1, 'Billing street address')
      );
      addError(
        errors,
        'billingAddress.city',
        ValidationRules.required(data.billingAddress.city, 'Billing city')
      );
      addError(
        errors,
        'billingAddress.state',
        ValidationRules.required(data.billingAddress.state, 'Billing state')
      );
      addError(
        errors,
        'billingAddress.zipCode',
        ValidationRules.zipCode(data.billingAddress.zipCode)
      );
    }

    // Billing Phone (if not using general)
    if (!data.useBillingGeneralPhone) {
      addError(errors, 'billingPhone.number', ValidationRules.phone(data.billingPhone.number));
    }
  }

  // Provider Admin Information (Always required)
  addError(
    errors,
    'providerAdminContact.firstName',
    ValidationRules.required(data.providerAdminContact.firstName, 'Provider admin first name')
  );
  addError(
    errors,
    'providerAdminContact.lastName',
    ValidationRules.required(data.providerAdminContact.lastName, 'Provider admin last name')
  );
  addError(
    errors,
    'providerAdminContact.email',
    ValidationRules.email(data.providerAdminContact.email)
  );

  // Provider Admin Address (if not using general)
  if (!data.useProviderAdminGeneralAddress) {
    addError(
      errors,
      'providerAdminAddress.street1',
      ValidationRules.required(data.providerAdminAddress.street1, 'Provider admin street address')
    );
    addError(
      errors,
      'providerAdminAddress.city',
      ValidationRules.required(data.providerAdminAddress.city, 'Provider admin city')
    );
    addError(
      errors,
      'providerAdminAddress.state',
      ValidationRules.required(data.providerAdminAddress.state, 'Provider admin state')
    );
    addError(
      errors,
      'providerAdminAddress.zipCode',
      ValidationRules.zipCode(data.providerAdminAddress.zipCode)
    );
  }

  // Provider Admin Phone (if not using general)
  if (!data.useProviderAdminGeneralPhone) {
    addError(
      errors,
      'providerAdminPhone.number',
      ValidationRules.phone(data.providerAdminPhone.number)
    );
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Helper to add error if validation failed
 */
function addError(
  errors: ValidationError[],
  field: string,
  message: string | null
): void {
  if (message) {
    errors.push({ field, message });
  }
}

/**
 * Get error message for specific field
 *
 * @param errors - Validation errors array
 * @param field - Field name
 * @returns Error message or null
 */
export function getFieldError(
  errors: ValidationError[],
  field: string
): string | null {
  const error = errors.find((e) => e.field === field);
  return error ? error.message : null;
}

/**
 * Check if field has error
 *
 * @param errors - Validation errors array
 * @param field - Field name
 * @returns True if field has error
 */
export function hasFieldError(errors: ValidationError[], field: string): boolean {
  return errors.some((e) => e.field === field);
}
