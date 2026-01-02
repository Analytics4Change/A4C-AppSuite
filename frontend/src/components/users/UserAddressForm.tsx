/**
 * User Address Form Component
 *
 * Form for adding or editing user addresses.
 * Supports both global addresses and organization-specific overrides.
 *
 * Features:
 * - Field validation with error display
 * - Address type selection (physical, mailing, billing)
 * - Primary address toggle (global addresses only)
 * - Organization override option
 * - WCAG 2.1 Level AA compliant
 *
 * @see AddUserAddressRequest for request structure
 * @see UpdateUserAddressRequest for update structure
 */

import React, { useState, useCallback, useId } from 'react';
import { cn } from '@/components/ui/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertCircle, MapPin } from 'lucide-react';
import type { UserAddress, AddressType } from '@/types/user.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Form data for address input
 */
export interface AddressFormData {
  label: string;
  type: AddressType;
  street1: string;
  street2: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  isPrimary: boolean;
  isOrgOverride: boolean;
}

/**
 * Default form data for new address
 */
const DEFAULT_FORM_DATA: AddressFormData = {
  label: '',
  type: 'physical',
  street1: '',
  street2: '',
  city: '',
  state: '',
  zipCode: '',
  country: 'USA',
  isPrimary: false,
  isOrgOverride: false,
};

/**
 * Props for UserAddressForm component
 */
export interface UserAddressFormProps {
  /** Initial data for editing (omit for new address) */
  initialData?: Partial<UserAddress>;

