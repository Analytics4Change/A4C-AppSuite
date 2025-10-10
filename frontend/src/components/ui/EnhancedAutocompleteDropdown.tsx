import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './utils';
import { useDropdownHighlighting } from '@/hooks/useDropdownHighlighting';
import { HighlightType } from '@/types/dropdown';
import '@/styles/dropdown-highlighting.css';

interface EnhancedAutocompleteDropdownProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  onSelect?: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  error?: boolean;
  id?: string;
  tabIndex?: number;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
  autoFocus?: boolean;
  onBlur?: () => void;
  onFocus?: () => void;
  allowCustomValue?: boolean;
  filterStrategy?: 'contains' | 'startsWith';
}

export const EnhancedAutocompleteDropdown: React.FC<EnhancedAutocompleteDropdownProps> = ({
  options,
  value,
  onChange,
  onSelect,
  placeholder = 'Select or type...',
  className,
  disabled = false,
  error = false,
  id,
  tabIndex,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-required': ariaRequired,
  autoFocus = false,
  onBlur,
  onFocus,
  allowCustomValue = true,
  filterStrategy = 'contains'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [filteredOptions, setFilteredOptions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Filter options based on input
  useEffect(() => {
    const searchTerm = inputValue.toLowerCase().trim();
    if (!searchTerm) {
      setFilteredOptions(options);
    } else {
      // Filter all items that contain the substring
      const filtered = options.filter(option => 
        option.toLowerCase().includes(searchTerm)
      );
      
      // Sort to put startsWith matches first
      filtered.sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(searchTerm);
        const bStarts = b.toLowerCase().startsWith(searchTerm);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return 0;
      });
      
      setFilteredOptions(filtered);
    }
  }, [inputValue, options]);

  // Use unified dropdown highlighting
  const {
    navigationIndex,
    getItemHighlightType,
    handleArrowKey,
    handleTextInput,
    handleMouseEnter,
    reset: resetHighlighting
  } = useDropdownHighlighting({
    items: filteredOptions,
    getItemText: (item) => item,
    inputValue,
    enabled: isOpen && filteredOptions.length > 0,
    onNavigate: (index) => {
      // Scroll into view when navigating
      if (optionRefs.current[index]) {
        optionRefs.current[index]?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        });
      }
    }
  });

  // Update local input when prop changes
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange(newValue);
    handleTextInput(newValue);
    
    if (!isOpen && newValue) {
      setIsOpen(true);
    }
  };

  const handleOptionSelect = (option: string) => {
    setInputValue(option);
    onChange(option);
    onSelect?.(option);
    setIsOpen(false);
    resetHighlighting();
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setIsOpen(true);
      return;
    }

    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        handleArrowKey('down');
        break;
      
      case 'ArrowUp':
        e.preventDefault();
        handleArrowKey('up');
        break;
      
      case 'Home':
        e.preventDefault();
        handleArrowKey('home');
        break;
        
      case 'End':
        e.preventDefault();
        handleArrowKey('end');
        break;
      
      case 'Enter':
        e.preventDefault();
        
        // Check how many items start with the typed text
        const searchText = inputValue.toLowerCase().trim();
        const startsWithMatches = searchText ? 
          filteredOptions.filter(option => 
            option.toLowerCase().startsWith(searchText)
          ) : [];
        
        if (navigationIndex >= 0 && filteredOptions[navigationIndex]) {
          // User has navigated with arrows - always respect that choice
          handleOptionSelect(filteredOptions[navigationIndex]);
        } else if (startsWithMatches.length === 1) {
          // Auto-select the single startsWith match
          handleOptionSelect(startsWithMatches[0]);
        } else if (filteredOptions.length === 1) {
          // Only one filtered result visible - allow Enter to select it
          handleOptionSelect(filteredOptions[0]);
        } else if (allowCustomValue && inputValue) {
          // Allow custom value if enabled
          onSelect?.(inputValue);
          setIsOpen(false);
          resetHighlighting();
        }
        break;
      
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        resetHighlighting();
        break;
        
      case 'Tab':
        // Let tab naturally move focus, close dropdown
        setIsOpen(false);
        resetHighlighting();
        break;
    }
  };

  const handleInputFocus = () => {
    onFocus?.();
    if (filteredOptions.length > 0) {
      setIsOpen(true);
    }
  };

  const handleInputBlur = (e: React.FocusEvent) => {
    // Use a small delay to allow clicking on options
    setTimeout(() => {
      if (!dropdownRef.current?.contains(document.activeElement)) {
        setIsOpen(false);
        resetHighlighting();
        onBlur?.();
      }
    }, 200);
  };

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        isOpen &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        resetHighlighting();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, resetHighlighting]);

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "w-full px-3 py-2 pr-10 border rounded-md",
            "focus:outline-none focus:ring-2 focus:ring-blue-500",
            error ? "border-red-500" : "border-gray-300",
            disabled && "bg-gray-100 cursor-not-allowed",
            className
          )}
          tabIndex={tabIndex}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid || error}
          aria-required={ariaRequired}
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={isOpen ? `${id}-listbox` : undefined}
          aria-activedescendant={
            isOpen && navigationIndex >= 0 
              ? `${id}-option-${navigationIndex}` 
              : undefined
          }
          autoComplete="off"
          autoFocus={autoFocus}
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={disabled}
          className="absolute right-2 top-1/2 -translate-y-1/2"
          tabIndex={-1}
          aria-label="Toggle dropdown"
        >
          <ChevronDown 
            className={cn(
              "h-4 w-4 text-gray-400 transition-transform",
              isOpen && "rotate-180"
            )}
          />
        </button>
      </div>

      {isOpen && filteredOptions.length > 0 && (
        <div
          ref={dropdownRef}
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto"
        >
          {filteredOptions.map((option, index) => {
            const highlightType = getItemHighlightType(option, index);
            
            return (
              <div
                key={option}
                ref={el => { optionRefs.current[index] = el; }}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={index === navigationIndex}
                className={cn(
                  "dropdown-item",
                  highlightType === HighlightType.TypedMatch && "dropdown-item-typed-match",
                  highlightType === HighlightType.Navigation && "dropdown-item-navigation",
                  highlightType === HighlightType.Both && "dropdown-item-both",
                  highlightType === HighlightType.None && "hover:bg-gray-50"
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleOptionSelect(option);
                }}
                onMouseEnter={() => handleMouseEnter(index)}
              >
                {option}
              </div>
            );
          })}
        </div>
      )}

      {isOpen && filteredOptions.length === 0 && inputValue && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg p-3">
          <p className="text-sm text-gray-500 text-center">
            {allowCustomValue 
              ? "No matches found. Press Enter to use custom value."
              : "No matches found"}
          </p>
        </div>
      )}
    </div>
  );
};