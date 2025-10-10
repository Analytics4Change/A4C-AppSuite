import { useCallback, useEffect, useRef, useState, RefObject } from 'react';
import { getAllFocusableElements } from '@/utils/focus-management';

/**
 * Options for the useKeyboardNavigation hook
 */
export interface UseKeyboardNavigationOptions {
  // Container configuration
  containerRef?: RefObject<HTMLElement>;
  enabled?: boolean;
  
  // Focus trap configuration
  trapFocus?: boolean;
  restoreFocus?: boolean;
  initialFocusRef?: RefObject<HTMLElement>;
  
  // Navigation configuration
  allowTabNavigation?: boolean;
  allowArrowNavigation?: boolean;
  wrapAround?: boolean;
  
  // Filtering
  includeSelectors?: string[];
  excludeSelectors?: string[];
  
  // Callbacks
  onNavigate?: (element: HTMLElement, direction: 'forward' | 'backward') => void;
  onEscape?: () => void;
  checkEscapeCondition?: () => boolean; // Only call onEscape if this returns true
}

/**
 * Result interface for the useKeyboardNavigation hook
 */
export interface UseKeyboardNavigationResult {
  // Current focus state
  currentFocusIndex: number;
  focusableElementsCount: number;
  
  // Navigation methods
  focusNext: () => void;
  focusPrevious: () => void;
  focusFirst: () => void;
  focusLast: () => void;
  focusByIndex: (index: number) => void;
  
  // For manual key handling
  handleKeyDown: (event: KeyboardEvent | React.KeyboardEvent) => void;
}

/**
 * Hook for managing actual DOM focus movement between focusable elements
 * Specifically for scenarios where browser focus physically moves between elements
 * NOT for virtual selection within widgets (like dropdown options)
 * 
 * @param options - Configuration options for keyboard navigation
 * @returns Functions and state for managing keyboard navigation
 * 
 * @example
 * ```typescript
 * // Modal focus trap
 * const navigation = useKeyboardNavigation({
 *   containerRef: modalRef,
 *   enabled: isOpen,
 *   trapFocus: true,
 *   restoreFocus: true,
 *   onEscape: onClose
 * });
 * ```
 */
