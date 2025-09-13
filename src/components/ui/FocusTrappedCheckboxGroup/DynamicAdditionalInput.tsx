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
  const [focusSource, setFocusSource] = useState<FocusSource>('programmatic');
  const hasInitiallyFocused = useRef(false);
  
  // Component lifecycle logging
  useEffect(() => {
    console.log('[DynamicInput] Component mounted for checkbox:', checkboxId, 'with value:', currentValue);
    return () => {
      console.log('[DynamicInput] Component unmounting for checkbox:', checkboxId);
    };
  }, [checkboxId]);
  
  // Update initial value when it changes externally
  useEffect(() => {
    console.log('[DynamicInput] Initial value updated:', currentValue, 'for checkbox:', checkboxId);
    initialValueRef.current = currentValue;
  }, [currentValue, checkboxId]);
  
  // Enhanced auto-focus logic respecting focus intent
  useEffect(() => {
    // Only auto-focus if:
    // 1. Intent is for this input
    // 2. Source was keyboard or programmatic (not mouse - they already focused it)
    // 3. Haven't already auto-focused
    if (
      focusIntent?.type === 'input' && 
      focusIntent.checkboxId === checkboxId &&
      focusIntent.source !== 'mouse' &&
      !hasInitiallyFocused.current &&
      shouldFocus && 
      inputRef.current && 
      strategy.focusManagement?.autoFocus
    ) {
      console.log('[DynamicInput] Auto-focusing based on intent (non-mouse)');
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
        console.log('[DynamicInput] Tab pressed - preventing default');
        // Always prevent Tab from leaving the input
        e.preventDefault();
        e.stopPropagation(); // Don't let container handle it
        console.log('[DynamicInput] After preventDefault:', e.defaultPrevented);
        
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
            return;
          }
        }
        
        // For single fields, show hint
        setShowHint(true);
        console.log('[DynamicInput] Hint shown');
        break;
        
      case 'Enter':
        console.log('[DynamicInput] Enter pressed - intentional exit with save');
        e.preventDefault();
        if (onIntentionalExit) {
          onIntentionalExit(checkboxId, true);
        }
        break;
        
      case 'Escape':
        console.log('[DynamicInput] Escape pressed - intentional exit without save');
        e.preventDefault();
        const originalValue = initialValueRef.current;
        console.log('[DynamicInput] Restoring from', currentValue, 'to', originalValue);
        // Restore original value
        onDataChange(originalValue || null);
        if (onIntentionalExit) {
          onIntentionalExit(checkboxId, false);
        }
        break;
        
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
    
    console.log('[DynamicInput] Blur event:', {
      checkboxId,
      relatedTarget: relatedTarget?.tagName,
      focusSource,
      currentIntent: focusIntent?.type
    });
    
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
      'aria-describedby': componentProps.helpText ? `${checkboxId}-help` : undefined,
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
      className="additional-input-container relative"
      role="group"
      aria-labelledby={`${checkboxId}-label`}
    >
      {component}
      
      {/* Tab key hint */}
      {showHint && (
        <div 
          className="absolute -bottom-6 left-8 text-xs text-gray-600 bg-white px-2 py-1 rounded shadow-sm border border-gray-200 z-10"
          role="status"
          aria-live="polite"
        >
          Press Enter to save or Esc to cancel
        </div>
      )}
      
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