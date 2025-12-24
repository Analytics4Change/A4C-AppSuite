/**
 * Role Form Fields Component
 *
 * Shared form fields for role create/edit forms.
 * Includes name, description, and organizational unit scope selector.
 *
 * Features:
 * - Consistent form field styling
 * - Field-level validation error display
 * - Accessible labels and error messages
 * - Integration with RoleFormViewModel
 *
 * @see RoleFormViewModel for validation logic
 */

import React, { useCallback, useId } from 'react';
import { observer } from 'mobx-react-lite';
import { cn } from '@/components/ui/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle } from 'lucide-react';
import type { RoleFormData } from '@/types/role.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Props for RoleFormFields component
 */
export interface RoleFormFieldsProps {
  /** Current form data */
  formData: RoleFormData;

  /** Callback when a field value changes */
  onFieldChange: <K extends keyof RoleFormData>(field: K, value: RoleFormData[K]) => void;

  /** Callback when a field loses focus */
  onFieldBlur: (field: keyof RoleFormData) => void;

  /** Get error message for a field */
  getFieldError: (field: keyof RoleFormData) => string | null;

  /** Whether the form is disabled (e.g., during submission) */
  disabled?: boolean;

  /** Whether this is edit mode (shows role ID) */
  isEditMode?: boolean;

  /** Role ID (for edit mode display) */
  roleId?: string;

  /** Additional CSS classes */
  className?: string;
}

/**
 * Field wrapper component with label and error display
 */
interface FieldWrapperProps {
  id: string;
  label: string;
  error: string | null;
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
 * Role Form Fields Component
 *
 * Renders the standard form fields for role management.
 */
export const RoleFormFields = observer(
  ({
    formData,
    onFieldChange,
    onFieldBlur,
    getFieldError,
    disabled = false,
    isEditMode = false,
    roleId,
    className,
  }: RoleFormFieldsProps) => {
    const nameId = useId();
    const descriptionId = useId();
    const scopeId = useId();

    log.debug('RoleFormFields render', { isEditMode, disabled });

    // Field handlers
    const handleNameChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        onFieldChange('name', e.target.value);
      },
      [onFieldChange]
    );

    const handleDescriptionChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onFieldChange('description', e.target.value);
      },
      [onFieldChange]
    );

    const handleScopeChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        onFieldChange('orgHierarchyScope', e.target.value || null);
      },
      [onFieldChange]
    );

    const handleNameBlur = useCallback(() => {
      onFieldBlur('name');
    }, [onFieldBlur]);

    const handleDescriptionBlur = useCallback(() => {
      onFieldBlur('description');
    }, [onFieldBlur]);

    const handleScopeBlur = useCallback(() => {
      onFieldBlur('orgHierarchyScope');
    }, [onFieldBlur]);

    const nameError = getFieldError('name');
    const descriptionError = getFieldError('description');
    const scopeError = getFieldError('orgHierarchyScope');

    return (
      <div className={cn('space-y-4', className)}>
        {/* Role ID (edit mode only) */}
        {isEditMode && roleId && (
          <div className="text-xs text-gray-500 font-mono bg-gray-50 px-3 py-2 rounded">
            ID: {roleId}
          </div>
        )}

        {/* Name field */}
        <FieldWrapper
          id={nameId}
          label="Role Name"
          error={nameError}
          required
        >
          <Input
            id={nameId}
            type="text"
            value={formData.name}
            onChange={handleNameChange}
            onBlur={handleNameBlur}
            disabled={disabled}
            placeholder="e.g., Medication Administrator"
            maxLength={100}
            aria-required="true"
            aria-invalid={!!nameError}
            aria-describedby={nameError ? `${nameId}-error` : undefined}
            className={cn(nameError && 'border-red-500 focus:ring-red-500')}
          />
        </FieldWrapper>

        {/* Description field */}
        <FieldWrapper
          id={descriptionId}
          label="Description"
          error={descriptionError}
          required
        >
          <textarea
            id={descriptionId}
            value={formData.description}
            onChange={handleDescriptionChange}
            onBlur={handleDescriptionBlur}
            disabled={disabled}
            placeholder="Describe the purpose and responsibilities of this role..."
            maxLength={500}
            rows={3}
            aria-required="true"
            aria-invalid={!!descriptionError}
            aria-describedby={descriptionError ? `${descriptionId}-error` : undefined}
            className={cn(
              'flex w-full rounded-md border bg-white px-3 py-2 text-sm',
              'placeholder:text-gray-400',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
              'disabled:cursor-not-allowed disabled:opacity-50',
              descriptionError
                ? 'border-red-500 focus:ring-red-500'
                : 'border-gray-300'
            )}
          />
          <p className="text-xs text-gray-500 mt-1">
            {formData.description.length}/500 characters
          </p>
        </FieldWrapper>

        {/* Organizational Unit Scope field */}
        <FieldWrapper
          id={scopeId}
          label="Organizational Unit Scope"
          error={scopeError}
        >
          <Input
            id={scopeId}
            type="text"
            value={formData.orgHierarchyScope || ''}
            onChange={handleScopeChange}
            onBlur={handleScopeBlur}
            disabled={disabled}
            placeholder="e.g., org.facility.department (optional)"
            aria-describedby={scopeError ? `${scopeId}-error` : `${scopeId}-help`}
            aria-invalid={!!scopeError}
            className={cn(scopeError && 'border-red-500 focus:ring-red-500')}
          />
          <p id={`${scopeId}-help`} className="text-xs text-gray-500 mt-1">
            Leave empty for organization-wide scope. Use ltree path to limit to specific unit.
          </p>
        </FieldWrapper>
      </div>
    );
  }
);

RoleFormFields.displayName = 'RoleFormFields';