export function useKeyboardNavigation(options: UseKeyboardNavigationOptions): UseKeyboardNavigationResult {
  const {
    containerRef,
    enabled = true,
    trapFocus = false,
    restoreFocus = false,
    initialFocusRef,
    allowTabNavigation = true,
    allowArrowNavigation = false,
    wrapAround = trapFocus, // Default to wrapping if trapping focus
    includeSelectors = [],
    excludeSelectors = [],
    onNavigate,
    onEscape,
    checkEscapeCondition
  } = options;

  const [currentFocusIndex, setCurrentFocusIndex] = useState(-1);
  const [focusableElementsCount, setFocusableElementsCount] = useState(0);
  const focusableElementsRef = useRef<HTMLElement[]>([]);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const isInitializedRef = useRef(false);

  // Update focusable elements when container or selectors change
  useEffect(() => {
    if (!enabled) return;

    const updateFocusableElements = () => {
      const container = containerRef?.current || document;
      const elements = getAllFocusableElements(container as HTMLElement | Document, {
        includeSelectors,
        excludeSelectors
      });
      focusableElementsRef.current = elements;
      setFocusableElementsCount(elements.length);
      
      // Update current focus index
      const activeElement = document.activeElement as HTMLElement;
      const index = elements.indexOf(activeElement);
      setCurrentFocusIndex(index);
    };

    updateFocusableElements();

    // Track focus changes
    const container = containerRef?.current || document;
    const updateCurrentIndex = (e: FocusEvent) => {
      const activeElement = e.target as HTMLElement;
      const elements = getAllFocusableElements(container as HTMLElement | Document, {
        includeSelectors,
        excludeSelectors
      });
      const index = elements.indexOf(activeElement);
      setCurrentFocusIndex(index);
    };
    
    container.addEventListener('focusin', updateCurrentIndex as EventListener);
    
    // Also update on DOM mutations (e.g., elements being added/removed)
    const observer = new MutationObserver(updateFocusableElements);
    observer.observe(container as Node, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'tabindex']
    });
    
    return () => {
      container.removeEventListener('focusin', updateCurrentIndex as EventListener);
      observer.disconnect();
    };
  }, [containerRef, enabled, includeSelectors, excludeSelectors]);

  // Handle initial focus
  useEffect(() => {
    if (!enabled || isInitializedRef.current) return;
    
    // Store previous focus for restoration
    if (restoreFocus && !previousFocusRef.current) {
      previousFocusRef.current = document.activeElement as HTMLElement;
    }
    
    // Set initial focus
    if (initialFocusRef?.current) {
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => {
        initialFocusRef.current?.focus();
      });
    } else if (trapFocus && focusableElementsRef.current.length > 0) {
      // If no initial focus specified but trapping, focus first element
      requestAnimationFrame(() => {
        focusableElementsRef.current[0]?.focus();
      });
    }
    
    isInitializedRef.current = true;
  }, [enabled, initialFocusRef, restoreFocus, trapFocus]);

  // Restore focus on unmount
  useEffect(() => {
    return () => {
      if (restoreFocus && previousFocusRef.current && previousFocusRef.current !== document.body) {
        // Check if the element is still in the DOM and focusable
        if (document.body.contains(previousFocusRef.current)) {
          previousFocusRef.current.focus();
        }
      }
    };
  }, [restoreFocus]);

  const focusNext = useCallback(() => {
    if (focusableElementsRef.current.length === 0) return;
    
    let nextIndex = currentFocusIndex + 1;
    
    if (nextIndex >= focusableElementsRef.current.length) {
      if (wrapAround) {
        nextIndex = 0;
      } else if (trapFocus) {
        // If trapping but not wrapping, stay on last element
        nextIndex = focusableElementsRef.current.length - 1;
      } else {
        // Let browser handle natural tab order
        return;
      }
    }
    
    const element = focusableElementsRef.current[nextIndex];
    if (element) {
      element.focus();
      onNavigate?.(element, 'forward');
    }
  }, [currentFocusIndex, wrapAround, trapFocus, onNavigate]);

  const focusPrevious = useCallback(() => {
    if (focusableElementsRef.current.length === 0) return;
    
    let prevIndex = currentFocusIndex - 1;
    
    if (prevIndex < 0) {
      if (wrapAround) {
        prevIndex = focusableElementsRef.current.length - 1;
      } else if (trapFocus) {
        // If trapping but not wrapping, stay on first element
        prevIndex = 0;
      } else {
        // Let browser handle natural tab order
        return;
      }
    }
    
    const element = focusableElementsRef.current[prevIndex];
    if (element) {
      element.focus();
      onNavigate?.(element, 'backward');
    }
  }, [currentFocusIndex, wrapAround, trapFocus, onNavigate]);

  const focusFirst = useCallback(() => {
    if (focusableElementsRef.current.length > 0) {
      focusableElementsRef.current[0].focus();
      onNavigate?.(focusableElementsRef.current[0], 'forward');
    }
  }, [onNavigate]);

  const focusLast = useCallback(() => {
    if (focusableElementsRef.current.length > 0) {
      const lastElement = focusableElementsRef.current[focusableElementsRef.current.length - 1];
      lastElement.focus();
      onNavigate?.(lastElement, 'backward');
    }
  }, [onNavigate]);

  const focusByIndex = useCallback((index: number) => {
    if (index >= 0 && index < focusableElementsRef.current.length) {
      focusableElementsRef.current[index].focus();
      onNavigate?.(focusableElementsRef.current[index], 'forward');
    }
  }, [onNavigate]);

  const handleKeyDown = useCallback((event: KeyboardEvent | React.KeyboardEvent) => {
    if (!enabled) return;
    
    // Check if we should handle this event
    const container = containerRef?.current;
    if (container && !(event.target instanceof Node && container.contains(event.target))) {
      // Event target is outside our container
      return;
    }
    
    // Skip if event has already been handled (e.g., by a dropdown)
    if (event.defaultPrevented) {
      return;
    }
    
    switch (event.key) {
      case 'Tab':
        // Check if the event target is controlling or inside a dropdown
        const target = event.target as HTMLElement;
        
        // Check if target is inside an open dropdown
        const inDropdown = target?.closest('[data-focus-context="open"]');
        
        // Check if target is an input controlling an open dropdown
        const isDropdownController = target?.getAttribute('aria-controls') && 
                                     target?.getAttribute('aria-expanded') === 'true';
        
        if (inDropdown || isDropdownController) {
          return;
        }
        
        if (allowTabNavigation && (trapFocus || wrapAround)) {
          // Only prevent default if we're trapping or wrapping
          const isFirstElement = currentFocusIndex === 0;
          const isLastElement = currentFocusIndex === focusableElementsRef.current.length - 1;
          
          if (event.shiftKey && isFirstElement && wrapAround) {
            event.preventDefault();
            focusPrevious();
          } else if (!event.shiftKey && isLastElement && wrapAround) {
            event.preventDefault();
            focusNext();
          } else if (trapFocus) {
            // Always prevent default when trapping
            event.preventDefault();
            if (event.shiftKey) {
              focusPrevious();
            } else {
              focusNext();
            }
          }
        }
        break;
        
      case 'ArrowDown':
      case 'ArrowRight':
        if (allowArrowNavigation) {
          event.preventDefault();
          focusNext();
        }
        break;
        
      case 'ArrowUp':
      case 'ArrowLeft':
        if (allowArrowNavigation) {
          event.preventDefault();
          focusPrevious();
        }
        break;
        
      case 'Escape':
        // Check if the event target is in a dropdown context
        const escapeTarget = event.target as HTMLElement;
        const inDropdownContext = escapeTarget?.closest('[data-focus-context="open"]') ||
                                  (escapeTarget?.getAttribute('aria-controls') && 
                                   escapeTarget?.getAttribute('aria-expanded') === 'true');
        
        if (inDropdownContext) {
          return;
        }
        
        if (onEscape) {
          // Check if we should handle escape based on condition
          const shouldHandleEscape = checkEscapeCondition ? checkEscapeCondition() : true;
          if (shouldHandleEscape) {
            event.preventDefault();
            event.stopPropagation();
            onEscape();
          }
        }
        break;
        
      case 'Home':
        if (allowArrowNavigation) {
          event.preventDefault();
          focusFirst();
        }
        break;
        
      case 'End':
        if (allowArrowNavigation) {
          event.preventDefault();
          focusLast();
        }
        break;
    }
  }, [
    enabled,
    containerRef,
    allowTabNavigation,
    allowArrowNavigation,
    trapFocus,
    wrapAround,
    currentFocusIndex,
    focusableElementsRef.current.length,
    focusNext,
    focusPrevious,
    focusFirst,
    focusLast,
    onEscape,
    checkEscapeCondition
  ]);

  // Attach keyboard listener
  useEffect(() => {
    if (!enabled) return;
    
    const container = containerRef?.current || document;
    
    // Use capture phase to intercept before other handlers
    const handleKeyDownCapture = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        handleKeyDown(e);
      }
    };
    
    container.addEventListener('keydown', handleKeyDownCapture, true);
    
    return () => {
      container.removeEventListener('keydown', handleKeyDownCapture, true);
    };
  }, [containerRef, enabled, handleKeyDown]);

  return {
    currentFocusIndex,
    focusableElementsCount,
    focusNext,
    focusPrevious,
    focusFirst,
    focusLast,
    focusByIndex,
    handleKeyDown
  };
}