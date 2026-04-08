/**
 * IntakeFormField — renders a single form field driven by FieldDefinition metadata.
 *
 * Handles text, date, number, enum, multi_enum, boolean, and jsonb field types.
 * Shows required indicator and validation error when the section has been visited.
 */

import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface IntakeFormFieldProps {
  fieldKey: string;
  label: string;
  fieldType: string;
  value: unknown;
  isRequired: boolean;
  isVisible: boolean;
  error?: string;
  onChange: (key: string, value: unknown) => void;
  /** Enum options for 'enum' field type: [value, label] tuples */
  enumOptions?: ReadonlyArray<readonly [string, string]>;
  /** Multi-enum options for 'multi_enum' field type */
  multiEnumOptions?: ReadonlyArray<readonly [string, string]>;
  placeholder?: string;
  'data-testid'?: string;
}

export const IntakeFormField: React.FC<IntakeFormFieldProps> = ({
  fieldKey,
  label,
  fieldType,
  value,
  isRequired,
  isVisible,
  error,
  onChange,
  enumOptions,
  multiEnumOptions,
  placeholder,
  'data-testid': testId,
}) => {
  if (!isVisible) return null;

  const baseTestId = testId ?? `intake-field-${fieldKey}`;

  const renderField = () => {
    switch (fieldType) {
      case 'text':
        return (
          <Input
            id={fieldKey}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(fieldKey, e.target.value)}
            placeholder={placeholder}
            aria-required={isRequired}
            aria-invalid={!!error}
            data-testid={baseTestId}
          />
        );

      case 'number':
        return (
          <Input
            id={fieldKey}
            type="number"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(fieldKey, e.target.value ? Number(e.target.value) : '')}
            placeholder={placeholder}
            aria-required={isRequired}
            aria-invalid={!!error}
            data-testid={baseTestId}
          />
        );

      case 'date':
        return (
          <Input
            id={fieldKey}
            type="date"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(fieldKey, e.target.value)}
            aria-required={isRequired}
            aria-invalid={!!error}
            data-testid={baseTestId}
          />
        );

      case 'boolean':
        return (
          <label className="flex items-center gap-2 cursor-pointer" data-testid={baseTestId}>
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => onChange(fieldKey, e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              aria-required={isRequired}
            />
            <span className="text-sm text-gray-700">{label}</span>
          </label>
        );

      case 'enum':
        return (
          <select
            id={fieldKey}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(fieldKey, e.target.value || null)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            aria-required={isRequired}
            aria-invalid={!!error}
            data-testid={baseTestId}
          >
            <option value="">Select...</option>
            {enumOptions?.map(([val, lbl]) => (
              <option key={val} value={val}>
                {lbl}
              </option>
            ))}
          </select>
        );

      case 'multi_enum': {
        const selected = Array.isArray(value) ? (value as string[]) : [];
        return (
          <div className="space-y-1" data-testid={baseTestId}>
            {multiEnumOptions?.map(([val, lbl]) => (
              <label key={val} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(val)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, val]
                      : selected.filter((s) => s !== val);
                    onChange(fieldKey, next);
                  }}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">{lbl}</span>
              </label>
            ))}
          </div>
        );
      }

      case 'jsonb':
        return (
          <textarea
            id={fieldKey}
            value={typeof value === 'string' ? value : value ? JSON.stringify(value) : ''}
            onChange={(e) => onChange(fieldKey, e.target.value)}
            placeholder={placeholder ?? 'Enter details...'}
            rows={3}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            aria-required={isRequired}
            aria-invalid={!!error}
            data-testid={baseTestId}
          />
        );

      default:
        return (
          <Input
            id={fieldKey}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(fieldKey, e.target.value)}
            placeholder={placeholder}
            aria-required={isRequired}
            aria-invalid={!!error}
            data-testid={baseTestId}
          />
        );
    }
  };

  // Boolean fields render their own label inline
  if (fieldType === 'boolean') {
    return (
      <div className="space-y-1">
        {renderField()}
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={fieldKey} className="text-sm font-medium text-gray-700">
        {label}
        {isRequired && <span className="text-red-500 ml-1">*</span>}
      </Label>
      {renderField()}
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
