/**
 * Phone Input Component
 *
 * Specialized input for US phone numbers with automatic formatting.
 * Formats input as (XXX) XXX-XXXX while typing.
 *
 * Features:
 * - Auto-formatting to (XXX) XXX-XXXX format
 * - Validation for 10-digit US phone numbers
 * - Error display
 * - Accessible with ARIA attributes
 * - Keyboard navigation support
 *
 * Props:
 * - id: Input identifier
 * - label: Input label text
 * - value: Current phone number (can be formatted or raw)
 * - onChange: Callback with formatted phone number
 * - error: Optional error message
 * - required: Whether field is required
 * - disabled: Whether input is disabled
 * - tabIndex: Tab order
 */

import React, { useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatPhone } from '@/utils/organization-validation';

export interface PhoneInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
  tabIndex?: number;
}

/**
 * Phone Input Component
 *
 * Formats US phone numbers to (XXX) XXX-XXXX format automatically.
 */
export const PhoneInput: React.FC<PhoneInputProps> = ({
  id,
  label,
  value,
  onChange,
  error,
  required = false,
  disabled = false,
  tabIndex
}) => {
  /**
   * Handle input change with auto-formatting
   */
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawValue = e.target.value;

      // Allow user to type freely, format on blur
      // Or format in real-time for better UX
      const formatted = formatPhone(rawValue);

      onChange(formatted);
    },
    [onChange]
  );

  /**
   * Handle blur to ensure final formatting
   */
  const handleBlur = useCallback(() => {
    const formatted = formatPhone(value);
    if (formatted !== value) {
      onChange(formatted);
    }
  }, [value, onChange]);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </Label>
      <Input
        id={id}
        type="tel"
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        disabled={disabled}
        tabIndex={tabIndex}
        placeholder="(555) 123-4567"
        maxLength={14} // (XXX) XXX-XXXX = 14 characters
        aria-label={label}
        aria-required={required}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className={error ? 'border-red-500' : ''}
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
