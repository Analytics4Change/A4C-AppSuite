import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Check, X, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useSearchDebounce } from '@/hooks/useDebounce';
import { useDropdownPosition } from '@/hooks/useDropdownPosition';
import { useDropdownHighlighting } from '@/hooks/useDropdownHighlighting';
import { HighlightType, SelectionMethod } from '@/types/dropdown';
import { DropdownPortal } from './dropdown-portal';
import { cn } from './utils';
import { TIMINGS } from '@/config/timings';
import '@/styles/dropdown-highlighting.css';

export interface SearchableDropdownProps<T> {
  // Current state
  value: string;
  selectedItem?: T;
  searchResults: T[];
  isLoading: boolean;
  showDropdown: boolean;
  
  // Search configuration
  onSearch: (query: string) => void;
  onSelect: (item: T, method: SelectionMethod) => void;
  onClear: () => void;
  minSearchLength?: number;
  debounceMs?: number;
  
  // Display configuration
  placeholder?: string;
  error?: string;
  
  // Rendering functions
  renderItem: (item: T, index: number, isHighlighted: boolean) => React.ReactNode;
  renderSelectedItem?: (item: T) => React.ReactNode;
  getItemKey: (item: T, index: number) => string | number;
  getItemText?: (item: T) => string; // For auto-select matching
  
  // Styling
  className?: string;
  dropdownClassName?: string;
  inputClassName?: string;
  
  // Callbacks
  onFieldComplete?: () => void;
  onDropdownOpen?: (elementId: string) => void;
  
  // IDs and labels
  inputId?: string;
  dropdownId?: string;
  label?: string;
  required?: boolean;
  tabIndex?: number;
  autoFocus?: boolean;
  
}

