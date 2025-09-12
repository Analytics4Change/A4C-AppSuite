import React, { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { DynamicAdditionalInputProps } from './metadata-types';
import { Input } from '@/components/ui/input';

/**
 * Component that dynamically renders additional input fields based on strategy configuration
 * Maintains WCAG compliance and proper focus management
 */
export const DynamicAdditionalInput: React.FC<DynamicAdditionalInputProps> = observer(({
  strategy,
  checkboxId,
  currentValue,
  onDataChange,
  tabIndexBase,
  shouldFocus,
  onFocusHandled
}) => {
  const inputRef = useRef<HTMLElement>(null);
  
  // Handle auto-focus when component appears
  useEffect(() => {
    if (shouldFocus && inputRef.current && strategy.focusManagement?.autoFocus) {
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        onFocusHandled();
      });
    }
  }, [shouldFocus, strategy.focusManagement?.autoFocus, onFocusHandled]);
  
  const renderComponent = () => {
    const { componentType, componentProps } = strategy;
    const baseProps = {
      ref: inputRef as any,
      tabIndex: tabIndexBase,
      id: `${checkboxId}-additional-input`,
      'aria-describedby': componentProps.helpText ? `${checkboxId}-help` : undefined,
      className: 'mt-2 ml-8' // Indent under checkbox
    };
    
    switch (componentType) {
      case 'numeric':
        return (
          <div className="flex items-center gap-2">
            <Input
              {...baseProps}
              type="number"
              value={currentValue || ''}
              onChange={(e) => onDataChange(e.target.value ? Number(e.target.value) : null)}
              min={componentProps.min}
              max={componentProps.max}
              step={componentProps.step || 1}
              placeholder={componentProps.placeholder}
              aria-label={componentProps.ariaLabel || 'Enter number'}
              className="w-24 mt-2 ml-8"
            />
            {componentProps.suffix && (
              <span className="text-sm text-gray-600 mt-2">{componentProps.suffix}</span>
            )}
          </div>
        );
        
      case 'text':
        return (
          <Input
            {...baseProps}
            type="text"
            value={currentValue || ''}
            onChange={(e) => onDataChange(e.target.value)}
            placeholder={componentProps.placeholder}
            maxLength={componentProps.maxLength}
            aria-label={componentProps.ariaLabel || 'Enter text'}
            className="mt-2 ml-8 max-w-md"
          />
        );
        
      case 'select':
        return (
          <select
            {...baseProps}
            value={currentValue || ''}
            onChange={(e) => onDataChange(e.target.value)}
            aria-label={componentProps.ariaLabel || 'Select option'}
            className="mt-2 ml-8 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Select...</option>
            {componentProps.options?.map((opt: { value: string; label: string }) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        );
        
      case 'time':
        return (
          <Input
            {...baseProps}
            type="time"
            value={currentValue || ''}
            onChange={(e) => onDataChange(e.target.value)}
            aria-label={componentProps.ariaLabel || 'Select time'}
            className="w-32 mt-2 ml-8"
          />
        );
        
      case 'date':
        return (
          <Input
            {...baseProps}
            type="date"
            value={currentValue || ''}
            onChange={(e) => onDataChange(e.target.value)}
            min={componentProps.min}
            max={componentProps.max}
            aria-label={componentProps.ariaLabel || 'Select date'}
            className="w-40 mt-2 ml-8"
          />
        );
        
      case 'custom':
        // For custom components, pass all necessary props
        const CustomComponent = componentProps.component;
        if (!CustomComponent) {
          console.error(`Custom component not provided for checkbox ${checkboxId}`);
          return null;
        }
        return (
          <CustomComponent
            {...baseProps}
            {...componentProps}
            value={currentValue}
            onChange={onDataChange}
          />
        );
        
      default:
        console.warn(`Unknown component type: ${componentType}`);
        return null;
    }
  };
  
  const component = renderComponent();
  if (!component) return null;
  
  return (
    <div 
      className="additional-input-container"
      role="group"
      aria-labelledby={`${checkboxId}-label`}
    >
      {component}
      
      {/* Help text if provided */}
      {strategy.componentProps.helpText && (
        <p 
          id={`${checkboxId}-help`}
          className="ml-8 mt-1 text-sm text-gray-600"
        >
          {strategy.componentProps.helpText}
        </p>
      )}
      
      {/* Validation error display */}
      {strategy.componentProps.errorMessage && (
        <p 
          className="ml-8 mt-1 text-sm text-red-600"
          role="alert"
        >
          {strategy.componentProps.errorMessage}
        </p>
      )}
    </div>
  );
});