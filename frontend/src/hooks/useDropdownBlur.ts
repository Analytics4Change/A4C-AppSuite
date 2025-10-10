import { useCallback, useEffect, useRef } from 'react';
import { TIMINGS } from '@/config/timings';

/**
 * Custom hook for handling dropdown blur events with configurable delay
 * Prevents premature dropdown closure when clicking dropdown items
 * 
 * @param setShowDropdown - Function to control dropdown visibility
 * @param delay - Optional custom delay (defaults to TIMINGS.dropdown.closeDelay)
 * @returns handleBlur function to attach to onBlur event
 * 
 * @example
 * ```tsx
 * const [showDropdown, setShowDropdown] = useState(false);
 * const handleBlur = useDropdownBlur(setShowDropdown);
 * 
 * <input onBlur={handleBlur} />
 * ```
 */
export const useDropdownBlur = (
  setShowDropdown: (show: boolean) => void,
  delay: number = TIMINGS.dropdown.closeDelay
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

  const handleBlur = useCallback(() => {
    // Clear any existing timeout to prevent multiple timers
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new timeout to close dropdown
    timeoutRef.current = setTimeout(() => {
      setShowDropdown(false);
      timeoutRef.current = null;
    }, delay);
  }, [setShowDropdown, delay]);

  return handleBlur;
};

/**
 * Hook variant that also returns a cancel function
 * Useful when you need to cancel the blur timeout programmatically
 * 
 * @example
 * ```tsx
 * const { handleBlur, cancelBlur } = useDropdownBlurWithCancel(setShowDropdown);
 * 
 * // Cancel blur when item is clicked
 * const handleItemClick = () => {
 *   cancelBlur();
 *   // ... handle selection
 * };
 * ```
 */
export const useDropdownBlurWithCancel = (
  setShowDropdown: (show: boolean) => void,
  delay: number = TIMINGS.dropdown.closeDelay
) => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const cancelBlur = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return cancelBlur;
  }, [cancelBlur]);

  const handleBlur = useCallback(() => {
    cancelBlur();
    timeoutRef.current = setTimeout(() => {
      setShowDropdown(false);
      timeoutRef.current = null;
    }, delay);
  }, [setShowDropdown, delay, cancelBlur]);

  return { handleBlur, cancelBlur };
};