  /** Called when form is submitted with valid data */
  onSubmit: (data: AddressFormData) => void;

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
 * Address type options
 */
const ADDRESS_TYPES: { value: AddressType; label: string }[] = [
  { value: 'physical', label: 'Physical' },
  { value: 'mailing', label: 'Mailing' },
  { value: 'billing', label: 'Billing' },
];

/**
 * US states for dropdown
 */
const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

/**
 * UserAddressForm - Form for adding/editing user addresses
 *
 * @example
 * <UserAddressForm
 *   onSubmit={(data) => handleSave(data)}
 *   onCancel={() => setShowForm(false)}
 * />
 */
export const UserAddressForm: React.FC<UserAddressFormProps> = ({
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
  const [formData, setFormData] = useState<AddressFormData>(() => {
    if (initialData) {
      return {
        label: initialData.label || '',
        type: initialData.type || 'physical',
        street1: initialData.street1 || '',
        street2: initialData.street2 || '',
        city: initialData.city || '',
        state: initialData.state || '',
        zipCode: initialData.zipCode || '',
        country: initialData.country || 'USA',
        isPrimary: initialData.isPrimary || false,
        isOrgOverride: initialData.orgId !== null && initialData.orgId !== undefined,
      };
    }
    return { ...DEFAULT_FORM_DATA };
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());

  log.debug('UserAddressForm render', { isEditMode, isSubmitting });

  // Field change handler
  const handleChange = useCallback(
    (field: keyof AddressFormData, value: string | boolean) => {
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
  const handleBlur = useCallback((field: keyof AddressFormData) => {
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

    if (!formData.street1.trim()) {
      newErrors.street1 = 'Street address is required';
    }

    if (!formData.city.trim()) {
      newErrors.city = 'City is required';
    }

    if (!formData.state.trim()) {
      newErrors.state = 'State is required';
    }

    if (!formData.zipCode.trim()) {
      newErrors.zipCode = 'ZIP code is required';
    } else if (!/^\d{5}(-\d{4})?$/.test(formData.zipCode.trim())) {
      newErrors.zipCode = 'Please enter a valid ZIP code (e.g., 12345 or 12345-6789)';
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
    street1: `${baseId}-street1`,
    street2: `${baseId}-street2`,
    city: `${baseId}-city`,
    state: `${baseId}-state`,
    zipCode: `${baseId}-zip`,
    country: `${baseId}-country`,
    isPrimary: `${baseId}-primary`,
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
        <MapPin className="w-5 h-5 text-gray-500" aria-hidden="true" />
        <h3 className="text-lg font-medium text-gray-900">
          {isEditMode ? 'Edit Address' : 'Add Address'}
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
            placeholder="e.g., Home, Work"
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
            onChange={(e) => handleChange('type', e.target.value as AddressType)}
            disabled={isSubmitting}
            aria-required="true"
            className={cn(
              'flex h-10 w-full rounded-md border bg-white px-3 py-2 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'border-gray-300'
            )}
          >
            {ADDRESS_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </FieldWrapper>
      </div>

      {/* Street address */}
      <FieldWrapper
        id={ids.street1}
        label="Street Address"
        error={touched.has('street1') ? errors.street1 : undefined}
        required
      >
        <Input
          id={ids.street1}
          type="text"
          value={formData.street1}
          onChange={(e) => handleChange('street1', e.target.value)}
          onBlur={() => handleBlur('street1')}
          disabled={isSubmitting}
          placeholder="123 Main Street"
          aria-required="true"
          aria-invalid={!!errors.street1}
          aria-describedby={errors.street1 ? `${ids.street1}-error` : undefined}
          className={cn(errors.street1 && touched.has('street1') && 'border-red-500')}
        />
      </FieldWrapper>

      {/* Street address line 2 */}
      <FieldWrapper id={ids.street2} label="Street Address Line 2">
        <Input
          id={ids.street2}
          type="text"
          value={formData.street2}
          onChange={(e) => handleChange('street2', e.target.value)}
          disabled={isSubmitting}
          placeholder="Apt, Suite, Building (optional)"
        />
      </FieldWrapper>

      {/* City, State, ZIP row */}
      <div className="grid grid-cols-6 gap-4">
        <div className="col-span-3">
          <FieldWrapper
            id={ids.city}
            label="City"
            error={touched.has('city') ? errors.city : undefined}
            required
          >
            <Input
              id={ids.city}
              type="text"
              value={formData.city}
              onChange={(e) => handleChange('city', e.target.value)}
              onBlur={() => handleBlur('city')}
              disabled={isSubmitting}
              placeholder="City"
              aria-required="true"
              aria-invalid={!!errors.city}
              aria-describedby={errors.city ? `${ids.city}-error` : undefined}
              className={cn(errors.city && touched.has('city') && 'border-red-500')}
            />
          </FieldWrapper>
        </div>

        <div className="col-span-1">
          <FieldWrapper
            id={ids.state}
            label="State"
            error={touched.has('state') ? errors.state : undefined}
            required
          >
            <select
              id={ids.state}
              value={formData.state}
              onChange={(e) => handleChange('state', e.target.value)}
              onBlur={() => handleBlur('state')}
              disabled={isSubmitting}
              aria-required="true"
              aria-invalid={!!errors.state}
              aria-describedby={errors.state ? `${ids.state}-error` : undefined}
              className={cn(
                'flex h-10 w-full rounded-md border bg-white px-3 py-2 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
                'disabled:cursor-not-allowed disabled:opacity-50',
                errors.state && touched.has('state')
                  ? 'border-red-500'
                  : 'border-gray-300'
              )}
            >
              <option value="">--</option>
              {US_STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </FieldWrapper>
        </div>

        <div className="col-span-2">
          <FieldWrapper
            id={ids.zipCode}
            label="ZIP Code"
            error={touched.has('zipCode') ? errors.zipCode : undefined}
            required
          >
            <Input
              id={ids.zipCode}
              type="text"
              value={formData.zipCode}
              onChange={(e) => handleChange('zipCode', e.target.value)}
              onBlur={() => handleBlur('zipCode')}
              disabled={isSubmitting}
              placeholder="12345"
              maxLength={10}
              aria-required="true"
              aria-invalid={!!errors.zipCode}
              aria-describedby={errors.zipCode ? `${ids.zipCode}-error` : undefined}
              className={cn(errors.zipCode && touched.has('zipCode') && 'border-red-500')}
            />
          </FieldWrapper>
        </div>
      </div>

      {/* Country */}
      <FieldWrapper id={ids.country} label="Country">
        <Input
          id={ids.country}
          type="text"
          value={formData.country}
          onChange={(e) => handleChange('country', e.target.value)}
          disabled={isSubmitting}
          placeholder="USA"
        />
      </FieldWrapper>

      {/* Checkboxes */}
      <div className="space-y-3 pt-2">
        {/* Primary address (only for global addresses) */}
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
              Set as primary address
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
                Organization-specific address
              </Label>
              <p id={`${ids.isOrgOverride}-help`} className="text-xs text-gray-500">
                This address only applies to the current organization
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
          {isSubmitting ? 'Saving...' : isEditMode ? 'Save Changes' : 'Add Address'}
        </Button>
      </div>
    </form>
  );
};

UserAddressForm.displayName = 'UserAddressForm';
