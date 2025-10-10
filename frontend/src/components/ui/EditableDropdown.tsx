import React, { useState, useRef } from 'react';
import { Edit2 } from 'lucide-react';
import { Label } from './label';
import { EnhancedAutocompleteDropdown } from './EnhancedAutocompleteDropdown';
import { useFocusAdvancement } from '@/hooks/useFocusAdvancement';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('navigation');

interface EditableDropdownProps {
  id: string;
  label: string;
  value: string;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  disabledMessage?: string;
  error?: string;
  tabIndex: number;
  targetTabIndex?: number;
  onChange: (value: string) => void;
  onDropdownOpen?: (elementId: string) => void;
  filterMode?: 'contains' | 'startsWith';
  testIdPrefix?: string;
  className?: string;
  showLabel?: boolean;
}

/**
 * Reusable editable dropdown component that provides:
 * - Edit mode functionality (click to re-edit selected values)
 * - Autocomplete search with unified highlighting behavior
 * - Keyboard navigation
 * - Accessibility support
 * - Visual feedback for selected/editing states
 */
export const EditableDropdown: React.FC<EditableDropdownProps> = ({
  id,
  label,
  value,
  options,
  placeholder = 'Select...',
  disabled = false,
  disabledMessage,
  error,
  tabIndex,
  targetTabIndex,
  onChange,
  onDropdownOpen,
  filterMode = 'contains',
  testIdPrefix,
  className = '',
  showLabel = true
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [internalValue, setInternalValue] = useState(value);

  // Use testIdPrefix or id for test IDs
  const testId = testIdPrefix || id;

  // Focus advancement hook for keyboard navigation
  const focusAdvancement = useFocusAdvancement({
    targetTabIndex: targetTabIndex || tabIndex + 1,
    enabled: !!targetTabIndex
  });

  // Enter edit mode
  const enterEditMode = () => {
    setIsEditing(true);
    setInternalValue(value);
  };

  // Handle selection from dropdown
  const handleSelect = (selectedValue: string) => {
    onChange(selectedValue);
    setInternalValue(selectedValue);
    setIsEditing(false);
    
    // Use focus advancement if configured
    if (targetTabIndex) {
      focusAdvancement.handleSelection(selectedValue, 'keyboard');
    }
  };

  // Handle value change
  const handleChange = (newValue: string) => {
    setInternalValue(newValue);
    if (!value || isEditing) {
      onDropdownOpen?.(`${id}-container`);
    }
  };

  // Handle blur
  const handleBlur = () => {
    if (!value) {
      setIsEditing(false);
    }
  };

  // Handle focus
  const handleFocus = () => {
    if (!disabled && (!value || isEditing)) {
      onDropdownOpen?.(`${id}-container`);
    }
  };

  return (
    <div className="space-y-2">
      {showLabel && (
        <Label htmlFor={id} className="text-base font-medium">
          {label}
          {disabled && disabledMessage && (
            <span className="text-gray-400 text-sm ml-1">{disabledMessage}</span>
          )}
        </Label>
      )}
      
      <div id={`${id}-container`} className="relative">
        {/* Show read-only display when value is selected and not editing */}
        {value && !isEditing ? (
          <div className="relative">
            <div
              className={`w-full px-3 py-2 pr-10 border rounded-md ${
                disabled ? 'cursor-not-allowed opacity-50 bg-gray-100' : 'cursor-pointer border-blue-500 bg-blue-50 hover:bg-blue-100'
              } ${className}`}
              onClick={!disabled ? enterEditMode : undefined}
              tabIndex={disabled ? -1 : tabIndex}
              role="button"
              aria-label={`${label}: ${value}. Click to edit.`}
              onKeyDown={(e) => {
                if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  enterEditMode();
                }
              }}
            >
              {value}
            </div>
            {!disabled && (
              <button
                id={`${id}-edit-button`}
                type="button"
                className="absolute right-1 top-1/2 transform -translate-y-1/2 p-1.5 hover:bg-gray-100 rounded"
                onClick={enterEditMode}
                aria-label={`Edit ${label}`}
                tabIndex={-1}
              >
                <Edit2 className="text-gray-400" size={16} />
              </button>
            )}
          </div>
        ) : (
          /* Show enhanced autocomplete dropdown when editing or no value */
          <EnhancedAutocompleteDropdown
            id={id}
            options={options}
            value={internalValue}
            onChange={handleChange}
            onSelect={handleSelect}
            placeholder={disabled && disabledMessage ? disabledMessage : placeholder}
            disabled={disabled}
            error={!!error}
            tabIndex={tabIndex}
            aria-label={label}
            aria-describedby={error ? `${id}-error` : undefined}
            aria-invalid={!!error}
            autoFocus={isEditing}
            onBlur={handleBlur}
            onFocus={handleFocus}
            allowCustomValue={false}
            filterStrategy={filterMode}
            className={className}
          />
        )}
      </div>
      
      {/* Error message */}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};