/**
 * Organization Unit Form Fields Component
 *
 * Shared form fields for creating and editing organization units.
 * Extracts common fields (name, displayName, timezone) to reduce duplication
 * between create and edit modes in OrganizationUnitsManagePage.
 *
 * Usage:
 * ```tsx
 * <OrganizationUnitFormFields
 *   formViewModel={formViewModel}
 *   idPrefix="create" // or "edit" for unique IDs
 * />
 * ```
 *
 * Features:
 * - Name input with validation
 * - Display name input with auto-populate from name (create mode)
 * - Timezone dropdown with common US timezones
 * - Field-level error display with ARIA attributes
 * - WCAG 2.1 Level AA compliant
 */

import React from 'react';
import { observer } from 'mobx-react-lite';
import { Label } from '@/components/ui/label';
import { cn } from '@/components/ui/utils';
import * as Select from '@radix-ui/react-select';
import { ChevronDown, AlertCircle } from 'lucide-react';
import {
  OrganizationUnitFormViewModel,
  COMMON_TIMEZONES,
} from '@/viewModels/organization/OrganizationUnitFormViewModel';

export interface OrganizationUnitFormFieldsProps {
  /** The form view model managing field state and validation */
  formViewModel: OrganizationUnitFormViewModel;
  /** Prefix for input IDs to ensure uniqueness (e.g., "create", "edit") */
  idPrefix: string;
  /** When true, all fields are disabled (e.g., inactive unit) */
  disabled?: boolean;
  /** Organization unit UUID (shown read-only in edit mode) */
  unitId?: string;
}

/**
 * Renders the common form fields for organization unit create/edit forms.
 * Fields: name, displayName, timezone
 */
export const OrganizationUnitFormFields: React.FC<OrganizationUnitFormFieldsProps> = observer(
  ({ formViewModel, idPrefix, disabled = false, unitId }) => {
    const nameError = formViewModel.getFieldError('name');
    const displayNameError = formViewModel.getFieldError('displayName');

    return (
      <>
        {idPrefix === 'edit' && unitId && (
          <div className="text-xs text-gray-500 font-mono bg-gray-50 px-3 py-2 rounded">
            ID: {unitId}
          </div>
        )}

        {/* Name Input */}
        <div className="space-y-1.5">
          <Label
            htmlFor={`${idPrefix}-unit-name`}
            className={cn(
              'text-sm font-medium',
              formViewModel.hasFieldError('name') ? 'text-red-600' : 'text-gray-700'
            )}
          >
            Unit Name <span className="text-red-500 ml-0.5">*</span>
          </Label>
          <input
            type="text"
            id={`${idPrefix}-unit-name`}
            value={formViewModel.formData.name}
            onChange={(e) => formViewModel.updateName(e.target.value)}
            onBlur={() => formViewModel.touchField('name')}
            disabled={disabled}
            className={cn(
              'flex w-full rounded-md border bg-white px-3 py-2 text-sm',
              'placeholder:text-gray-400',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
              'disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed',
              formViewModel.hasFieldError('name')
                ? 'border-red-500 focus:ring-red-500'
                : 'border-gray-300'
            )}
            placeholder="e.g., Main Campus"
            aria-required="true"
            aria-invalid={formViewModel.hasFieldError('name')}
            aria-describedby={
              formViewModel.hasFieldError('name') ? `${idPrefix}-name-error` : undefined
            }
          />
          {nameError && (
            <p
              id={`${idPrefix}-name-error`}
              className="flex items-center gap-1 text-sm text-red-600"
              role="alert"
            >
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              <span>{nameError}</span>
            </p>
          )}
        </div>

        {/* Display Name Input */}
        <div className="space-y-1.5">
          <Label
            htmlFor={`${idPrefix}-display-name`}
            className={cn(
              'text-sm font-medium',
              formViewModel.hasFieldError('displayName') ? 'text-red-600' : 'text-gray-700'
            )}
          >
            Display Name <span className="text-red-500 ml-0.5">*</span>
          </Label>
          <input
            type="text"
            id={`${idPrefix}-display-name`}
            value={formViewModel.formData.displayName}
            onChange={(e) => formViewModel.updateField('displayName', e.target.value)}
            onBlur={() => formViewModel.touchField('displayName')}
            disabled={disabled}
            className={cn(
              'flex w-full rounded-md border bg-white px-3 py-2 text-sm',
              'placeholder:text-gray-400',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
              'disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed',
              formViewModel.hasFieldError('displayName')
                ? 'border-red-500 focus:ring-red-500'
                : 'border-gray-300'
            )}
            placeholder="e.g., Main Campus - Building A"
            aria-required="true"
            aria-invalid={formViewModel.hasFieldError('displayName')}
            aria-describedby={
              formViewModel.hasFieldError('displayName')
                ? `${idPrefix}-display-name-error`
                : undefined
            }
          />
          {displayNameError && (
            <p
              id={`${idPrefix}-display-name-error`}
              className="flex items-center gap-1 text-sm text-red-600"
              role="alert"
            >
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              <span>{displayNameError}</span>
            </p>
          )}
        </div>

        {/* Timezone Dropdown */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-gray-700">
            Time Zone <span className="text-red-500 ml-0.5">*</span>
          </Label>
          <Select.Root
            value={formViewModel.formData.timeZone}
            onValueChange={(value) => formViewModel.setTimeZone(value)}
            disabled={disabled}
          >
            <Select.Trigger
              className={cn(
                'flex w-full rounded-md border bg-white px-3 py-2 text-sm items-center justify-between',
                'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
                formViewModel.hasFieldError('timeZone')
                  ? 'border-red-500 focus:ring-red-500'
                  : 'border-gray-300'
              )}
              aria-label="Time Zone"
            >
              <Select.Value>
                {COMMON_TIMEZONES.find((tz) => tz.value === formViewModel.formData.timeZone)
                  ?.label ?? formViewModel.formData.timeZone}
              </Select.Value>
              <Select.Icon>
                <ChevronDown className="h-4 w-4 text-gray-400" />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content className="bg-white rounded-md shadow-lg border border-gray-200 overflow-hidden z-50">
                <Select.Viewport className="p-1">
                  {COMMON_TIMEZONES.map((tz) => (
                    <Select.Item
                      key={tz.value}
                      value={tz.value}
                      className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-100 rounded outline-none data-[highlighted]:bg-gray-100"
                    >
                      <Select.ItemText>{tz.label}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>
        </div>
      </>
    );
  }
);

export default OrganizationUnitFormFields;
