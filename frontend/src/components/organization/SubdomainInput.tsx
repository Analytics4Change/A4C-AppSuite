/**
 * Subdomain Input Component
 *
 * Specialized input for subdomain validation and formatting.
 * Shows full domain preview (.a4c.app suffix) and validates subdomain rules.
 *
 * Features:
 * - Auto-formatting to lowercase with hyphens only
 * - Live domain preview
 * - Validation for subdomain rules
 * - Reserved subdomain checking
 * - Error display
 * - Accessible with ARIA attributes
 *
 * Subdomain Rules:
 * - Must start with letter
 * - Lowercase letters, numbers, hyphens only
 * - 3-63 characters
 * - Cannot be reserved (admin, api, www, etc.)
 *
 * Props:
 * - id: Input identifier
 * - label: Input label text
 * - value: Current subdomain
 * - onChange: Callback with formatted subdomain
 * - error: Optional error message
 * - required: Whether field is required
 * - disabled: Whether input is disabled
 * - tabIndex: Tab order
 */

import React, { useCallback } from 'react';
import { formatSubdomain } from '@/utils/organization-validation';

export interface SubdomainInputProps {
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
 * Subdomain Input Component
 *
 * Formats subdomain to lowercase and shows full domain preview.
 */
export const SubdomainInput: React.FC<SubdomainInputProps> = ({
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
      const formatted = formatSubdomain(rawValue);
      onChange(formatted);
    },
    [onChange]
  );

  /**
   * Full domain preview
   */
  const fullDomain = value ? `${value}.a4c.app` : '';

  return (
    <div className="grid grid-cols-[160px_1fr] items-start gap-4">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 pt-2">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="text"
            value={value}
            onChange={handleChange}
            disabled={disabled}
            tabIndex={tabIndex}
            placeholder="myorg"
            maxLength={63}
            aria-label={label}
            aria-required={required}
            aria-invalid={!!error}
            aria-describedby={
              error
                ? `${id}-error`
                : fullDomain
                  ? `${id}-preview`
                  : undefined
            }
            className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm font-mono ${error ? 'border-red-500' : ''}`}
          />
          <span className="text-gray-500">.a4c.app</span>
        </div>

        {fullDomain && !error && (
          <p id={`${id}-preview`} className="text-sm text-gray-600">
            Your organization URL: <span className="font-mono">{fullDomain}</span>
          </p>
        )}

        {error && (
          <p id={`${id}-error`} className="text-sm text-red-500" role="alert">
            {error}
          </p>
        )}

        <p className="text-xs text-gray-500">
          Must start with a letter, use lowercase letters, numbers, and hyphens
          (3-63 characters)
        </p>
      </div>
    </div>
  );
};
