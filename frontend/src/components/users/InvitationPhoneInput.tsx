/**
 * Invitation Phone Input Component (Phase 6)
 *
 * Simplified phone input for the invitation form.
 * Allows adding phone numbers that will be created when the invitation is accepted.
 *
 * Features:
 * - Add/remove phones dynamically
 * - Phone type selection (mobile, office, fax, emergency)
 * - SMS capability toggle
 * - Primary phone designation
 * - Field validation
 * - WCAG 2.1 Level AA compliant
 *
 * @see InvitationPhone type for data structure
 * @see UserPhoneForm for full phone management component
 */

import React, { useCallback, useId } from 'react';
import { cn } from '@/components/ui/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Phone,
  Plus,
  Trash2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { InvitationPhone, PhoneType } from '@/types/user.types';
import { validatePhoneNumber } from '@/types/user.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Phone type options for selection
 */
const PHONE_TYPES: { value: PhoneType; label: string }[] = [
  { value: 'mobile', label: 'Mobile' },
  { value: 'office', label: 'Office' },
  { value: 'fax', label: 'Fax' },
  { value: 'emergency', label: 'Emergency' },
];

/**
 * Common country codes
 */
const COUNTRY_CODES = [
  { value: '+1', label: '+1 (US/Canada)' },
  { value: '+44', label: '+44 (UK)' },
  { value: '+61', label: '+61 (Australia)' },
  { value: '+33', label: '+33 (France)' },
  { value: '+49', label: '+49 (Germany)' },
];

/**
 * Default values for a new phone entry
 */
const DEFAULT_PHONE: InvitationPhone = {
  label: '',
  type: 'mobile',
  number: '',
  countryCode: '+1',
  smsCapable: false,
  isPrimary: false,
};

/**
 * Props for InvitationPhoneInput component
 */
export interface InvitationPhoneInputProps {
  /** Current list of phones */
  phones: InvitationPhone[];

  /** Called when phones list changes */
  onChange: (phones: InvitationPhone[]) => void;

  /** Validation errors by phone index and field */
  errors?: Record<number, Record<string, string>>;

  /** Whether the form is disabled */
  disabled?: boolean;

  /** Additional CSS classes */
  className?: string;
}

/**
 * Single phone entry component
 */
interface PhoneEntryProps {
  phone: InvitationPhone;
  index: number;
  baseId: string;
  onUpdate: (index: number, updates: Partial<InvitationPhone>) => void;
  onRemove: (index: number) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
  canRemove: boolean;
}

