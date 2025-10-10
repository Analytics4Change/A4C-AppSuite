import { useCallback, useRef, useEffect } from 'react';
import { TIMINGS } from '@/config/timings';

interface ScrollOptions {
  behavior?: ScrollBehavior;
  block?: ScrollLogicalPosition;
  inline?: ScrollLogicalPosition;
}

/**
 * Custom hook for scrolling to elements after a delay
 * Ensures DOM updates are complete before scroll animation
 * 
 * @param scrollWhenVisible - Function to handle scroll animation
 * @param delay - Optional custom delay (defaults to TIMINGS.scroll.animationDelay)
 * @returns handleScrollTo function to trigger delayed scroll
 * 
 * @example
 * ```tsx
 * const { scrollWhenVisible } = useAutoScroll(containerRef);
 * const handleScrollTo = useScrollToElement(scrollWhenVisible);
 * 
 * // On dropdown open
 * handleScrollTo('dropdown-container');
 * ```
 */
export const useScrollToElement = (
  scrollWhenVisible: (element: HTMLElement, options?: ScrollOptions) => void,
  delay: number = TIMINGS.scroll.animationDelay
) => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clear any pending timeout when component unmounts
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const handleScrollTo = useCallback((elementId: string, options: ScrollOptions = { behavior: 'smooth' }) => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new timeout for scroll animation
    timeoutRef.current = setTimeout(() => {
      const element = document.getElementById(elementId);
      if (element) {
        scrollWhenVisible(element, options);
      }
      timeoutRef.current = null;
    }, delay);
  }, [scrollWhenVisible, delay]);

  return handleScrollTo;
};

/**
 * Simplified version that handles scrolling directly without external function
 * Useful when you don't have a custom scroll function
 * 
 * @example
 * ```tsx
 * const scrollToElement = useSimpleScrollToElement();
 * 
 * // Scroll to element
 * scrollToElement('my-element-id');
 * ```
 */
export const useSimpleScrollToElement = (
  delay: number = TIMINGS.scroll.animationDelay
) => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const scrollToElement = useCallback((
    elementId: string,
    options: ScrollIntoViewOptions = { 
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest'
    }
  ) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      const element = document.getElementById(elementId);
      if (element) {
        element.scrollIntoView(options);
      }
      timeoutRef.current = null;
    }, delay);
  }, [delay]);

  return scrollToElement;
};