/**
 * User Phone Form Component
 *
 * Form for adding or editing user phone numbers.
 * Supports both global phones and organization-specific overrides.
 *
 * Features:
 * - Field validation with error display
 * - Phone type selection (mobile, office, fax, emergency)
 * - Primary phone toggle (global phones only)
 * - SMS capability toggle
 * - Organization override option
 * - WCAG 2.1 Level AA compliant
 *
 * @see AddUserPhoneRequest for request structure
 * @see UpdateUserPhoneRequest for update structure
 */

import React, { useState, useCallback, useId } from 'react';
import { cn } from '@/components/ui/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertCircle, Phone } from 'lucide-react';
import type { UserPhone, PhoneType } from '@/types/user.types';
import { validatePhoneNumber } from '@/types/user.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Form data for phone input
 */
export interface PhoneFormData {
  label: string;
  type: PhoneType;
  number: string;
  extension: string;
  countryCode: string;
  isPrimary: boolean;
  smsCapable: boolean;
  isOrgOverride: boolean;
}

/**
 * Default form data for new phone
 */
const DEFAULT_FORM_DATA: PhoneFormData = {
  label: '',
  type: 'mobile',
  number: '',
  extension: '',
  countryCode: '+1',
  isPrimary: false,
  smsCapable: false,
  isOrgOverride: false,
};

/**
 * Props for UserPhoneForm component
 */
export interface UserPhoneFormProps {
  /** Initial data for editing (omit for new phone) */
  initialData?: Partial<UserPhone>;

  /** Called when form is submitted with valid data */
  onSubmit: (data: PhoneFormData) => void;

  /** Called when form is cancelled */
  onCancel: () => void;

  /** Whether the form is currently submitting */
  isSubmitting?: boolean;

  /** Whether this is edit mode */
  isEditMode?: boolean;

  /** Whether to show org override option */
  allowOrgOverride?: boolean;

  /** Additional CSS classes */
  className?: string;
}

/**
 * Field wrapper component with label and error display
 */
interface FieldWrapperProps {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}