const PhoneEntry: React.FC<PhoneEntryProps> = ({
  phone,
  index,
  baseId,
  onUpdate,
  onRemove,
  errors = {},
  disabled = false,
  canRemove,
}) => {
  const ids = {
    label: `${baseId}-label`,
    type: `${baseId}-type`,
    countryCode: `${baseId}-country`,
    number: `${baseId}-number`,
    smsCapable: `${baseId}-sms`,
    isPrimary: `${baseId}-primary`,
  };

  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-gray-50/50">
      {/* First row: Label, Type, Remove button */}
      <div className="flex gap-3">
        <div className="flex-1">
          <Label
            htmlFor={ids.label}
            className={cn(
              'text-xs font-medium',
              errors.label ? 'text-red-600' : 'text-gray-600'
            )}
          >
            Label <span className="text-red-500">*</span>
          </Label>
          <Input
            id={ids.label}
            type="text"
            value={phone.label}
            onChange={(e) => onUpdate(index, { label: e.target.value })}
            disabled={disabled}
            placeholder="e.g., Mobile, Work"
            maxLength={50}
            className={cn(
              'h-9 text-sm',
              errors.label && 'border-red-500'
            )}
            aria-required="true"
            aria-invalid={!!errors.label}
            aria-describedby={errors.label ? `${ids.label}-error` : undefined}
          />
          {errors.label && (
            <p
              id={`${ids.label}-error`}
              className="flex items-center gap-1 text-xs text-red-600 mt-0.5"
              role="alert"
            >
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              {errors.label}
            </p>
          )}
        </div>

        <div className="w-32">
          <Label htmlFor={ids.type} className="text-xs font-medium text-gray-600">
            Type
          </Label>
          <select
            id={ids.type}
            value={phone.type}
            onChange={(e) => onUpdate(index, { type: e.target.value as PhoneType })}
            disabled={disabled}
            className={cn(
              'flex h-9 w-full rounded-md border bg-white px-2 py-1 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-blue-500',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'border-gray-300'
            )}
          >
            {PHONE_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onRemove(index)}
            disabled={disabled}
            className="self-end h-9 w-9 p-0 text-gray-400 hover:text-red-600"
            aria-label={`Remove phone ${index + 1}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* Second row: Country code and phone number */}
      <div className="flex gap-3">
        <div className="w-28">
          <Label htmlFor={ids.countryCode} className="text-xs font-medium text-gray-600">
            Country
          </Label>
          <select
            id={ids.countryCode}
            value={phone.countryCode || '+1'}
            onChange={(e) => onUpdate(index, { countryCode: e.target.value })}
            disabled={disabled}
            className={cn(
              'flex h-9 w-full rounded-md border bg-white px-2 py-1 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-blue-500',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'border-gray-300'
            )}
          >
            {COUNTRY_CODES.map((code) => (
              <option key={code.value} value={code.value}>
                {code.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1">
          <Label
            htmlFor={ids.number}
            className={cn(
              'text-xs font-medium',
              errors.number ? 'text-red-600' : 'text-gray-600'
            )}
          >
            Phone Number <span className="text-red-500">*</span>
          </Label>
          <Input
            id={ids.number}
            type="tel"
            value={phone.number}
            onChange={(e) => onUpdate(index, { number: e.target.value })}
            disabled={disabled}
            placeholder="(555) 123-4567"
            className={cn(
              'h-9 text-sm',
              errors.number && 'border-red-500'
            )}
            aria-required="true"
            aria-invalid={!!errors.number}
            aria-describedby={errors.number ? `${ids.number}-error` : undefined}
          />
          {errors.number && (
            <p
              id={`${ids.number}-error`}
              className="flex items-center gap-1 text-xs text-red-600 mt-0.5"
              role="alert"
            >
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              {errors.number}
            </p>
          )}
        </div>
      </div>

      {/* Third row: Checkboxes */}
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <Checkbox
            id={ids.smsCapable}
            checked={phone.smsCapable || false}
            onCheckedChange={(checked) => onUpdate(index, { smsCapable: !!checked })}
            disabled={disabled}
          />
          <Label
            htmlFor={ids.smsCapable}
            className="text-sm text-gray-700 cursor-pointer"
          >
            SMS capable
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id={ids.isPrimary}
            checked={phone.isPrimary || false}
            onCheckedChange={(checked) => onUpdate(index, { isPrimary: !!checked })}
            disabled={disabled}
          />
          <Label
            htmlFor={ids.isPrimary}
            className="text-sm text-gray-700 cursor-pointer"
          >
            Primary phone
          </Label>
        </div>
      </div>
    </div>
  );
};

/**
 * InvitationPhoneInput - Multi-phone input for invitation form
 *
 * @example
 * <InvitationPhoneInput
 *   phones={formData.phones}
 *   onChange={(phones) => setFieldValue('phones', phones)}
 *   errors={phoneErrors}
 * />
 */
export const InvitationPhoneInput: React.FC<InvitationPhoneInputProps> = ({
  phones,
  onChange,
  errors = {},
  disabled = false,
  className,
}) => {
  const baseId = useId();
  const [isExpanded, setIsExpanded] = React.useState(phones.length > 0);

  log.debug('InvitationPhoneInput render', { phoneCount: phones.length });

  // Add a new phone entry
  const handleAddPhone = useCallback(() => {
    // If adding first phone, set it as primary
    const isFirst = phones.length === 0;
    const newPhone: InvitationPhone = {
      ...DEFAULT_PHONE,
      isPrimary: isFirst,
    };
    onChange([...phones, newPhone]);
    setIsExpanded(true);
  }, [phones, onChange]);

  // Update a phone entry
  const handleUpdatePhone = useCallback(
    (index: number, updates: Partial<InvitationPhone>) => {
      const newPhones = [...phones];

      // If setting as primary, clear primary from others
      if (updates.isPrimary) {
        newPhones.forEach((p, i) => {
          if (i !== index) {
            newPhones[i] = { ...p, isPrimary: false };
          }
        });
      }

      newPhones[index] = { ...newPhones[index], ...updates };
      onChange(newPhones);
    },
    [phones, onChange]
  );

  // Remove a phone entry
  const handleRemovePhone = useCallback(
    (index: number) => {
      const newPhones = phones.filter((_, i) => i !== index);

      // If removed phone was primary, make first remaining phone primary
      if (phones[index].isPrimary && newPhones.length > 0) {
        newPhones[0] = { ...newPhones[0], isPrimary: true };
      }

      onChange(newPhones);

      // Collapse section if no phones left
      if (newPhones.length === 0) {
        setIsExpanded(false);
      }
    },
    [phones, onChange]
  );

  return (
    <div className={cn('space-y-3', className)}>
      {/* Section header with expand/collapse */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'flex items-center justify-between w-full px-3 py-2 rounded-lg',
          'text-left transition-colors',
          'hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500',
          isExpanded ? 'bg-gray-50' : 'bg-transparent'
        )}
        aria-expanded={isExpanded}
        aria-controls={`${baseId}-phone-section`}
      >
        <div className="flex items-center gap-2">
          <Phone className="w-4 h-4 text-gray-500" aria-hidden="true" />
          <span className="font-medium text-gray-900">
            Phone Numbers
            {phones.length > 0 && (
              <span className="ml-1 text-sm font-normal text-gray-500">
                ({phones.length})
              </span>
            )}
          </span>
          <span className="text-xs text-gray-400">(Optional)</span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400" aria-hidden="true" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />
        )}
      </button>

      {/* Phone entries (collapsible) */}
      {isExpanded && (
        <div id={`${baseId}-phone-section`} className="space-y-3">
          {phones.length === 0 ? (
            <p className="text-sm text-gray-500 italic px-3 py-2">
              No phone numbers added. Add a phone to enable SMS notifications.
            </p>
          ) : (
            phones.map((phone, index) => (
              <PhoneEntry
                key={index}
                phone={phone}
                index={index}
                baseId={`${baseId}-phone-${index}`}
                onUpdate={handleUpdatePhone}
                onRemove={handleRemovePhone}
                errors={errors[index]}
                disabled={disabled}
                canRemove={phones.length > 0}
              />
            ))
          )}

          {/* Add phone button */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddPhone}
            disabled={disabled}
            className="w-full"
          >
            <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" />
            Add Phone Number
          </Button>
        </div>
      )}

      {/* Collapsed state - show add button */}
      {!isExpanded && phones.length === 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleAddPhone}
          disabled={disabled}
          className="text-gray-500 hover:text-gray-700"
        >
          <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" />
          Add Phone Number
        </Button>
      )}
    </div>
  );
};

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

InvitationPhoneInput.displayName = 'InvitationPhoneInput';
