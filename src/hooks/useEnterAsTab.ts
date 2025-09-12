import { useCallback, useEffect } from 'react';
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

  // Log when behavior conflicts occur
  useEffect(() => {
    if (enabled && !isActive) {
      console.warn(
        '[useEnterAsTab] Hook is enabled but behavior is not active. ' +
        'This may be due to a conflict with another focus behavior in the same context.'
      );
    }
  }, [enabled, isActive]);

  return handleKeyDown;
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

  // Log when behavior conflicts occur
  useEffect(() => {
    if (enabled && !isActive) {
      console.warn(
        '[useEnterAsTabBidirectional] Hook is enabled but behavior is not active. ' +
        'This may be due to a conflict with useTabAsArrows in the same focus context.'
      );
    }
  }, [enabled, isActive]);

  return handleKeyDown;
}