/**
 * Validation utilities for invitation phone inputs
 *
 * Separated from InvitationPhoneInput component to ensure
 * React Fast Refresh works correctly (components-only exports).
 */

import type { InvitationPhone } from '@/types/user.types';
import { validatePhoneNumber } from '@/types/user.types';

/**
 * Validate phones array for invitation form
 *
 * @param phones - Array of phones to validate
 * @param notificationPrefs - Optional notification preferences to check SMS requirement
 * @returns Record of errors by phone index and field, or empty object if valid
 */
export function validateInvitationPhones(
  phones: InvitationPhone[],
  notificationPrefs?: { sms?: { enabled?: boolean } }
): Record<number, Record<string, string>> {
  const errors: Record<number, Record<string, string>> = {};

  phones.forEach((phone, index) => {
    const phoneErrors: Record<string, string> = {};

    if (!phone.label.trim()) {
      phoneErrors.label = 'Label is required';
    } else if (phone.label.length > 50) {
      phoneErrors.label = 'Label must be 50 characters or less';
    }

    const numberError = validatePhoneNumber(phone.number);
    if (numberError) {
      phoneErrors.number = numberError;
    }

    if (Object.keys(phoneErrors).length > 0) {
      errors[index] = phoneErrors;
    }
  });

  // If SMS is enabled, require at least one SMS-capable phone
  if (notificationPrefs?.sms?.enabled) {
    const hasSmsCapable = phones.some((p) => p.smsCapable);
    if (!hasSmsCapable && phones.length > 0) {
      // Add error to first phone entry
      errors[0] = {
        ...(errors[0] || {}),
        smsCapable: 'At least one phone must be SMS-capable when SMS notifications are enabled',
      };
    }
  }

  return errors;
}