// Inner component that uses the hooks
function SearchableDropdownInner<T>({
  value,
  selectedItem,
  searchResults,
  isLoading,
  showDropdown,
  onSearch,
  onSelect,
  onClear,
  minSearchLength = 2,
  debounceMs = TIMINGS.debounce.search,
  placeholder = "Type to search...",
  error,
  renderItem,
  renderSelectedItem,
  getItemKey,
  getItemText = (item) => String(item),
  className,
  dropdownClassName,
  inputClassName,
  onFieldComplete,
  onDropdownOpen,
  inputId = "searchable-input",
  dropdownId = "searchable-dropdown",
  label,
  required = false,
  tabIndex = 0,
  autoFocus = false
}: SearchableDropdownProps<T>) {
  const [localValue, setLocalValue] = useState(value || '');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listItemRefs = useRef<(HTMLDivElement | null)[]>([]);
  
  // Track dropdown position
  const dropdownPosition = useDropdownPosition(inputRef, showDropdown && searchResults.length > 0);
  
  // Use unified dropdown highlighting
  const {
    navigationIndex,
    getItemHighlightType,
    handleArrowKey,
    handleTextInput,
    handleMouseEnter,
    reset: resetHighlighting
  } = useDropdownHighlighting({
    items: searchResults,
    getItemText: getItemText || ((item) => String(item)),
    inputValue: localValue,
    enabled: showDropdown && searchResults.length > 0,
    onNavigate: (index) => {
      // Scroll into view when navigating
      if (listItemRefs.current[index]) {
        listItemRefs.current[index]?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        });
      }
    }
  });

  // Update local value when prop changes
  useEffect(() => {
    setLocalValue(value || '');
  }, [value]);

  // Use the search debounce hook
  const { handleSearchChange } = useSearchDebounce(
    (searchValue: string) => {
      onSearch(searchValue);
      if (onDropdownOpen) {
        onDropdownOpen(dropdownId);
      }
    },
    minSearchLength,
    debounceMs
  );

  // Handle search input changes
  const handleSearch = (searchValue: string) => {
    setLocalValue(searchValue);
    handleSearchChange(searchValue);
    handleTextInput(searchValue); // Notify highlighting hook
  };

  // Close dropdown handler for escape key
  const handleCloseDropdown = useCallback(() => {
    resetHighlighting();
    setLocalValue('');
    onSearch('');
  }, [onSearch, resetHighlighting]);


  // Auto-select exact match on blur (Tab key behavior)
  useEffect(() => {
    if (!inputRef.current) return;

    const handleBlur = (e: Event) => {
      // Only auto-select if dropdown is open and we have items
      if (!showDropdown || searchResults.length === 0 || selectedItem) return;

      // Get the current input value
      const inputValue = (e.target as HTMLInputElement).value?.trim();
      
      if (!inputValue) return;

      // Check for exact match (case-insensitive)
      const exactMatch = searchResults.find(item => {
        const itemText = getItemText(item);
        return itemText.toLowerCase() === inputValue.toLowerCase();
      });

      if (exactMatch) {
        // Auto-select the exact match
        setTimeout(() => {
          handleSelect(exactMatch, 'keyboard');
        }, 0);
      } else if (searchResults.length === 1) {
        // If only one item matches the filter and user typed something, select it
        setTimeout(() => {
          handleSelect(searchResults[0], 'keyboard');
        }, 0);
      }
    };

    const inputElement = inputRef.current;
    inputElement.addEventListener('blur', handleBlur);
    
    return () => {
      inputElement.removeEventListener('blur', handleBlur);
    };
  }, [showDropdown, searchResults, selectedItem, getItemText]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Tab just moves focus naturally (no special handling)
    if (e.key === 'Tab') {
      // Let Tab move focus naturally, blur handler will auto-select if needed
      return;
    }
    
    if (!showDropdown || searchResults.length === 0) return;
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        handleArrowKey('down');
        break;
      
      case 'ArrowUp':
        e.preventDefault();
        handleArrowKey('up');
        break;
      
      case 'Enter':
        e.preventDefault();
        // Check how many items start with the typed text
        const searchText = localValue.toLowerCase().trim();
        const startsWithMatches = searchResults.filter(item => {
          const itemText = getItemText(item).toLowerCase();
          return itemText.startsWith(searchText);
        });
        
        if (navigationIndex >= 0 && searchResults[navigationIndex]) {
          // User has navigated with arrows - always respect that choice
          handleSelect(searchResults[navigationIndex], 'keyboard');
        } else if (startsWithMatches.length === 1) {
          // Auto-select the single startsWith match
          handleSelect(startsWithMatches[0], 'keyboard');
        } else if (searchResults.length === 1) {
          // Only one filtered result visible - allow Enter to select it
          handleSelect(searchResults[0], 'keyboard');
        }
        // Otherwise, do nothing (multiple non-startsWith matches)
        break;
      
      case 'Escape':
        if (showDropdown && searchResults.length > 0) {
          // If dropdown is open, just close it without propagating
          e.preventDefault();
          e.stopPropagation();
          handleCloseDropdown();
        }
        // If dropdown is not open, let the event bubble up
        break;
      
      case 'PageUp':
      case 'PageDown':
      case 'Home':
      case 'End':
        if (showDropdown && searchResults.length > 0) {
          e.preventDefault();
          if (e.key === 'Home') {
            handleArrowKey('home');
          } else if (e.key === 'End') {
            handleArrowKey('end');
          }
        }
        break;
    }
  };

  const handleSelect = (item: T, method: SelectionMethod) => {
    onSelect(item, method);
    setLocalValue('');
    resetHighlighting(); // Reset highlighting state
    if (onFieldComplete) {
      onFieldComplete();
    }
  };

  // Scroll is now handled by the onNavigate callback in useDropdownHighlighting

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // Check if click is outside both the input and dropdown
      if (
        showDropdown && 
        dropdownRef.current && 
        !dropdownRef.current.contains(target) &&
        inputRef.current &&
        !inputRef.current.contains(target)
      ) {
        // Close dropdown on outside click
        setLocalValue('');
        onSearch('');
        resetHighlighting();
      }
    };

    if (showDropdown && searchResults.length > 0) {
      // Use centralized timing for click-outside setup delay
      const timeoutId = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, TIMINGS.eventSetup.clickOutsideDelay);
      
      return () => {
        clearTimeout(timeoutId);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showDropdown, searchResults.length, onSearch]);

  return (
    <div className={cn("space-y-3", className)}>
      {label && (
        <Label htmlFor={inputId} className="text-sm font-medium">
          {label} {required && <span className="text-red-500">*</span>}
        </Label>
      )}
      
      {/* Selected Item Display */}
      {selectedItem && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex justify-between items-start">
            <div className="flex-1">
              {renderSelectedItem ? (
                renderSelectedItem(selectedItem)
              ) : (
                <div className="flex items-center gap-2">
                  <Check className="text-green-600" size={20} />
                  <span className="font-semibold text-gray-900">
                    {getItemText(selectedItem)}
                  </span>
                </div>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              aria-label="Clear selection"
              tabIndex={tabIndex + 1}
            >
              <X size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* Search Input */}
      {!selectedItem && (
        <>
          <div className="relative">
            <Input
              ref={inputRef}
              id={inputId}
              type="text"
              value={localValue}
              onChange={(e) => handleSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className={cn(
                "pr-10",
                error && "border-red-500 focus:border-red-500",
                inputClassName
              )}
              aria-label={label || "Search"}
              aria-describedby={error ? `${inputId}-error` : undefined}
              aria-invalid={!!error}
              aria-autocomplete="list"
              aria-controls={showDropdown ? dropdownId : undefined}
              aria-expanded={showDropdown}
              aria-activedescendant={showDropdown && searchResults.length > 0 && navigationIndex >= 0 ? `${dropdownId}-option-${navigationIndex}` : undefined}
              autoComplete="off"
              autoFocus={autoFocus}
              tabIndex={tabIndex}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {isLoading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-blue-600" />
              ) : (
                <Search size={16} className="text-gray-400" />
              )}
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <p id={`${inputId}-error`} className="text-red-600 text-sm mt-1">
              {error}
            </p>
          )}
        </>
      )}

      {/* Search Results Dropdown */}
      {!selectedItem && showDropdown && searchResults.length > 0 && (
        <DropdownPortal isOpen={true}>
          <div
            ref={dropdownRef}
            id={dropdownId}
            data-focus-context="open"
            className={cn(
              "fixed bg-white border rounded-lg shadow-xl max-h-[400px] overflow-y-auto z-[10000]",
              dropdownClassName
            )}
            style={{
              top: `${dropdownPosition.top + 4}px`,
              left: `${dropdownPosition.left}px`,
              width: `${dropdownPosition.width}px`
            }}
            role="listbox"
            aria-label="Search results"
          >
            {searchResults.map((result, index) => {
              const highlightType = getItemHighlightType(result, index);
              
              return (
                <div
                  key={getItemKey(result, index)}
                  ref={el => { listItemRefs.current[index] = el; }}
                  id={`${dropdownId}-option-${index}`}
                  className={cn(
                    "dropdown-item",
                    highlightType === HighlightType.TypedMatch && "dropdown-item-typed-match",
                    highlightType === HighlightType.Navigation && "dropdown-item-navigation",
                    highlightType === HighlightType.Both && "dropdown-item-both",
                    highlightType === HighlightType.None && "hover:bg-gray-50",
                    index !== searchResults.length - 1 && "border-b border-gray-100"
                  )}
                  onMouseDown={(e) => {
                    // Prevent blur
                    e.preventDefault();
                    handleSelect(result, 'mouse');
                  }}
                  onMouseEnter={() => handleMouseEnter(index)}
                  role="option"
                  aria-selected={index === navigationIndex}
                >
                  {renderItem(result, index, index === navigationIndex)}
                </div>
              );
            })}
          </div>
        </DropdownPortal>
      )}

      {/* No Results Message */}
      {!selectedItem && showDropdown && searchResults.length === 0 && !isLoading && localValue.length >= minSearchLength && (
        <DropdownPortal isOpen={true}>
          <div 
            className="fixed bg-white border rounded-lg shadow-xl p-4 z-[10000]"
            style={{
              top: `${dropdownPosition.top + 4}px`,
              left: `${dropdownPosition.left}px`,
              width: `${dropdownPosition.width}px`
            }}
          >
            <p className="text-gray-500 text-sm text-center">
              No results found for "{localValue}"
            </p>
          </div>
        </DropdownPortal>
      )}
    </div>
  );
}

// Main export
export function SearchableDropdown<T>(props: SearchableDropdownProps<T>) {
  return <SearchableDropdownInner {...props} />;
}