import { useCallback, useEffect, useState } from 'react';
import { useFocusBehavior } from '@/contexts/FocusBehaviorContext';

/**
 * Custom hook that makes Enter key behave like Tab for focus advancement
 * Useful for input fields where Enter should move to the next field
 * 
 * @param nextTabIndex - The tabIndex of the next element to focus
 * @param enabled - Whether the behavior is enabled (default: true)
 * @returns onKeyDown handler to attach to the input
 */
export function useEnterAsTab(nextTabIndex: number, enabled: boolean = true) {
  // Register this behavior with the focus context
  const isActive = useFocusBehavior('enter-as-tab', enabled);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Only handle if behavior is active
    if (!isActive || !enabled) {
      return;
    }

    // Make Enter act like Tab for focus advancement
    if (e.key === 'Enter') {
      e.preventDefault();
      
      // Find the next element by tabIndex
      const nextElement = document.querySelector(`[tabIndex="${nextTabIndex}"]`) as HTMLElement;
      
      if (nextElement) {
        nextElement.focus();
        
        // If it's an input, select all text for easy replacement
        if (nextElement instanceof HTMLInputElement) {
          nextElement.select();
        }
      }
    }
  }, [nextTabIndex, isActive, enabled]);

  // No longer need to warn about conflicts since multiple components can use enter-as-tab

  return handleKeyDown;
}

/**
 * Special variant for RangeHoursInput that makes Tab behave exactly like Enter
 * Supports validation before advancing and special escape handling
 * 
 * @param config - Configuration object for the behavior
 * @returns handlers object with onKeyDown and focus state
 */
export function useEnterAsTabForRangeInput(config: {
  minInputRef: React.RefObject<HTMLInputElement | null>;
  maxInputRef: React.RefObject<HTMLInputElement | null>;
  checkboxId: string;
  localMin: string;
  localMax: string;
  onValidChange: (value: { min: number; max: number }) => void;
  onEscape: () => void;
  enabled?: boolean;
}) {
  const { 
    minInputRef, 
    maxInputRef, 
    checkboxId,
    localMin,
    localMax,
    onValidChange,
    onEscape,
    enabled = true 
  } = config;
  
  // Register this behavior with the focus context
  const isActive = useFocusBehavior('enter-as-tab', enabled);
  const [focusedInput, setFocusedInput] = useState<'min' | 'max' | null>(null);
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>, inputType: 'min' | 'max') => {
    // Only handle if behavior is active
    if (!isActive || !enabled) {
      return;
    }
    
    // Handle Enter OR Tab key - same behavior
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault(); // Prevent default for both keys
      
      if (inputType === 'min') {
        // In min input: advance to max if valid
        if (localMin && Number(localMin) >= 1 && Number(localMin) <= 24) {
          maxInputRef.current?.focus();
        }
        return;
      }
      
      if (inputType === 'max') {
        // In max input: save and exit if both valid
        const minNum = localMin ? Number(localMin) : null;
        const maxNum = localMax ? Number(localMax) : null;
        
        if (minNum && maxNum && minNum < maxNum) {
          // Valid - save values and exit
          onValidChange({ min: minNum, max: maxNum });
          
          // Focus the parent checkbox
          const checkboxElement = document.querySelector(`[data-checkbox-id="${checkboxId}"]`) as HTMLElement;
          if (checkboxElement) {
            checkboxElement.focus();
          }
          
          // Blur to trigger cleanup
          const target = e.target as HTMLInputElement;
          target.blur();
        }
        // If invalid, do nothing (Tab/Enter is prevented)
      }
      return;
    }
    
    // Handle Escape key - cancel and clear
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
      return;
    }
    
    // All other keys work normally
  }, [isActive, enabled, localMin, localMax, minInputRef, maxInputRef, checkboxId, onValidChange, onEscape]);
  
  const handleMinKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    handleKeyDown(e, 'min');
  }, [handleKeyDown]);
  
  const handleMaxKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    handleKeyDown(e, 'max');
  }, [handleKeyDown]);
  
  const handleMinFocus = useCallback(() => {
    setFocusedInput('min');
  }, []);
  
  const handleMaxFocus = useCallback(() => {
    setFocusedInput('max');
  }, []);
  
  const handleBlur = useCallback(() => {
    setFocusedInput(null);
  }, []);
  
  return {
    handleMinKeyDown,
    handleMaxKeyDown,
    handleMinFocus,
    handleMaxFocus,
    handleBlur,
    focusedInput,
    isActive
  };
}

/**
 * Enhanced version that can also handle Shift+Enter for reverse navigation
 * 
 * @param nextTabIndex - The tabIndex of the next element (for Enter)
 * @param prevTabIndex - The tabIndex of the previous element (for Shift+Enter)
 * @param enabled - Whether the behavior is enabled (default: true)
 * @returns onKeyDown handler to attach to the input
 */
export function useEnterAsTabBidirectional(
  nextTabIndex: number, 
  prevTabIndex?: number,
  enabled: boolean = true
) {
  // Register this behavior with the focus context
  const isActive = useFocusBehavior('enter-as-tab', enabled);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Only handle if behavior is active
    if (!isActive || !enabled) {
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      
      // Shift+Enter goes to previous field if prevTabIndex is provided
      if (e.shiftKey && prevTabIndex !== undefined) {
        const prevElement = document.querySelector(`[tabIndex="${prevTabIndex}"]`) as HTMLElement;
        if (prevElement) {
          prevElement.focus();
          if (prevElement instanceof HTMLInputElement) {
            prevElement.select();
          }
        }
      } else {
        // Regular Enter goes to next field
        const nextElement = document.querySelector(`[tabIndex="${nextTabIndex}"]`) as HTMLElement;
        if (nextElement) {
          nextElement.focus();
          if (nextElement instanceof HTMLInputElement) {
            nextElement.select();
          }
        }
      }
    }
  }, [nextTabIndex, prevTabIndex, isActive, enabled]);

  // No longer need to warn about conflicts since multiple components can use enter-as-tab

  return handleKeyDown;
}