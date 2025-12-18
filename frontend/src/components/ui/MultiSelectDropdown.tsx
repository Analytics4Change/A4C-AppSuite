import React, { useState, useRef, useEffect, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { ChevronDown, ChevronUp, Check } from 'lucide-react';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { cn } from './utils';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

interface MultiSelectDropdownProps {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  label?: string;
  id: string;
  tabIndex?: number;
  buttonTabIndex?: number;
  maxHeight?: string;
  closeOnSelect?: boolean;
  onClose?: () => void;
}

/**
 * Unified Multi-Select Dropdown Component
 * - Full keyboard navigation support (Tab, Arrows, Space, Enter, Escape)
 * - WCAG and ARIA compliant
 * - MobX observable compatible
 */
export const MultiSelectDropdown = observer(({
  options,
  selected,
  onChange,
  placeholder = 'Select items...',
  label,
  id,
  buttonTabIndex,
  maxHeight = '300px',
  closeOnSelect = false,
  onClose
}: MultiSelectDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  
  // Debug: Log when selected prop changes
  useEffect(() => {
    log.debug('Selected prop changed', { id, selected });
  }, [selected, id]);

  // Handle toggling an option
  const handleToggle = useCallback((value: string) => {
    log.debug('Toggle option', { id, value, currentSelected: selected });

    const newSelected = selected.includes(value)
      ? selected.filter(v => v !== value)
      : [...selected, value];

    log.debug('New selection', { id, newSelected });
    onChange(newSelected);
    
    if (closeOnSelect) {
      setIsOpen(false);
      buttonRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- id is only for logging
  }, [selected, onChange, closeOnSelect]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen) return;

    switch(e.key) {
      case 'ArrowDown':
      case 'Tab':
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex(prev => {
          const next = e.shiftKey && e.key === 'Tab'
            ? (prev - 1 + options.length) % options.length
            : (prev + 1) % options.length;
          return next;
        });
        break;
        
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex(prev => (prev - 1 + options.length) % options.length);
        break;
        
      case ' ':
      case 'Space':
        e.preventDefault();
        e.stopPropagation();
        handleToggle(options[focusedIndex]);
        break;
        
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
        buttonRef.current?.focus();
        break;
        
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
        buttonRef.current?.focus();
        onClose?.();
        break;
    }
  }, [isOpen, options, focusedIndex, handleToggle, onClose]);

  // Focus management when dropdown opens/closes
  useEffect(() => {
    if (isOpen) {
      // Focus first item when opened
      setTimeout(() => {
        optionRefs.current[0]?.focus();
      }, 50);
    } else {
      // Reset focused index when closed
      setFocusedIndex(0);
    }
  }, [isOpen]);

  // Focus the current focused item
  useEffect(() => {
    if (isOpen && optionRefs.current[focusedIndex]) {
      optionRefs.current[focusedIndex]?.focus();
    }
  }, [focusedIndex, isOpen]);

  // Handle button click
  const handleButtonClick = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  // Handle button keyboard events
  const handleButtonKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsOpen(prev => !prev);
    }
  }, []);

  // Handle click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    // Add slight delay to prevent immediate closing when opening via click
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <Button
        ref={buttonRef}
        id={`${id}-button`}
        type="button"
        variant="outline"
        className="w-full justify-between min-h-[44px]"
        onClick={handleButtonClick}
        onKeyDown={handleButtonKeyDown}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={`${id}-listbox`}
        aria-label={`${label}: ${selected.length} selected`}
        tabIndex={buttonTabIndex}
      >
        <span className="flex items-center gap-2">
          {selected.length > 0 ? (
            <>
              <Check size={16} className="text-green-600" />
              <span>{selected.length} {label?.toLowerCase() || 'items'} selected</span>
            </>
          ) : (
            <span className="text-gray-600">{placeholder}</span>
          )}
        </span>
        {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </Button>
      
      {isOpen && (
        <div
          id={`${id}-listbox`}
          role="listbox"
          data-focus-context="open"
          aria-multiselectable="true"
          aria-label={label}
          className="absolute z-50 mt-1 w-full bg-white border rounded-lg shadow-lg overflow-auto"
          style={{ maxHeight }}
          onKeyDown={handleKeyDown}
        >
          <div className="p-2 space-y-1">
            {options.map((option, index) => (
              <div
                key={option}
                ref={el => { optionRefs.current[index] = el; }}
                role="option"
                aria-selected={selected.includes(option)}
                tabIndex={index === focusedIndex ? 0 : -1}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded cursor-pointer transition-colors",
                  index === focusedIndex && "bg-blue-50 outline outline-2 outline-blue-500",
                  index !== focusedIndex && "hover:bg-gray-50"
                )}
                onClick={() => handleToggle(option)}
                onFocus={() => setFocusedIndex(index)}
              >
                <Checkbox
                  checked={selected.includes(option)}
                  aria-label={option}
                  tabIndex={-1}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="text-sm select-none">{option}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});