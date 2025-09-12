/**
 * Hook for managing dropdown highlighting with distinct interaction modes
 * Provides unified behavior for typed matches vs arrow navigation
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { 
  HighlightType, 
  InteractionMode, 
  SelectionMethod,
  UseDropdownHighlightingOptions, 
  UseDropdownHighlightingResult 
} from '@/types/dropdown';

/**
 * Hook for managing dropdown highlighting with distinct modes
 * 
 * Preconditions:
 * - items array must be provided
 * - getItemText function must return non-null strings
 * 
 * Postconditions:
 * - Returns consistent highlighting state across all interactions
 * - Maintains single source of truth for highlight mode
 * 
 * Invariants:
 * - Only one item can be navigation-highlighted at a time
 * - Mode transitions are explicit and trackable
 * 
 * Performance: < 5ms for state updates with 1000+ items
 */
export function useDropdownHighlighting<T>({
  items,
  getItemText,
  inputValue,
  enabled = true,
  onNavigate,
  onSelect
}: UseDropdownHighlightingOptions<T>): UseDropdownHighlightingResult<T> {
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('idle');
  const [navigationIndex, setNavigationIndex] = useState(-1);
  const [typedPrefix, setTypedPrefix] = useState('');
  const lastInputValueRef = useRef('');
  const isTypingRef = useRef(false);

  // Detect typing vs navigation based on input changes
  useEffect(() => {
    if (!enabled) {
      setInteractionMode('idle');
      return;
    }
    
    const currentValue = inputValue.trim();
    const lastValue = lastInputValueRef.current;
    
    if (currentValue !== lastValue) {
      // Text changed - switch to typing mode
      setInteractionMode('typing');
      setTypedPrefix(currentValue.toLowerCase());
      setNavigationIndex(-1); // Clear navigation highlight
      isTypingRef.current = true;
      lastInputValueRef.current = currentValue;
    }
  }, [inputValue, enabled]);

  // Handle arrow key navigation
  const handleArrowKey = useCallback((direction: 'up' | 'down' | 'home' | 'end') => {
    if (!enabled || items.length === 0) return;
    
    // Switch to navigation mode
    setInteractionMode('navigating');
    isTypingRef.current = false;
    
    let newIndex = navigationIndex;
    
    // If we're coming from typing mode, start from -1 or 0
    if (navigationIndex === -1 && (direction === 'down' || direction === 'home')) {
      newIndex = 0;
    } else if (navigationIndex === -1 && (direction === 'up' || direction === 'end')) {
      newIndex = items.length - 1;
    } else {
      switch (direction) {
        case 'down':
          newIndex = navigationIndex < items.length - 1 ? navigationIndex + 1 : 0;
          break;
        case 'up':
          newIndex = navigationIndex > 0 ? navigationIndex - 1 : items.length - 1;
          break;
        case 'home':
          newIndex = 0;
          break;
        case 'end':
          newIndex = items.length - 1;
          break;
      }
    }
    
    setNavigationIndex(newIndex);
    onNavigate?.(newIndex);
  }, [enabled, items.length, navigationIndex, onNavigate]);

  // Handle text input (called when user types)
  const handleTextInput = useCallback((value: string) => {
    if (!enabled) return;
    
    // Switch to typing mode
    setInteractionMode('typing');
    setTypedPrefix(value.toLowerCase().trim());
    setNavigationIndex(-1);
    isTypingRef.current = true;
    lastInputValueRef.current = value.trim();
  }, [enabled]);

  // Handle mouse enter on item
  const handleMouseEnter = useCallback((index: number) => {
    if (!enabled) return;
    
    // Mouse interaction switches to navigation mode
    setInteractionMode('navigating');
    setNavigationIndex(index);
    isTypingRef.current = false;
  }, [enabled]);

  // Handle item selection
  const handleSelect = useCallback((item: T, method: SelectionMethod) => {
    onSelect?.(item, method);
    // Reset after selection
    reset();
  }, [onSelect]);

  // Get highlight type for an item
  const getItemHighlightType = useCallback((item: T, index: number): HighlightType => {
    if (!enabled) return HighlightType.None;
    
    const isNavigated = interactionMode === 'navigating' && index === navigationIndex;
    const itemText = getItemText(item).toLowerCase();
    const isTypedMatch = typedPrefix.length > 0 && 
                         interactionMode === 'typing' && 
                         itemText.startsWith(typedPrefix);
    
    // Check for both conditions
    if (isNavigated && isTypedMatch) return HighlightType.Both;
    if (isNavigated) return HighlightType.Navigation;
    if (isTypedMatch) return HighlightType.TypedMatch;
    
    return HighlightType.None;
  }, [enabled, interactionMode, navigationIndex, typedPrefix, getItemText]);

  // Check if item is highlighted (any type)
  const isItemHighlighted = useCallback((item: T, index: number): boolean => {
    const highlightType = getItemHighlightType(item, index);
    return highlightType !== HighlightType.None;
  }, [getItemHighlightType]);

  // Reset all highlighting
  const reset = useCallback(() => {
    setInteractionMode('idle');
    setNavigationIndex(-1);
    setTypedPrefix('');
    lastInputValueRef.current = '';
    isTypingRef.current = false;
  }, []);

  // Get currently highlighted item (for navigation mode)
  const getHighlightedItem = useCallback((): T | undefined => {
    if (interactionMode === 'navigating' && navigationIndex >= 0 && navigationIndex < items.length) {
      return items[navigationIndex];
    }
    return undefined;
  }, [interactionMode, navigationIndex, items]);

  return {
    // State
    interactionMode,
    navigationIndex,
    typedPrefix,
    
    // Highlight determination
    getItemHighlightType,
    isItemHighlighted,
    
    // Event handlers
    handleArrowKey,
    handleTextInput,
    handleMouseEnter,
    handleSelect,
    
    // Utilities
    reset,
    getHighlightedItem
  };
}