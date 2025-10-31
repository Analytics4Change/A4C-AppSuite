/**
 * Select Dropdown Component
 *
 * Simple dropdown component for selection from predefined options.
 * Used for time zones, states, program types, organization types, etc.
 *
 * Features:
 * - Value/label pairs for options
 * - Keyboard navigation (Tab, Enter, Arrow keys)
 * - Error display
 * - Accessible with ARIA attributes
 * - Required field support
 *
 * Props:
 * - id: Input identifier
 * - label: Dropdown label text
 * - value: Current selected value
 * - options: Array of {value, label} pairs
 * - onChange: Callback with selected value
 * - error: Optional error message
 * - required: Whether field is required
 * - disabled: Whether dropdown is disabled
 * - placeholder: Optional placeholder text
 * - tabIndex: Tab order
 */

import React from 'react';
import { Label } from '@/components/ui/label';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectDropdownProps {
  id: string;
  label: string;
  value: string;
  options: readonly SelectOption[] | SelectOption[];
  onChange: (value: string) => void;
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  tabIndex?: number;
}

/**
 * Select Dropdown Component
 *
 * Simple accessible dropdown for predefined option selection.
 */
export const SelectDropdown: React.FC<SelectDropdownProps> = ({
  id,
  label,
  value,
  options,
  onChange,
  error,
  required = false,
  disabled = false,
  placeholder,
  tabIndex
}) => {
  /**
   * Handle selection change
   */
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </Label>

      <select
        id={id}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        tabIndex={tabIndex}
        aria-label={label}
        aria-required={required}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`
          w-full rounded-md border px-3 py-2
          text-sm shadow-sm
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
          disabled:cursor-not-allowed disabled:opacity-50
          ${error ? 'border-red-500' : 'border-gray-300'}
        `}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {error && (
        <p id={`${id}-error`} className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
