/**
 * Type definitions for unified dropdown behavior
 */

/**
 * Highlight types for dropdown items
 */
export enum HighlightType {
  None = 'none',
  TypedMatch = 'typed-match',      // Item matches typed text
  Navigation = 'navigation',        // Item selected via arrow keys
  Both = 'both'                     // Item is both typed match AND navigated to
}

/**
 * Interaction modes for dropdown highlighting
 */
export type InteractionMode = 'idle' | 'typing' | 'navigating';

/**
 * Selection methods for dropdown items
 */
export type SelectionMethod = 'keyboard' | 'mouse';

/**
 * Options for useDropdownHighlighting hook
 */
export interface UseDropdownHighlightingOptions<T> {
  items: T[];
  getItemText: (item: T) => string;
  inputValue: string;
  enabled?: boolean;
  onNavigate?: (index: number) => void;
  onSelect?: (item: T, method: SelectionMethod) => void;
}

/**
 * Result from useDropdownHighlighting hook
 */
export interface UseDropdownHighlightingResult<T> {
  // State
  interactionMode: InteractionMode;
  navigationIndex: number;
  typedPrefix: string;
  
  // Highlight determination
  getItemHighlightType: (item: T, index: number) => HighlightType;
  isItemHighlighted: (item: T, index: number) => boolean;
  
  // Event handlers
  handleArrowKey: (direction: 'up' | 'down' | 'home' | 'end') => void;
  handleTextInput: (value: string) => void;
  handleMouseEnter: (index: number) => void;
  handleSelect: (item: T, method: SelectionMethod) => void;
  
  // Utilities
  reset: () => void;
  getHighlightedItem: () => T | undefined;
}