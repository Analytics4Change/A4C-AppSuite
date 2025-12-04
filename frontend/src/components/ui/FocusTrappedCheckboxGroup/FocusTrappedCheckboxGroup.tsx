import React, { useState, useRef, useEffect, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '../button';
import { Checkbox } from '../checkbox';
import { cn } from '../utils';
import { FocusTrappedCheckboxGroupProps } from './types';

/**
 * Focus-Trapped Checkbox Group Component
 * 
 * A reusable, WCAG-compliant checkbox group with focus trapping, 
 * edit mode, and collapsibility.
 * 
 * Keyboard Navigation:
 * - Tab: Navigate between checkbox group, Cancel, and Continue buttons
 * - Arrow Up/Down: Navigate between checkboxes when group has focus
 * - Space: Toggle checkbox selection
 * - Enter: Toggle checkbox or activate button
 * - Escape: Trigger cancel action
 * - Home: Jump to first checkbox
 * - End: Jump to last checkbox
 */
export const FocusTrappedCheckboxGroup = observer(({
  id,
  title,
  items,
  selectedIds,
  onSelectionChange,
  onCancel,
  onContinue,
  isCollapsible = false,
  initialExpanded = true,
  className,
  baseTabIndex,
  nextTabIndex,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  isRequired = false,
  hasError = false,
  errorMessage,
  errorMessageId,
  helpText,
  helpTextId,
  instructionsId
}: FocusTrappedCheckboxGroupProps) => {
  // State
  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [isNavigatingWithArrows, setIsNavigatingWithArrows] = useState(false);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const checkboxGroupRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const checkboxRefs = useRef<(HTMLDivElement | null)[]>([]);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Store previous focus when component mounts
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    return () => {
      // Restore focus when component unmounts
      if (previousFocusRef.current && previousFocusRef.current.isConnected) {
        previousFocusRef.current.focus();
      }
    };
  }, []);

  // We'll handle focus trap manually for better control
  // Track which element has focus (0: checkbox group, 1: cancel, 2: continue)
  const [focusedElement, setFocusedElement] = useState(0);
  
  // Handle Tab key for focus trap
  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isExpanded) return;
    
    console.log('[FocusTrappedCheckboxGroup] Key pressed:', e.key, 'Current focused element:', focusedElement);
    
    if (e.key === 'Tab') {
      e.preventDefault(); // Always prevent default Tab behavior
      e.stopPropagation();
      
      if (e.shiftKey) {
        // Shift+Tab: go backwards
        const nextFocus = focusedElement === 0 ? 2 : focusedElement - 1;
        setFocusedElement(nextFocus);
        console.log('[FocusTrappedCheckboxGroup] Shift+Tab: Moving focus to element', nextFocus);
        
        // Focus the appropriate element
        if (nextFocus === 0) {
          checkboxGroupRef.current?.focus();
        } else if (nextFocus === 1) {
          cancelButtonRef.current?.focus();
        } else if (nextFocus === 2) {
          continueButtonRef.current?.focus();
        }
      } else {
        // Tab: go forwards
        const nextFocus = (focusedElement + 1) % 3;
        setFocusedElement(nextFocus);
        console.log('[FocusTrappedCheckboxGroup] Tab: Moving focus to element', nextFocus);
        
        // Focus the appropriate element
        if (nextFocus === 0) {
          checkboxGroupRef.current?.focus();
        } else if (nextFocus === 1) {
          cancelButtonRef.current?.focus();
        } else if (nextFocus === 2) {
          continueButtonRef.current?.focus();
        }
      }
    } else if (e.key === 'Escape') {
      console.log('[FocusTrappedCheckboxGroup] Escape pressed: Cancelling');
      e.preventDefault();
      e.stopPropagation();
      setIsExpanded(false);
      onCancel();
      // Move focus to the next element in tab order
      if (nextTabIndex) {
        setTimeout(() => {
          const nextElement = document.querySelector(`[tabindex="${nextTabIndex}"]`) as HTMLElement;
          if (nextElement) {
            console.log('[FocusTrappedCheckboxGroup] Moving focus to next element:', nextTabIndex);
            nextElement.focus();
          }
        }, 50);
      }
    }
  }, [isExpanded, focusedElement, onCancel, nextTabIndex]);

  // Handle checkbox selection
  const handleToggle = useCallback((itemId: string) => {
    const newSelectedIds = selectedIds.includes(itemId)
      ? selectedIds.filter(id => id !== itemId)
      : [...selectedIds, itemId];
    onSelectionChange(newSelectedIds);
  }, [selectedIds, onSelectionChange]);

  // Handle keyboard navigation within checkboxes
  const handleCheckboxKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isExpanded) return;
    
    console.log('[FocusTrappedCheckboxGroup] Checkbox key:', e.key);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        setIsNavigatingWithArrows(true);
        setFocusedIndex(prev => (prev + 1) % items.length);
        break;

      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        setIsNavigatingWithArrows(true);
        setFocusedIndex(prev => (prev - 1 + items.length) % items.length);
        break;

      case 'Home':
        e.preventDefault();
        e.stopPropagation();
        setIsNavigatingWithArrows(true);
        setFocusedIndex(0);
        break;

      case 'End':
        e.preventDefault();
        e.stopPropagation();
        setIsNavigatingWithArrows(true);
        setFocusedIndex(items.length - 1);
        break;

      case ' ':
      case 'Space':
        e.preventDefault();
        e.stopPropagation();
        handleToggle(items[focusedIndex].id);
        break;

      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        handleToggle(items[focusedIndex].id);
        break;

      case 'Tab':
        // Don't handle Tab here - let container handler deal with it
        // But DO set that we're no longer using arrow navigation
        setIsNavigatingWithArrows(false);
        break;
    }
  }, [isExpanded, items, focusedIndex, handleToggle]);

  // Focus the appropriate checkbox when using arrow navigation
  useEffect(() => {
    if (isNavigatingWithArrows && checkboxRefs.current[focusedIndex]) {
      checkboxRefs.current[focusedIndex]?.focus();
    }
  }, [focusedIndex, isNavigatingWithArrows]);

  // Handle expand/collapse
  const toggleExpanded = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  // Handle cancel
  const handleCancel = useCallback(() => {
    console.log('[FocusTrappedCheckboxGroup] Cancel pressed, collapsing');
    setIsExpanded(false);
    onCancel();
    // Move focus to the next element in tab order
    if (nextTabIndex) {
      setTimeout(() => {
        const nextElement = document.querySelector(`[tabindex="${nextTabIndex}"]`) as HTMLElement;
        if (nextElement) {
          console.log('[FocusTrappedCheckboxGroup] Moving focus to next element:', nextTabIndex);
          nextElement.focus();
        }
      }, 50);
    }
  }, [onCancel, nextTabIndex]);

  // Handle continue
  const handleContinue = useCallback(() => {
    console.log('[FocusTrappedCheckboxGroup] Continue pressed, collapsing');
    setIsExpanded(false);
    onContinue(selectedIds);
    // Move focus to the next element in tab order
    if (nextTabIndex) {
      setTimeout(() => {
        const nextElement = document.querySelector(`[tabindex="${nextTabIndex}"]`) as HTMLElement;
        if (nextElement) {
          console.log('[FocusTrappedCheckboxGroup] Moving focus to next element:', nextTabIndex);
          nextElement.focus();
        }
      }, 50);
    }
  }, [onContinue, selectedIds, nextTabIndex]);

  // Container classes with glassmorphism
  const containerClasses = cn(
    "glass-card",
    "backdrop-blur-md",
    "bg-white/90",
    "border border-gray-200/50",
    "shadow-lg",
    "rounded-lg",
    "p-4",
    hasError && "border-red-500",
    className
  );

  // Focus ring styling for checkbox items
  const getCheckboxItemClasses = (index: number) => cn(
    "flex items-center gap-3 px-3 py-2 rounded-md",
    "transition-all duration-200",
    "hover:bg-blue-50/50",
    "cursor-pointer",
    index === focusedIndex && isNavigatingWithArrows && "bg-blue-50",
    "focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2",
    "focus-within:bg-blue-50"
  );

  // Build aria-describedby string from multiple IDs
  const buildAriaDescribedBy = () => {
    const ids = [];
    if (ariaDescribedBy) ids.push(ariaDescribedBy);
    if (helpText || helpTextId) ids.push(helpTextId || `${id}-help`);
    if (instructionsId) ids.push(instructionsId);
    if (hasError && (errorMessage || errorMessageId)) {
      ids.push(errorMessageId || `${id}-error`);
    }
    return ids.length > 0 ? ids.join(' ') : undefined;
  };

  // Build aria-labelledby string
  const buildAriaLabelledBy = () => {
    if (ariaLabelledBy) return ariaLabelledBy;
    if (!ariaLabel) return `${id}-title`; // Use internal title element ID
    return undefined;
  };

  return (
    <div 
      ref={containerRef}
      className={containerClasses}
      role="group"
      aria-label={ariaLabel}
      aria-labelledby={buildAriaLabelledBy()}
      aria-describedby={buildAriaDescribedBy()}
      aria-required={isRequired}
      aria-invalid={hasError}
      aria-errormessage={hasError && (errorMessage || errorMessageId) ? (errorMessageId || `${id}-error`) : undefined}
      onKeyDown={handleContainerKeyDown}
    >
      {/* Header */}
      {isCollapsible ? (
        <div
          className="flex items-center justify-between cursor-pointer p-2 -m-2 rounded hover:bg-gray-50/50"
          onClick={toggleExpanded}
          role="button"
          tabIndex={baseTabIndex}
          aria-expanded={isExpanded}
          onFocus={() => {
            console.log('[FocusTrappedCheckboxGroup] Header received focus, expanding');
            if (!isExpanded) {
              setIsExpanded(true);
              // After expansion, focus should move to checkbox group
              setTimeout(() => {
                checkboxGroupRef.current?.focus();
              }, 50);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleExpanded();
            }
          }}
        >
          <div className="flex items-center gap-2">
            {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            <h3 id={`${id}-title`} className="text-base font-medium">
              {title}
              {isRequired && <span className="text-red-500 ml-1">*</span>}
            </h3>
            {!isExpanded && selectedIds.length > 0 && (
              <span className="text-sm text-gray-600">
                ({selectedIds.length} selected)
              </span>
            )}
          </div>
        </div>
      ) : (
        <h3 id={`${id}-title`} className="text-base font-medium mb-3">
          {title}
          {isRequired && <span className="text-red-500 ml-1">*</span>}
        </h3>
      )}

      {/* Help Text */}
      {helpText && (
        <p 
          id={helpTextId || `${id}-help`}
          className="text-sm text-gray-600 mt-2"
        >
          {helpText}
        </p>
      )}

      {/* Error Message */}
      {hasError && errorMessage && (
        <p 
          id={errorMessageId || `${id}-error`}
          className="text-sm text-red-600 mt-2"
          role="alert"
          aria-live="polite"
        >
          {errorMessage}
        </p>
      )}

      {/* Content */}
      {isExpanded && (
        <>
          {/* Checkbox Group */}
          <div
            ref={checkboxGroupRef}
            className="mt-4 space-y-2"
            role="group"
            tabIndex={baseTabIndex}
            onKeyDown={handleCheckboxKeyDown}
            onFocus={() => {
              console.log('[FocusTrappedCheckboxGroup] Checkbox group focused');
              setFocusedElement(0);
              if (!isNavigatingWithArrows) {
                // When tabbing into the group, focus the first selected or first item
                const firstSelectedIndex = items.findIndex(item => 
                  selectedIds.includes(item.id)
                );
                setFocusedIndex(firstSelectedIndex >= 0 ? firstSelectedIndex : 0);
                setIsNavigatingWithArrows(true);
                // Focus the checkbox after state update
                setTimeout(() => {
                  checkboxRefs.current[firstSelectedIndex >= 0 ? firstSelectedIndex : 0]?.focus();
                }, 0);
              }
            }}
          >
            {items.map((item, index) => (
              <div
                key={item.id}
                ref={el => { checkboxRefs.current[index] = el; }}
                className={getCheckboxItemClasses(index)}
                onClick={() => handleToggle(item.id)}
                onFocus={() => {
                  setFocusedIndex(index);
                  setIsNavigatingWithArrows(true);
                }}
                tabIndex={-1} // Managed by arrow navigation
                role="checkbox"
                aria-checked={selectedIds.includes(item.id)}
                aria-label={item.label}
                aria-describedby={item.description ? `${id}-${item.id}-desc` : undefined}
              >
                <Checkbox
                  checked={selectedIds.includes(item.id)}
                  aria-hidden="true" // Hide from screen readers since parent has role
                  tabIndex={-1}
                  onClick={(e) => e.stopPropagation()}
                  disabled={item.disabled}
                  className="focus:ring-0 focus-visible:ring-0"
                />
                <div className="flex-1">
                  <span className={cn(
                    "text-sm select-none",
                    item.disabled && "text-gray-400"
                  )}>
                    {item.label}
                  </span>
                  {item.description && (
                    <p 
                      id={`${id}-${item.id}-desc`}
                      className="text-xs text-gray-500 mt-1"
                    >
                      {item.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-between mt-6 pt-4 border-t border-gray-200/50">
            <Button
              ref={cancelButtonRef}
              variant="outline"
              onClick={handleCancel}
              onFocus={() => {
                console.log('[FocusTrappedCheckboxGroup] Cancel button focused');
                setFocusedElement(1);
              }}
              tabIndex={-1} // We manage focus manually
              className="min-w-[100px]"
            >
              Cancel
            </Button>
            <Button
              ref={continueButtonRef}
              variant="default"
              onClick={handleContinue}
              onFocus={() => {
                console.log('[FocusTrappedCheckboxGroup] Continue button focused');
                setFocusedElement(2);
              }}
              tabIndex={-1} // We manage focus manually
              className="min-w-[100px]"
              disabled={selectedIds.length === 0}
            >
              Continue
            </Button>
          </div>
        </>
      )}
    </div>
  );
});