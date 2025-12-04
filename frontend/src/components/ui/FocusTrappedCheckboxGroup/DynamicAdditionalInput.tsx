import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DynamicAdditionalInputProps, FocusSource } from './metadata-types';
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
  onSelectionChange,
  tabIndexBase,
  shouldFocus,
  focusIntent,
  onFocusHandled,
  onInputFocus,
  onInputBlur,
  onIntentionalExit,
  onNaturalBlur,
  onDirectFocus
}) => {
  const inputRef = useRef<HTMLElement>(null);
  const initialValueRef = useRef(currentValue);
  const [showHint, setShowHint] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [focusSource, setFocusSource] = useState<FocusSource>('programmatic');
  const [isFocused, setIsFocused] = useState(false);
  const hasInitiallyFocused = useRef(false);
  const [localValue, setLocalValue] = useState(currentValue);
  
  // Component lifecycle logging
  useEffect(() => {
    console.log('[DynamicInput] Component mounted for checkbox:', checkboxId, 'with value:', currentValue);
    return () => {
      console.log('[DynamicInput] Component unmounting for checkbox:', checkboxId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- currentValue is logged on mount only, changes tracked in separate effect
  }, [checkboxId]);
  
  // Update initial value when it changes externally
  useEffect(() => {
    console.log('[DynamicInput] Initial value updated:', currentValue, 'for checkbox:', checkboxId);
    initialValueRef.current = currentValue;
    setLocalValue(currentValue);
  }, [currentValue, checkboxId]);
  
  // Enhanced auto-focus logic respecting focus intent
  useEffect(() => {
    // Handle both regular focus intent and tab-to-input intent
    const shouldAutoFocus = (
      ((focusIntent?.type === 'input' && focusIntent.source !== 'mouse') ||
       (focusIntent?.type === 'tab-to-input')) &&
      focusIntent.checkboxId === checkboxId &&
      !hasInitiallyFocused.current &&
      shouldFocus && 
      inputRef.current && 
      strategy.focusManagement?.autoFocus
    );
    
    if (shouldAutoFocus) {
      console.log('[DynamicInput] Auto-focusing based on intent:', focusIntent?.type);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        hasInitiallyFocused.current = true;
        onFocusHandled();
      });
    }
  }, [focusIntent, checkboxId, shouldFocus, strategy.focusManagement?.autoFocus, onFocusHandled]);
  
  // Reset focus flag on unmount
  useEffect(() => {
    return () => {
      hasInitiallyFocused.current = false;
    };
  }, []);
  
  // Hide hint after delay
  useEffect(() => {
    if (showHint) {
      const timer = setTimeout(() => setShowHint(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [showHint]);
  
  // Hide saved indicator after delay
  useEffect(() => {
    if (showSaved) {
      const timer = setTimeout(() => setShowSaved(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [showSaved]);
  
  // Helper function to announce messages to screen readers
  const announceToScreenReader = (message: string) => {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.className = 'sr-only';
    announcement.textContent = message;
    document.body.appendChild(announcement);
    setTimeout(() => announcement.remove(), 1000);
  };

  // Get dynamic help text based on field state
  const getHelpText = () => {
    const isRequired = strategy.focusManagement?.requiresInput !== false;
    const isEmpty = !localValue;
    
    if (isRequired && isEmpty) {
      return 'Required field. Enter value or press Escape to cancel selection';
    }
    if (!isRequired && isEmpty) {
      return 'Optional field. Press Tab to skip or Enter to save';
    }
    // Field has data (required or optional)
    return 'Press Tab to save and continue or Enter to save and return';
  };
  
  // Auto-save function
  const handleAutoSave = () => {
    if (localValue !== currentValue) {
      console.log('[DynamicInput] Auto-saving value:', localValue);
      onDataChange(localValue);
      setShowSaved(true);
    }
  };
  
  // Enhanced keyboard handler using intentional exit
  const handleKeyDown = (e: React.KeyboardEvent) => {
    console.log('[DynamicInput] KeyDown:', {
      key: e.key,
      keyCode: e.keyCode,
      targetTagName: (e.target as HTMLElement).tagName,
      targetId: (e.target as HTMLElement).id,
      checkboxId,
      currentValue,
      initialValue: initialValueRef.current,
      focusSource,
      isPrevented: e.defaultPrevented,
      bubbles: e.bubbles,
      strategy: strategy.componentType
    });
    
    switch (e.key) {
      case 'Tab':
        console.log('[DynamicInput] Tab pressed - auto-saving and allowing navigation');
        
        // For custom multi-field components (future enhancement)
        if (strategy.componentType === 'custom' && strategy.componentProps.getPeerFields) {
          const fields = strategy.componentProps.getPeerFields();
          if (fields && fields.length > 1) {
            // Navigate between peer fields
            const currentIndex = fields.indexOf(e.target as HTMLElement);
            const nextIndex = e.shiftKey ? 
              (currentIndex - 1 + fields.length) % fields.length :
              (currentIndex + 1) % fields.length;
            fields[nextIndex]?.focus();
            e.preventDefault();
            return;
          }
        }
        
        // Auto-save on Tab
        handleAutoSave();
        
        // For Shift+Tab, return to checkbox
        if (e.shiftKey && onIntentionalExit) {
          console.log('[DynamicInput] Shift+Tab - returning to checkbox');
          e.preventDefault();
          onIntentionalExit(checkboxId, true);
        }
        // Regular Tab - allow natural navigation
        else {
          console.log('[DynamicInput] Tab - allowing natural navigation');
          // Let Tab work naturally to move to next field
        }
        break;
        
      case 'Enter':
        console.log('[DynamicInput] Enter pressed - intentional exit with save');
        e.preventDefault();
        handleAutoSave();
        if (onIntentionalExit) {
          onIntentionalExit(checkboxId, true);
        }
        break;
        
      case 'Escape': {
        console.log('[DynamicInput] Escape pressed - intentional exit without save');
        e.preventDefault();
        const originalValue = initialValueRef.current;
        const isEmpty = !localValue || localValue === '';
        const isRequired = strategy.focusManagement?.requiresInput !== false;

        console.log('[DynamicInput] Escape handler:', {
          isEmpty,
          isRequired,
          localValue,
          originalValue
        });

        if (isEmpty && isRequired) {
          // Deselect the checkbox for empty required fields
          console.log('[DynamicInput] Deselecting checkbox due to empty required field');
          if (onSelectionChange) {
            onSelectionChange(checkboxId, false);
          }
          // Clear the data
          onDataChange(null);
          // Announce the deselection to screen readers
          announceToScreenReader('Selection cancelled, checkbox deselected');
        } else {
          // Restore original value for optional or non-empty fields
          console.log('[DynamicInput] Restoring from', localValue, 'to', originalValue);
          setLocalValue(originalValue);
          onDataChange(originalValue || null);
        }

        if (onIntentionalExit) {
          onIntentionalExit(checkboxId, false);
        }
        break;
      }
        
      default:
        // All other keys work naturally
        console.log('[DynamicInput] Other key pressed:', e.key, '- allowing natural behavior');
        break;
    }
  };
  
  // Track how focus was acquired
  const handleFocus = (e: React.FocusEvent) => {
    const source = e.nativeEvent.detail === 0 ? 'keyboard' : 'mouse';
    setFocusSource(source);
    setIsFocused(true);
    
    console.log('[DynamicInput] Focus acquired via:', source);
    
    // Update intent if user clicked directly on input
    if (source === 'mouse' && focusIntent?.type !== 'input' && onDirectFocus) {
      onDirectFocus(checkboxId);
    }
    
    onInputFocus?.();
  };
  
  // Enhanced blur handler for natural blur
  const handleBlur = (e: React.FocusEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement;
    setIsFocused(false);
    
    console.log('[DynamicInput] Blur event:', {
      checkboxId,
      relatedTarget: relatedTarget?.tagName,
      focusSource,
      currentIntent: focusIntent?.type
    });
    
    // Auto-save on blur (natural navigation away)
    handleAutoSave();
    
    // Only handle as natural blur if not an intentional exit
    if (focusIntent?.type !== 'returning-to-checkbox' && onNaturalBlur) {
      onNaturalBlur(checkboxId, relatedTarget);
    }
    
    onInputBlur?.();
  };
  
  const renderComponent = () => {
    const { componentType, componentProps } = strategy;
    const baseProps = {
      ref: inputRef as any,
      tabIndex: tabIndexBase,
      id: `${checkboxId}-additional-input`,
      'aria-describedby': `${checkboxId}-help`,
      className: 'mt-2 ml-8', // Indent under checkbox
      onKeyDown: handleKeyDown,
      onFocus: handleFocus,
      onBlur: handleBlur,
      onMouseDown: () => setFocusSource('mouse')
    };
    
    switch (componentType) {
      case 'numeric':
        return (
          <div className="flex items-center gap-2">
            <Input
              {...baseProps}
              type="number"
              value={localValue || ''}
              onChange={(e) => setLocalValue(e.target.value ? Number(e.target.value) : null)}
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
            value={localValue || ''}
            onChange={(e) => setLocalValue(e.target.value)}
            placeholder={componentProps.placeholder}
            maxLength={componentProps.maxLength}
            aria-label={componentProps.ariaLabel || 'Enter text'}
            className="mt-2 ml-8 max-w-md"
          />
        );
        
      case 'textarea':
        return (
          <textarea
            {...baseProps}
            value={localValue || ''}
            onChange={(e) => setLocalValue(e.target.value)}
            placeholder={componentProps.placeholder}
            maxLength={componentProps.maxLength}
            rows={isFocused && componentProps.autoResize ? 
              Math.max(componentProps.rows || 2, (localValue || '').split('\n').length) : 
              componentProps.rows || 2}
            aria-label={componentProps.ariaLabel || 'Enter text'}
            className="mt-2 ml-8 max-w-md px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          />
        );
        
      case 'select':
        return (
          <select
            {...baseProps}
            value={localValue || ''}
            onChange={(e) => setLocalValue(e.target.value)}
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
            value={localValue || ''}
            onChange={(e) => setLocalValue(e.target.value)}
            aria-label={componentProps.ariaLabel || 'Select time'}
            className="w-32 mt-2 ml-8"
          />
        );
        
      case 'date':
        return (
          <Input
            {...baseProps}
            type="date"
            value={localValue || ''}
            onChange={(e) => setLocalValue(e.target.value)}
            min={componentProps.min}
            max={componentProps.max}
            aria-label={componentProps.ariaLabel || 'Select date'}
            className="w-40 mt-2 ml-8"
          />
        );
        
      case 'custom': {
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
            value={localValue}
            onChange={setLocalValue}
            onSelectionChange={onSelectionChange}
            checkboxId={checkboxId}
          />
        );
      }
        
      default:
        console.warn(`Unknown component type: ${componentType}`);
        return null;
    }
  };
  
  const component = renderComponent();
  if (!component) return null;
  
  return (
    <div 
      className="additional-input-container relative"
      role="group"
      aria-labelledby={`${checkboxId}-label`}
    >
      {component}
      
      {/* Tab key hint for required fields */}
      {showHint && strategy.focusManagement?.requiresInput && (
        <div 
          className="absolute -bottom-6 left-8 text-xs text-gray-600 bg-white px-2 py-1 rounded shadow-sm border border-gray-200 z-10"
          role="status"
          aria-live="polite"
        >
          Press Tab to continue or Enter to save and return
        </div>
      )}
      
      {/* Saved indicator */}
      {showSaved && (
        <div 
          className="absolute -top-6 left-8 text-xs text-green-600 bg-white px-2 py-1 rounded shadow-sm border border-green-200 z-10"
          role="status"
          aria-live="polite"
        >
          ✓ Saved
        </div>
      )}
      
      {/* Dynamic help text */}
      <p 
        id={`${checkboxId}-help`}
        className="ml-8 mt-1 text-sm text-gray-600"
      >
        {getHelpText()}
      </p>
      
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