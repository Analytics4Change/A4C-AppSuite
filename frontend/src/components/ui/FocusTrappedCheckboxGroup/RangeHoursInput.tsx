import React, { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { useEnterAsTabForRangeInput } from '@/hooks/useEnterAsTab';

interface RangeHoursInputProps {
  value: { min: number | null; max: number | null } | null;
  onChange: (value: { min: number | null; max: number | null } | null) => void;
  onBlur?: (e: React.FocusEvent) => void;
  onFocus?: (e: React.FocusEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onSelectionChange?: (checkboxId: string, checked: boolean) => void;
  checkboxId?: string;
  disabled?: boolean;
  minPlaceholder?: string;
  maxPlaceholder?: string;
  ariaLabel?: string;
  helpText?: string;
  tabIndex?: number;
}

export const RangeHoursInput: React.FC<RangeHoursInputProps> = ({
  value,
  onChange,
  onBlur,
  onFocus,
  onKeyDown,
  onSelectionChange,
  checkboxId,
  disabled = false,
  minPlaceholder = 'Min',
  maxPlaceholder = 'Max',
  ariaLabel: _ariaLabel = 'Enter hour range',
  helpText,
  tabIndex
}) => {
  const [localMin, setLocalMin] = useState<string>(value?.min?.toString() || '');
  const [localMax, setLocalMax] = useState<string>(value?.max?.toString() || '');
  const [validationError, setValidationError] = useState<string>('');
  const [_isValid, setIsValid] = useState(false);
  const minInputRef = useRef<HTMLInputElement>(null);
  const maxInputRef = useRef<HTMLInputElement>(null);
  
  // Use the specialized hook for Tab/Enter handling
  const {
    handleMinKeyDown,
    handleMaxKeyDown,
    handleMinFocus,
    handleMaxFocus,
    handleBlur: handleInputBlurInternal,
    focusedInput
  } = useEnterAsTabForRangeInput({
    minInputRef,
    maxInputRef,
    checkboxId: checkboxId || '',
    localMin,
    localMax,
    onValidChange: (values) => {
      onChange({ min: values.min, max: values.max });
    },
    onEscape: () => {
      // Clear inputs and values
      setLocalMin('');
      setLocalMax('');
      setValidationError('');
      setIsValid(false);
      onChange({ min: null, max: null });
      
      // Deselect the checkbox and request focus return
      if (onSelectionChange && checkboxId) {
        // First, request parent to focus the checkbox
        const checkboxElement = document.querySelector(`[data-checkbox-id="${checkboxId}"]`) as HTMLElement;
        if (checkboxElement) {
          checkboxElement.focus();
        }
        
        // Then deselect it (this will remove the input)
        setTimeout(() => {
          onSelectionChange(checkboxId, false);
        }, 0);
      }
    },
    enabled: !disabled
  });
  
  // Update local state when value prop changes
  useEffect(() => {
    setLocalMin(value?.min?.toString() || '');
    setLocalMax(value?.max?.toString() || '');
    // Check if existing values are valid
    if (value?.min && value?.max) {
      setIsValid(value.min < value.max);
    } else {
      setIsValid(false);
    }
    setValidationError('');
  }, [value]);
  
  // Auto-focus first input on mount if not disabled and no existing values
  useEffect(() => {
    if (!disabled && !value?.min && !value?.max) {
      minInputRef.current?.focus();
    }
  }, [disabled, value]);
  
  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalMin(val);
    
    // Clear validation error when user starts typing again
    if (validationError) {
      setValidationError('');
    }
    
    // Update parent with current values
    const minNum = val ? Number(val) : null;
    const maxNum = localMax ? Number(localMax) : null;
    
    // Validate if both values present
    if (minNum !== null && maxNum !== null) {
      if (minNum >= maxNum) {
        setValidationError(`Minimum (${minNum}) must be less than maximum (${maxNum})`);
        setIsValid(false);
      } else {
        setValidationError('');
        setIsValid(true);
      }
    }
    
    onChange({ min: minNum, max: maxNum });
  };
  
  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalMax(val);
    
    const minNum = localMin ? Number(localMin) : null;
    const maxNum = val ? Number(val) : null;
    
    // Validate min < max when both values present
    if (minNum !== null && maxNum !== null) {
      if (minNum >= maxNum) {
        setValidationError(`Minimum (${minNum}) must be less than maximum (${maxNum})`);
        setIsValid(false);
        // Don't clear inputs - let user fix them
      } else {
        setValidationError('');
        setIsValid(true);
      }
    } else {
      setIsValid(false);
    }
    
    onChange({ min: minNum, max: maxNum });
  };
  
  // Wrapper functions to integrate with the component's props
  const handleMinKeyDownWrapper = (e: React.KeyboardEvent<HTMLInputElement>) => {
    handleMinKeyDown(e);
    // Pass through to parent for other keys
    if (onKeyDown && e.key !== 'Tab' && e.key !== 'Enter' && e.key !== 'Escape') {
      onKeyDown(e);
    }
  };
  
  const handleMaxKeyDownWrapper = (e: React.KeyboardEvent<HTMLInputElement>) => {
    handleMaxKeyDown(e);
    // Pass through to parent for other keys
    if (onKeyDown && e.key !== 'Tab' && e.key !== 'Enter' && e.key !== 'Escape') {
      onKeyDown(e);
    }
  };
  
  const handleMinFocusWrapper = (e: React.FocusEvent<HTMLInputElement>) => {
    handleMinFocus();
    if (onFocus) onFocus(e);
  };
  
  const handleMaxFocusWrapper = (e: React.FocusEvent<HTMLInputElement>) => {
    handleMaxFocus();
    if (onFocus) onFocus(e);
  };
  
  const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    handleInputBlurInternal();
    if (onBlur) onBlur(e);
  };
  
  // Determine if inputs are complete and valid
  const inputsComplete = localMin && localMax;
  const showHelpText = focusedInput && !validationError;
  
  return (
    <div 
      role="group" 
      aria-label="Hour range selection"
      className="flex flex-col gap-2 mt-2 ml-8"
    >
      <div className="flex items-center gap-2">
        <Input
          ref={minInputRef}
          type="number"
          value={localMin}
          onChange={handleMinChange}
          onKeyDown={handleMinKeyDownWrapper}
          onKeyDownCapture={handleMinKeyDownWrapper}
          onFocus={handleMinFocusWrapper}
          onBlur={handleInputBlur}
          min={1}
          max={24}
          step={1}
          placeholder={minPlaceholder}
          aria-label="Minimum hours between doses"
          aria-describedby={validationError ? "range-error" : "range-help-text"}
          aria-invalid={!!validationError}
          aria-valuemin={1}
          aria-valuemax={24}
          aria-valuenow={localMin ? Number(localMin) : undefined}
          className="w-20"
          disabled={disabled}
          tabIndex={tabIndex}
        />
        <span className="text-sm text-gray-600" aria-hidden="true">to</span>
        <Input
          ref={maxInputRef}
          type="number"
          value={localMax}
          onChange={handleMaxChange}
          onKeyDown={handleMaxKeyDownWrapper}
          onKeyDownCapture={handleMaxKeyDownWrapper}
          onFocus={handleMaxFocusWrapper}
          onBlur={handleInputBlur}
          min={1}
          max={24}
          step={1}
          placeholder={maxPlaceholder}
          aria-label="Maximum hours between doses"
          aria-describedby={validationError ? "range-error" : "range-help-text"}
          aria-invalid={!!validationError}
          aria-valuemin={1}
          aria-valuemax={24}
          aria-valuenow={localMax ? Number(localMax) : undefined}
          className="w-20"
          disabled={disabled}
          tabIndex={tabIndex}
        />
        <span className="text-sm text-gray-600" aria-hidden="true">hours</span>
      </div>
      
      {/* Validation error message */}
      {validationError && (
        <p 
          id="range-error"
          className="text-xs text-red-600 font-medium"
          role="alert"
          aria-live="assertive"
        >
          {validationError}
        </p>
      )}
      
      {/* Help text */}
      {showHelpText && (
        <p 
          id="range-help-text" 
          className="text-xs text-gray-500"
          role="status"
        >
          {!inputsComplete
            ? "Enter min hours, then max hours. Tab/Enter to advance. Escape to cancel."
            : _isValid
              ? "Tab/Enter to save, Escape to cancel."
              : "Enter valid range where min < max"}
        </p>
      )}
      
      {/* Additional help text from props */}
      {helpText && !focusedInput && !validationError && (
        <p className="text-xs text-gray-500">{helpText}</p>
      )}
    </div>
  );
};