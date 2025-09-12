import React, { useState, useRef, useCallback, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { EnhancedCheckboxGroupProps } from './metadata-types';
import { DynamicAdditionalInput } from './DynamicAdditionalInput';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

/**
 * Enhanced FocusTrappedCheckboxGroup with support for dynamic additional inputs
 * Maintains focus trap and WCAG compliance while supporting conditional content
 */
export const EnhancedFocusTrappedCheckboxGroup: React.FC<EnhancedCheckboxGroupProps> = observer(({
  id,
  title,
  checkboxes,
  onSelectionChange,
  onAdditionalDataChange,
  onContinue,
  onCancel,
  isCollapsible = true,
  initialExpanded = false,
  baseTabIndex,
  nextTabIndex,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  isRequired = false,
  hasError = false,
  errorMessage,
  helpText,
  continueButtonText = 'Continue',
  cancelButtonText = 'Cancel'
}) => {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  const [focusedElement, setFocusedElement] = useState(0);
  const [focusedCheckboxIndex, setFocusedCheckboxIndex] = useState(0);
  const [focusedCheckboxId, setFocusedCheckboxId] = useState<string | null>(null);
  const [additionalData, setAdditionalData] = useState(new Map<string, any>());
  
  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLButtonElement>(null);
  const checkboxRefs = useRef<Map<string, HTMLElement>>(new Map());
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  
  // Calculate total focusable elements including dynamic inputs
  const getFocusableCount = useCallback(() => {
    let count = 3; // Header/checkboxes section, Cancel, Continue
    checkboxes.forEach(cb => {
      if (cb.checked && cb.requiresAdditionalInput) {
        count++; // Add one for each additional input
      }
    });
    return count;
  }, [checkboxes]);
  
  // Handle checkbox change
  const handleCheckboxChange = useCallback((checkboxId: string, checked: boolean) => {
    onSelectionChange(checkboxId, checked);
    
    // Clear additional data if unchecked
    if (!checked) {
      setAdditionalData(prev => {
        const newMap = new Map(prev);
        newMap.delete(checkboxId);
        return newMap;
      });
      if (onAdditionalDataChange) {
        onAdditionalDataChange(checkboxId, null);
      }
    } else {
      // If checkbox requires additional input, prepare for focus
      const checkbox = checkboxes.find(cb => cb.id === checkboxId);
      if (checkbox?.requiresAdditionalInput) {
        setFocusedCheckboxId(checkboxId);
      }
    }
  }, [checkboxes, onSelectionChange, onAdditionalDataChange]);
  
  // Handle additional data change with immutable updates
  const handleAdditionalDataChange = useCallback((checkboxId: string, data: any) => {
    // Use immutable update to trigger re-render
    setAdditionalData(prev => {
      const newMap = new Map(prev);
      if (data === null || data === undefined) {
        newMap.delete(checkboxId);
      } else {
        newMap.set(checkboxId, data);
      }
      return newMap; // Return new Map instance for React to detect change
    });
    
    if (onAdditionalDataChange) {
      onAdditionalDataChange(checkboxId, data);
    }
  }, [onAdditionalDataChange]);
  
  // Handle continue action
  const handleContinue = useCallback(() => {
    const selectedIds = checkboxes
      .filter(cb => cb.checked)
      .map(cb => cb.id);
    onContinue(selectedIds, additionalData);
    setIsExpanded(false);
  }, [checkboxes, onContinue, additionalData]);
  
  // Handle cancel action
  const handleCancel = useCallback(() => {
    onCancel();
    setIsExpanded(false);
    if (nextTabIndex !== undefined) {
      const nextElement = document.querySelector(`[tabindex="${nextTabIndex}"]`) as HTMLElement;
      nextElement?.focus();
    }
  }, [onCancel, nextTabIndex]);
  
  // Handle keyboard navigation within the focus trap
  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isExpanded) return;
    
    // Tab key - moves between sections only
    if (e.key === 'Tab') {
      e.preventDefault();
      // 0: checkbox group, 1: cancel, 2: continue
      const sectionCount = 3;
      const nextSection = e.shiftKey ? 
        (focusedElement - 1 + sectionCount) % sectionCount :
        (focusedElement + 1) % sectionCount;
      
      setFocusedElement(nextSection);
      
      if (nextSection === 0) {
        // Focus the currently selected checkbox
        const checkboxElements = containerRef.current?.querySelectorAll('[role="checkbox"]');
        if (checkboxElements && checkboxElements[focusedCheckboxIndex]) {
          (checkboxElements[focusedCheckboxIndex] as HTMLElement).focus();
        }
      } else if (nextSection === 1) {
        cancelButtonRef.current?.focus();
      } else if (nextSection === 2) {
        continueButtonRef.current?.focus();
      }
    }
    
    // Arrow keys - navigate within checkboxes when focused on checkbox group
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && focusedElement === 0) {
      e.preventDefault();
      const direction = e.key === 'ArrowDown' ? 1 : -1;
      const newIndex = (focusedCheckboxIndex + direction + checkboxes.length) % checkboxes.length;
      setFocusedCheckboxIndex(newIndex);
      
      // Focus the checkbox at new index
      const checkboxElements = containerRef.current?.querySelectorAll('[role="checkbox"]');
      if (checkboxElements && checkboxElements[newIndex]) {
        (checkboxElements[newIndex] as HTMLElement).focus();
      }
    }
    
    // Space key - toggle checkbox when in checkbox group
    else if (e.key === ' ' && focusedElement === 0) {
      e.preventDefault();
      const checkbox = checkboxes[focusedCheckboxIndex];
      if (checkbox && !checkbox.disabled) {
        handleCheckboxChange(checkbox.id, !checkbox.checked);
      }
    }
    
    // Escape key
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleCancel();
    }
  }, [isExpanded, focusedElement, focusedCheckboxIndex, checkboxes, handleCheckboxChange, handleCancel]);
  
  // Handle header focus to expand
  const handleHeaderFocus = useCallback(() => {
    if (!isExpanded && isCollapsible) {
      setIsExpanded(true);
    }
  }, [isExpanded, isCollapsible]);
  
  // Handle header click
  const handleHeaderClick = useCallback(() => {
    if (isCollapsible) {
      setIsExpanded(!isExpanded);
    }
  }, [isCollapsible, isExpanded]);
  
  // Focus management when expanding
  useEffect(() => {
    if (isExpanded && containerRef.current) {
      // Use requestAnimationFrame to ensure DOM is ready (Radix components need a tick)
      requestAnimationFrame(() => {
        const checkboxElements = containerRef.current?.querySelectorAll('[role="checkbox"]');
        if (checkboxElements && checkboxElements[0]) {
          (checkboxElements[0] as HTMLElement).focus();
          setFocusedElement(0);
          setFocusedCheckboxIndex(0);
        }
      });
    }
  }, [isExpanded]);
  
  return (
    <div
      ref={containerRef}
      className="focus-trapped-checkbox-group"
      onKeyDown={handleContainerKeyDown}
      role="group"
      aria-labelledby={ariaLabelledBy || `${id}-title`}
      aria-describedby={ariaDescribedBy || (helpText ? `${id}-help` : undefined)}
      aria-required={isRequired}
      aria-invalid={hasError}
    >
      {/* Header */}
      <button
        ref={headerRef}
        id={`${id}-title`}
        className="w-full flex items-center justify-between p-4 bg-white/70 backdrop-blur-sm border border-gray-200 rounded-t-lg hover:bg-white/80 transition-all"
        onClick={handleHeaderClick}
        onFocus={handleHeaderFocus}
        onKeyDown={(e) => {
          // When expanded, arrow keys move focus into checkbox group
          if (isExpanded && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            e.stopPropagation();
            
            // Move focus to first checkbox
            requestAnimationFrame(() => {
              const checkboxElements = containerRef.current?.querySelectorAll('[role="checkbox"]');
              if (checkboxElements && checkboxElements[0]) {
                (checkboxElements[0] as HTMLElement).focus();
                setFocusedElement(0);
                setFocusedCheckboxIndex(0);
              }
            });
          }
          // Let other keys bubble up to container handler
        }}
        tabIndex={baseTabIndex}
        aria-expanded={isExpanded}
        aria-controls={`${id}-content`}
      >
        <span className="text-lg font-medium">{title}</span>
        {isCollapsible && (
          isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />
        )}
      </button>
      
      {/* Content */}
      {isExpanded && (
        <div
          id={`${id}-content`}
          className="p-6 bg-white/50 backdrop-blur-sm border-x border-b border-gray-200 rounded-b-lg"
        >
          {/* Help text */}
          {helpText && (
            <p id={`${id}-help`} className="mb-4 text-sm text-gray-600">
              {helpText}
            </p>
          )}
          
          {/* Error message */}
          {hasError && errorMessage && (
            <p className="mb-4 text-sm text-red-600" role="alert">
              {errorMessage}
            </p>
          )}
          
          {/* Checkboxes with dynamic content */}
          <div className="space-y-3 mb-6">
            {checkboxes.map((checkbox, index) => (
              <div key={checkbox.id} className="space-y-2">
                <label 
                  id={`${checkbox.id}-label`}
                  className="flex items-start space-x-3 cursor-pointer p-2 rounded hover:bg-gray-50"
                >
                  <Checkbox
                    ref={(el) => {
                      if (el) checkboxRefs.current.set(checkbox.id, el as HTMLElement);
                    }}
                    checked={checkbox.checked}
                    disabled={checkbox.disabled}
                    onCheckedChange={(checked) => handleCheckboxChange(checkbox.id, checked as boolean)}
                    tabIndex={focusedElement === 0 && index === focusedCheckboxIndex ? 0 : -1}
                    onFocus={() => setFocusedCheckboxIndex(index)}
                    aria-label={checkbox.label}
                    aria-describedby={checkbox.description ? `${checkbox.id}-desc` : undefined}
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium">{checkbox.label}</span>
                    {checkbox.description && (
                      <p id={`${checkbox.id}-desc`} className="text-xs text-gray-600 mt-1">
                        {checkbox.description}
                      </p>
                    )}
                  </div>
                </label>
                
                {/* Dynamic additional input */}
                {checkbox.checked && checkbox.requiresAdditionalInput && checkbox.additionalInputStrategy && (
                  <DynamicAdditionalInput
                    strategy={checkbox.additionalInputStrategy}
                    checkboxId={checkbox.id}
                    currentValue={additionalData.get(checkbox.id)}
                    onDataChange={(data) => handleAdditionalDataChange(checkbox.id, data)}
                    tabIndexBase={-1} // Managed by focus trap
                    shouldFocus={focusedCheckboxId === checkbox.id}
                    onFocusHandled={() => setFocusedCheckboxId(null)}
                  />
                )}
              </div>
            ))}
          </div>
          
          {/* Action buttons */}
          <div className="flex justify-end gap-3">
            <Button
              ref={cancelButtonRef}
              variant="outline"
              onClick={handleCancel}
              tabIndex={-1}
              className="min-w-[100px]"
            >
              {cancelButtonText}
            </Button>
            <Button
              ref={continueButtonRef}
              variant="default"
              onClick={handleContinue}
              tabIndex={-1}
              className="min-w-[100px]"
              disabled={checkboxes.filter(cb => cb.checked).length === 0}
            >
              {continueButtonText}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
});