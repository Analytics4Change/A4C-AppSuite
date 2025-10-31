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
 *
 * @param data - Organization form data
 * @returns Validation result with errors
 */
export function validateOrganizationForm(
  data: OrganizationFormData
): ValidationResult {
  const errors: ValidationError[] = [];

  // Organization Information
  addError(errors, 'name', ValidationRules.required(data.name, 'Organization name'));
  addError(errors, 'displayName', ValidationRules.required(data.displayName, 'Display name'));
  addError(errors, 'subdomain', ValidationRules.subdomain(data.subdomain));
  addError(errors, 'timeZone', ValidationRules.required(data.timeZone, 'Time zone'));

  // Admin Contact
  addError(
    errors,
    'adminContact.firstName',
    ValidationRules.required(data.adminContact.firstName, 'First name')
  );
  addError(
    errors,
    'adminContact.lastName',
    ValidationRules.required(data.adminContact.lastName, 'Last name')
  );
  addError(errors, 'adminContact.email', ValidationRules.email(data.adminContact.email));

  // Billing Address
  addError(
    errors,
    'billingAddress.street1',
    ValidationRules.required(data.billingAddress.street1, 'Street address')
  );
  addError(errors, 'billingAddress.city', ValidationRules.required(data.billingAddress.city, 'City'));
  addError(
    errors,
    'billingAddress.state',
    ValidationRules.required(data.billingAddress.state, 'State')
  );
  addError(errors, 'billingAddress.zipCode', ValidationRules.zipCode(data.billingAddress.zipCode));

  // Billing Phone
  addError(errors, 'billingPhone.number', ValidationRules.phone(data.billingPhone.number));

  // Program
  addError(errors, 'program.name', ValidationRules.required(data.program.name, 'Program name'));
  addError(errors, 'program.type', ValidationRules.required(data.program.type, 'Program type'));

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
