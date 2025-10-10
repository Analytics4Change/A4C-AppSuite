import { useState, useEffect, useRef, useCallback } from 'react';
import { TIMINGS } from '@/config/timings';

/**
 * Hook that debounces a value by a specified delay
 * Useful for search inputs to avoid excessive API calls
 * 
 * @param value - The value to debounce
 * @param delay - Debounce delay in milliseconds (default: 300ms, 0 in tests)
 * @returns The debounced value
 * 
 * @example
 * ```tsx
 * const [searchTerm, setSearchTerm] = useState('');
 * const debouncedSearchTerm = useDebounce(searchTerm, 500);
 * 
 * useEffect(() => {
 *   if (debouncedSearchTerm) {
 *     // Perform search API call
 *     searchAPI(debouncedSearchTerm);
 *   }
 * }, [debouncedSearchTerm]);
 * ```
 */
export const useDebounce = <T>(
  value: T,
  delay: number = process.env.NODE_ENV === 'test' ? 0 : 300
): T => {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

/**
 * Hook that returns a debounced callback function
 * Useful when you need more control over when debouncing occurs
 * 
 * @param callback - The function to debounce
 * @param delay - Debounce delay in milliseconds (default: 300ms, 0 in tests)
 * @returns A debounced version of the callback
 * 
 * @example
 * ```tsx
 * const handleSearch = useDebounceCallback((searchTerm: string) => {
 *   searchAPI(searchTerm);
 * }, 500);
 * 
 * <input onChange={(e) => handleSearch(e.target.value)} />
 * ```
 */
export const useDebounceCallback = <T extends (...args: any[]) => any>(
  callback: T,
  delay: number = process.env.NODE_ENV === 'test' ? 0 : 300
): ((...args: Parameters<T>) => void) => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const debouncedCallback = useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      callback(...args);
      timeoutRef.current = null;
    }, delay);
  }, [callback, delay]);

  return debouncedCallback;
};

/**
 * Hook for debouncing search operations
 * Specialized version with search-specific defaults
 * 
 * @param onSearch - Search callback function
 * @param minLength - Minimum search length (default: 2)
 * @param delay - Debounce delay (default: 500ms for search, 0 in tests)  
 * @returns Handler for search input changes
 * 
 * @example
 * ```tsx
 * const { handleSearchChange, isDebouncing } = useSearchDebounce(
 *   (query) => searchMedications(query)
 * );
 * 
 * <input 
 *   onChange={(e) => handleSearchChange(e.target.value)}
 *   placeholder={isDebouncing ? "Searching..." : "Search..."}
 * />
 * ```
 */
export const useSearchDebounce = (
  onSearch: (query: string) => void,
  minLength: number = 2,
  delay: number = process.env.NODE_ENV === 'test' ? 0 : 500
) => {
  const [isDebouncing, setIsDebouncing] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Set debouncing state
    if (value.length >= minLength) {
      setIsDebouncing(true);
    } else {
      setIsDebouncing(false);
    }

    // Set new timeout
    if (value.length >= minLength) {
      timeoutRef.current = setTimeout(() => {
        onSearch(value);
        setIsDebouncing(false);
        timeoutRef.current = null;
      }, delay);
    }
  }, [onSearch, minLength, delay]);

  return { handleSearchChange, isDebouncing };
};