const FieldWrapper: React.FC<FieldWrapperProps> = ({
  id,
  label,
  error,
  required = false,
  children,
}) => {
  const errorId = `${id}-error`;

  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={id}
        className={cn('text-sm font-medium', error ? 'text-red-600' : 'text-gray-700')}
      >
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
      {error && (
        <p
          id={errorId}
          className="flex items-center gap-1 text-sm text-red-600"
          role="alert"
        >
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
};

/**
 * Phone type options
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
  { value: '+81', label: '+81 (Japan)' },
  { value: '+86', label: '+86 (China)' },
  { value: '+91', label: '+91 (India)' },
];

/**
 * UserPhoneForm - Form for adding/editing user phones
 *
 * @example
 * <UserPhoneForm
 *   onSubmit={(data) => handleSave(data)}
 *   onCancel={() => setShowForm(false)}
 * />
 */
export const UserPhoneForm: React.FC<UserPhoneFormProps> = ({
  initialData,
  onSubmit,
  onCancel,
  isSubmitting = false,
  isEditMode = false,
  allowOrgOverride = true,
  className,
}) => {
  const baseId = useId();

  // Initialize form data from initial data or defaults
  const [formData, setFormData] = useState<PhoneFormData>(() => {
    if (initialData) {
      return {
        label: initialData.label || '',
        type: initialData.type || 'mobile',
        number: initialData.number || '',
        extension: initialData.extension || '',
        countryCode: initialData.countryCode || '+1',
        isPrimary: initialData.isPrimary || false,
        smsCapable: initialData.smsCapable || false,
        isOrgOverride: initialData.orgId !== null && initialData.orgId !== undefined,
      };
    }
    return { ...DEFAULT_FORM_DATA };
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());

  log.debug('UserPhoneForm render', { isEditMode, isSubmitting });

  // Field change handler
  const handleChange = useCallback(
    (field: keyof PhoneFormData, value: string | boolean) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      // Clear error when field is changed
      if (errors[field]) {
        setErrors((prev) => {
          const next = { ...prev };
          delete next[field];
          return next;
        });
      }
    },
    [errors]
  );

  // Field blur handler
  const handleBlur = useCallback((field: keyof PhoneFormData) => {
    setTouched((prev) => new Set(prev).add(field));
  }, []);

  // Validate form
  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.label.trim()) {
      newErrors.label = 'Label is required';
    } else if (formData.label.length > 50) {
      newErrors.label = 'Label must be 50 characters or less';
    }

    const phoneError = validatePhoneNumber(formData.number);
    if (phoneError) {
      newErrors.number = phoneError;
    }

    // Validate extension if provided
    if (formData.extension && !/^\d{1,10}$/.test(formData.extension)) {
      newErrors.extension = 'Extension must be 1-10 digits';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  // Form submit handler
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      // Mark all fields as touched
      setTouched(new Set(Object.keys(formData)));

      if (validate()) {
        onSubmit(formData);
      }
    },
    [formData, validate, onSubmit]
  );

  // Generate IDs for form fields
  const ids = {
    label: `${baseId}-label`,
    type: `${baseId}-type`,
    countryCode: `${baseId}-country-code`,
    number: `${baseId}-number`,
    extension: `${baseId}-extension`,
    isPrimary: `${baseId}-primary`,
    smsCapable: `${baseId}-sms`,
    isOrgOverride: `${baseId}-org-override`,
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn('space-y-4', className)}
      noValidate
    >
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-gray-200">
        <Phone className="w-5 h-5 text-gray-500" aria-hidden="true" />
        <h3 className="text-lg font-medium text-gray-900">
          {isEditMode ? 'Edit Phone' : 'Add Phone'}
        </h3>
      </div>

      {/* Label and Type row */}
      <div className="grid grid-cols-2 gap-4">
        <FieldWrapper
          id={ids.label}
          label="Label"
          error={touched.has('label') ? errors.label : undefined}
          required
        >
          <Input
            id={ids.label}
            type="text"
            value={formData.label}
            onChange={(e) => handleChange('label', e.target.value)}
            onBlur={() => handleBlur('label')}
            disabled={isSubmitting}
            placeholder="e.g., Personal Cell, Work"
            maxLength={50}
            aria-required="true"
            aria-invalid={!!errors.label}
            aria-describedby={errors.label ? `${ids.label}-error` : undefined}
            className={cn(errors.label && touched.has('label') && 'border-red-500')}
          />
        </FieldWrapper>

        <FieldWrapper id={ids.type} label="Type" required>
          <select
            id={ids.type}
            value={formData.type}
            onChange={(e) => handleChange('type', e.target.value as PhoneType)}
            disabled={isSubmitting}
            aria-required="true"
            className={cn(
              'flex h-10 w-full rounded-md border bg-white px-3 py-2 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
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
        </FieldWrapper>
      </div>

      {/* Phone number row */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-3">
          <FieldWrapper id={ids.countryCode} label="Country">
            <select
              id={ids.countryCode}
              value={formData.countryCode}
              onChange={(e) => handleChange('countryCode', e.target.value)}
              disabled={isSubmitting}
              className={cn(
                'flex h-10 w-full rounded-md border bg-white px-3 py-2 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
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
          </FieldWrapper>
        </div>

        <div className="col-span-6">
          <FieldWrapper
            id={ids.number}
            label="Phone Number"
            error={touched.has('number') ? errors.number : undefined}
            required
          >
            <Input
              id={ids.number}
              type="tel"
              value={formData.number}
              onChange={(e) => handleChange('number', e.target.value)}
              onBlur={() => handleBlur('number')}
              disabled={isSubmitting}
              placeholder="(555) 123-4567"
              aria-required="true"
              aria-invalid={!!errors.number}
              aria-describedby={errors.number ? `${ids.number}-error` : undefined}
              className={cn(errors.number && touched.has('number') && 'border-red-500')}
            />
          </FieldWrapper>
        </div>

        <div className="col-span-3">
          <FieldWrapper
            id={ids.extension}
            label="Ext."
            error={touched.has('extension') ? errors.extension : undefined}
          >
            <Input
              id={ids.extension}
              type="text"
              value={formData.extension}
              onChange={(e) => handleChange('extension', e.target.value)}
              onBlur={() => handleBlur('extension')}
              disabled={isSubmitting}
              placeholder="123"
              maxLength={10}
              aria-invalid={!!errors.extension}
              aria-describedby={errors.extension ? `${ids.extension}-error` : undefined}
              className={cn(
                errors.extension && touched.has('extension') && 'border-red-500'
              )}
            />
          </FieldWrapper>
        </div>
      </div>

      {/* Checkboxes */}
      <div className="space-y-3 pt-2">
        {/* SMS capable */}
        <div className="flex items-center gap-2">
          <Checkbox
            id={ids.smsCapable}
            checked={formData.smsCapable}
            onCheckedChange={(checked) => handleChange('smsCapable', !!checked)}
            disabled={isSubmitting}
            aria-describedby={`${ids.smsCapable}-help`}
          />
          <div>
            <Label htmlFor={ids.smsCapable} className="text-sm text-gray-700 cursor-pointer">
              SMS capable
            </Label>
            <p id={`${ids.smsCapable}-help`} className="text-xs text-gray-500">
              Can receive text message notifications
            </p>
          </div>
        </div>

        {/* Primary phone (only for global phones) */}
        {!formData.isOrgOverride && (
          <div className="flex items-center gap-2">
            <Checkbox
              id={ids.isPrimary}
              checked={formData.isPrimary}
              onCheckedChange={(checked) => handleChange('isPrimary', !!checked)}
              disabled={isSubmitting}
              aria-describedby={`${ids.isPrimary}-help`}
            />
            <Label htmlFor={ids.isPrimary} className="text-sm text-gray-700 cursor-pointer">
              Set as primary phone
            </Label>
          </div>
        )}

        {/* Organization override option */}
        {allowOrgOverride && !isEditMode && (
          <div className="flex items-center gap-2">
            <Checkbox
              id={ids.isOrgOverride}
              checked={formData.isOrgOverride}
              onCheckedChange={(checked) => {
                handleChange('isOrgOverride', !!checked);
                // Clear primary if switching to org override
                if (checked) {
                  handleChange('isPrimary', false);
                }
              }}
              disabled={isSubmitting}
              aria-describedby={`${ids.isOrgOverride}-help`}
            />
            <div>
              <Label htmlFor={ids.isOrgOverride} className="text-sm text-gray-700 cursor-pointer">
                Organization-specific phone
              </Label>
              <p id={`${ids.isOrgOverride}-help`} className="text-xs text-gray-500">
                This phone only applies to the current organization
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : isEditMode ? 'Save Changes' : 'Add Phone'}
        </Button>
      </div>
    </form>
  );
};

UserPhoneForm.displayName = 'UserPhoneForm';
