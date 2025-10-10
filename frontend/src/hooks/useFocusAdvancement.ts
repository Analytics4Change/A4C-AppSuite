import { useCallback, useEffect, useRef, useState, RefObject } from 'react';
import { findElementByTabIndex } from '@/utils/focus-management';
import { TIMINGS } from '@/config/timings';

/**
 * Options for the useFocusAdvancement hook
 */
export interface UseFocusAdvancementOptions {
  // Target for focus advancement
  targetTabIndex?: number;
  targetRef?: RefObject<HTMLElement>;
  targetSelector?: string;
  
  // Trigger configuration
  enabled?: boolean;
  delay?: number; // Defaults to TIMINGS.focus.transitionDelay
  
  // Advanced options
  skipIfMouseSelection?: boolean; // Default: true
  onFocusComplete?: () => void;
  onFocusError?: (error: Error) => void;
}

/**
 * Result interface for the useFocusAdvancement hook
 */
export interface UseFocusAdvancementResult {
  // Trigger focus advancement programmatically
  advanceFocus: (method?: 'keyboard' | 'mouse') => void;
  
  // For integration with dropdown onSelect
  handleSelection: (item: any, method: 'keyboard' | 'mouse') => void;
  
  // State
  isPending: boolean;
  lastError: Error | null;
}

/**
 * Hook for handling selection-method-aware focus advancement
 * Replaces setTimeout-based focus advancement with a declarative pattern
 * 
 * @param options - Configuration options for focus advancement
 * @returns Functions and state for managing focus advancement
 * 
 * @example
 * ```typescript
 * const focusAdvancement = useFocusAdvancement({
 *   targetTabIndex: 15,
 *   onFocusComplete: () => console.log('Focus advanced')
 * });
 * 
 * // In dropdown onSelect
 * onSelect={(item, method) => {
 *   handleChange(item);
 *   focusAdvancement.handleSelection(item, method);
 * }}
 * ```
 */
export function useFocusAdvancement(options: UseFocusAdvancementOptions): UseFocusAdvancementResult {
  const {
    targetTabIndex,
    targetRef,
    targetSelector,
    enabled = true,
    delay = TIMINGS.focus.transitionDelay,
    skipIfMouseSelection = true,
    onFocusComplete,
    onFocusError
  } = options;

  const [isPending, setIsPending] = useState(false);
  const [lastError, setLastError] = useState<Error | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const rafRef = useRef<number | undefined>(undefined);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const advanceFocus = useCallback((method: 'keyboard' | 'mouse' = 'keyboard') => {
    // Skip if disabled or mouse selection when configured
    if (!enabled || (skipIfMouseSelection && method === 'mouse')) {
      return;
    }

    setIsPending(true);
    setLastError(null);

    // Clear any existing timeout or RAF
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }

    // Function to perform the actual focus advancement
    const advance = () => {
      try {
        let element: HTMLElement | null = null;

        // Find the target element using the provided method
        if (targetRef?.current) {
          element = targetRef.current;
        } else if (targetTabIndex !== undefined) {
          element = findElementByTabIndex(targetTabIndex);
        } else if (targetSelector) {
          element = document.querySelector<HTMLElement>(targetSelector);
        }

        if (element && !element.hasAttribute('disabled')) {
          // Check if element is visible
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            element.focus();
            
            // Select text if it's a text input for easy replacement
            if (element instanceof HTMLInputElement && 
                ['text', 'search', 'tel', 'url', 'email', 'number'].includes(element.type)) {
              element.select();
            }
            
            onFocusComplete?.();
          } else {
            throw new Error('Target element is not visible');
          }
        } else {
          throw new Error(
            targetRef?.current 
              ? 'Target ref element is disabled or not available'
              : targetTabIndex !== undefined 
                ? `No element found with tabIndex ${targetTabIndex}`
                : targetSelector 
                  ? `No element found matching selector "${targetSelector}"`
                  : 'No target specified for focus advancement'
          );
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        setLastError(err);
        onFocusError?.(err);
      } finally {
        setIsPending(false);
      }
    };

    // Use configured delay or RAF for tests (when delay is 0)
    if (delay === 0) {
      // Use double RAF to ensure Portal cleanup and browser paint
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(advance);
      });
    } else {
      timeoutRef.current = setTimeout(advance, delay);
    }
  }, [
    enabled, 
    skipIfMouseSelection, 
    targetRef, 
    targetTabIndex, 
    targetSelector, 
    delay, 
    onFocusComplete, 
    onFocusError
  ]);

  const handleSelection = useCallback((item: any, method: 'keyboard' | 'mouse') => {
    advanceFocus(method);
  }, [advanceFocus]);

  return {
    advanceFocus,
    handleSelection,
    isPending,
    lastError
  };
}