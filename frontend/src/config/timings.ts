/**
 * Centralized timing configuration for the application
 * All delays are set to 0 in test environment for instant test execution
 */

const isTestEnvironment = process.env.NODE_ENV === 'test';

export const TIMINGS = {
  /**
   * Dropdown-related timings
   */
  dropdown: {
    /**
     * Delay before closing dropdown on blur
     * Allows users to click dropdown items without premature closure
     * Standard UX pattern: 200ms in production, 0ms in tests
     */
    closeDelay: isTestEnvironment ? 0 : 200
  },

  /**
   * Scroll animation timings
   */
  scroll: {
    /**
     * Delay before scrolling to newly rendered elements
     * Ensures DOM updates are complete before scroll animation
     * 100ms in production, 0ms in tests
     */
    animationDelay: isTestEnvironment ? 0 : 100
  },

  /**
   * Focus management timings
   */
  focus: {
    /**
     * Delay for focus transitions (if needed in future)
     * Currently using useEffect instead of setTimeout for focus
     */
    transitionDelay: isTestEnvironment ? 0 : 50
  },

  /**
   * Search and input debouncing timings
   */
  debounce: {
    /**
     * Default debounce delay for general inputs
     * 300ms in production, 0ms in tests
     */
    default: isTestEnvironment ? 0 : 300,
    
    /**
     * Search-specific debounce delay
     * Longer delay for search to reduce API calls
     * 500ms in production, 0ms in tests
     */
    search: isTestEnvironment ? 0 : 500
  },

  /**
   * Event listener setup timings
   */
  eventSetup: {
    /**
     * Delay before setting up global event listeners
     * Prevents immediate triggering on the same event that opened something
     * Used for click-outside patterns
     */
    clickOutsideDelay: isTestEnvironment ? 0 : 0
  }
} as const;

/**
 * Type-safe timing keys for use in components
 */
export type TimingKey = keyof typeof TIMINGS;
export type DropdownTimingKey = keyof typeof TIMINGS.dropdown;
export type ScrollTimingKey = keyof typeof TIMINGS.scroll;
export type FocusTimingKey = keyof typeof TIMINGS.focus;