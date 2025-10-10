import { useCallback } from 'react';

/**
 * Custom hook for auto-scrolling to center an element within a scrollable container
 * Following MVVM pattern - this is a presentation concern handled at the View layer
 */
export const useAutoScroll = (containerRef?: React.RefObject<HTMLElement | null>) => {
  /**
   * Scrolls the container to center the target element in view
   * @param targetElement - The element to center in the viewport
   * @param options - Optional configuration for scroll behavior
   */
  const scrollToCenter = useCallback((
    targetElement: HTMLElement | null,
    options?: {
      behavior?: ScrollBehavior;
      block?: ScrollLogicalPosition;
      inline?: ScrollLogicalPosition;
      offset?: number;
    }
  ) => {
    if (!targetElement) return;

    const {
      behavior = 'smooth',
      block = 'center',
      inline = 'center',
      offset = 0
    } = options || {};

    // If a specific container is provided, use it; otherwise use the modal container
    const scrollContainer = containerRef?.current || 
      targetElement.closest('[role="dialog"]') ||
      targetElement.closest('.overflow-y-auto') ||
      document.body;

    if (!scrollContainer) return;

    // Calculate the element's position relative to the container
    const targetRect = targetElement.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();

    // Calculate the scroll position to center the element
    const relativeTop = targetRect.top - containerRect.top + scrollContainer.scrollTop;
    const relativeLeft = targetRect.left - containerRect.left + scrollContainer.scrollLeft;

    // Calculate center positions
    const scrollTop = relativeTop - (containerRect.height / 2) + (targetRect.height / 2) + offset;
    const scrollLeft = relativeLeft - (containerRect.width / 2) + (targetRect.width / 2);

    // Perform the scroll
    if (scrollContainer === document.body || scrollContainer === document.documentElement) {
      // For body/document scrolling
      window.scrollTo({
        top: scrollTop,
        left: block === 'center' ? scrollLeft : undefined,
        behavior
      });
    } else {
      // For container scrolling
      scrollContainer.scrollTo({
        top: scrollTop,
        left: inline === 'center' ? scrollLeft : undefined,
        behavior
      });
    }
  }, [containerRef]);

  /**
   * Scrolls to an element by its ID
   * @param elementId - The ID of the element to scroll to
   * @param options - Optional configuration for scroll behavior
   */
  const scrollToElementById = useCallback((
    elementId: string,
    options?: Parameters<typeof scrollToCenter>[1]
  ) => {
    const element = document.getElementById(elementId);
    scrollToCenter(element, options);
  }, [scrollToCenter]);

  /**
   * Scrolls to an element when it becomes visible (useful for dropdowns/modals)
   * @param element - The element to observe and scroll to
   * @param options - Optional configuration for scroll behavior
   */
  const scrollWhenVisible = useCallback((
    element: HTMLElement | null,
    options?: Parameters<typeof scrollToCenter>[1]
  ) => {
    if (!element) return;

    // Use requestAnimationFrame to ensure element is rendered
    requestAnimationFrame(() => {
      // Check if element is visible
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        scrollToCenter(element, options);
      }
    });
  }, [scrollToCenter]);

  return {
    scrollToCenter,
    scrollToElementById,
    scrollWhenVisible
  };
};