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
import { ChevronDown } from 'lucide-react';
import {
  OrganizationUnitFormViewModel,
  COMMON_TIMEZONES,
} from '@/viewModels/organization/OrganizationUnitFormViewModel';

export interface OrganizationUnitFormFieldsProps {
  /** The form view model managing field state and validation */
  formViewModel: OrganizationUnitFormViewModel;
  /** Prefix for input IDs to ensure uniqueness (e.g., "create", "edit") */
  idPrefix: string;
}

/**
 * Renders the common form fields for organization unit create/edit forms.
 * Fields: name, displayName, timezone
 */
export const OrganizationUnitFormFields: React.FC<OrganizationUnitFormFieldsProps> = observer(
  ({ formViewModel, idPrefix }) => {
    return (
      <>
        {/* Name Input */}
        <div>
          <Label
            htmlFor={`${idPrefix}-unit-name`}
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            Unit Name <span className="text-red-500">*</span>
          </Label>
          <input
            type="text"
            id={`${idPrefix}-unit-name`}
            value={formViewModel.formData.name}
            onChange={(e) => formViewModel.updateName(e.target.value)}
            onBlur={() => formViewModel.touchField('name')}
            className={cn(
              'w-full px-2 py-1.5 text-sm rounded-md border shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors',
              formViewModel.hasFieldError('name')
                ? 'border-red-300 bg-red-50'
                : 'border-gray-300 bg-white'
            )}
            placeholder="e.g., Main Campus"
            aria-required="true"
            aria-invalid={formViewModel.hasFieldError('name')}
            aria-describedby={
              formViewModel.hasFieldError('name') ? `${idPrefix}-name-error` : undefined
            }
          />
          {formViewModel.hasFieldError('name') && (
            <p
              id={`${idPrefix}-name-error`}
              className="text-red-600 text-xs mt-1"
              role="alert"
            >
              {formViewModel.getFieldError('name')}
            </p>
          )}
        </div>

        {/* Display Name Input */}
        <div>
          <Label
            htmlFor={`${idPrefix}-display-name`}
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            Display Name <span className="text-red-500">*</span>
          </Label>
          <input
            type="text"
            id={`${idPrefix}-display-name`}
            value={formViewModel.formData.displayName}
            onChange={(e) => formViewModel.updateField('displayName', e.target.value)}
            onBlur={() => formViewModel.touchField('displayName')}
            className={cn(
              'w-full px-2 py-1.5 text-sm rounded-md border shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors',
              formViewModel.hasFieldError('displayName')
                ? 'border-red-300 bg-red-50'
                : 'border-gray-300 bg-white'
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
          {formViewModel.hasFieldError('displayName') && (
            <p
              id={`${idPrefix}-display-name-error`}
              className="text-red-600 text-xs mt-1"
              role="alert"
            >
              {formViewModel.getFieldError('displayName')}
            </p>
          )}
        </div>

        {/* Timezone Dropdown */}
        <div>
          <Label className="block text-xs font-medium text-gray-700 mb-1">
            Time Zone <span className="text-red-500">*</span>
          </Label>
          <Select.Root
            value={formViewModel.formData.timeZone}
            onValueChange={(value) => formViewModel.setTimeZone(value)}
          >
            <Select.Trigger
              className={cn(
                'w-full px-2 py-1.5 text-sm rounded-md border shadow-sm bg-white flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-blue-500',
                formViewModel.hasFieldError('timeZone')
                  ? 'border-red-300 bg-red-50'
                  : 'border-gray-300'
              )}
              aria-label="Time Zone"
            >
              <Select.Value>
                {COMMON_TIMEZONES.find(
                  (tz) => tz.value === formViewModel.formData.timeZone
                )?.label ?? formViewModel.formData.timeZone}
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
