import React, { useState, useRef, useCallback, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { EnhancedCheckboxGroupProps, FocusSource, FocusIntent, CheckboxMetadata } from './metadata-types';
import { DynamicAdditionalInput } from './DynamicAdditionalInput';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { DefaultSummaryStrategy } from './summary-strategies';

/**
 * Memoized checkbox item to prevent unnecessary re-renders
 * Only re-renders when relevant props actually change
 */
interface MemoizedCheckboxItemProps {
  checkbox: CheckboxMetadata;
  index: number;
  focusedElement: number;
  focusedCheckboxIndex: number;
  focusedCheckboxId: string | null;
  checkboxesLength: number;
  onCheckboxChange: (id: string, checked: boolean) => void;
  onSelectionChange: (id: string, checked: boolean) => void;
  onCheckboxFocus: (id: string) => void;
  getRefCallback: (id: string) => (el: HTMLElement | null) => void;
  getSummaryText: (id: string, data: any) => string;
  additionalData: Map<string, any>;
  focusIntent: FocusIntent;
  handleAdditionalDataChange: (id: string, data: any) => void;
  handleInputIntentionalExit: (checkboxId: string, saveValue: boolean) => void;
  handleInputNaturalBlur: (checkboxId: string) => void;
  handleDirectInputFocus: (checkboxId: string) => void;
  setFocusedCheckboxId: (id: string | null) => void;
  setFocusRegion: (region: 'checkbox' | 'input' | 'button') => void;
}

const MemoizedCheckboxItem = React.memo<MemoizedCheckboxItemProps>(({ 
  checkbox, 
  index, 
  focusedElement, 
  focusedCheckboxIndex,
  focusedCheckboxId,
  checkboxesLength,
  onCheckboxChange,
  onSelectionChange,
  onCheckboxFocus,
  getRefCallback,
  getSummaryText,
  additionalData,
  focusIntent,
  handleAdditionalDataChange,
  handleInputIntentionalExit,
  handleInputNaturalBlur,
  handleDirectInputFocus,
  setFocusedCheckboxId,
  setFocusRegion
}) => {
  return (
    <div className="space-y-2">
      <label 
        id={`${checkbox.id}-label`}
        className="flex items-start space-x-3 cursor-pointer p-2 rounded-md hover:bg-gray-50 focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 transition-all"
      >
        <Checkbox
          ref={getRefCallback(checkbox.id)}
          // Data attributes for debugging/testing
          data-checkbox-id={checkbox.id}
          data-testid={`checkbox-${checkbox.id}`}
          data-index={index}
          data-checked={checkbox.checked}
          checked={checkbox.checked}
          disabled={checkbox.disabled}
          onCheckedChange={(checked) => onCheckboxChange(checkbox.id, checked as boolean)}
          tabIndex={focusedElement === 0 && index === focusedCheckboxIndex ? 0 : -1}
          onFocus={() => onCheckboxFocus(checkbox.id)}
          aria-label={checkbox.label}
          aria-describedby={checkbox.description ? `${checkbox.id}-desc` : undefined}
          aria-setsize={checkboxesLength}
          aria-posinset={index + 1}
          className="focus:ring-0 focus-visible:ring-0"
        />
        <div className="flex-1">
          <span className="text-sm font-medium">
            {checkbox.label}
            {checkbox.checked && additionalData.get(checkbox.id) && (
              <span className="text-sm text-gray-600 ml-2">
                ({getSummaryText(checkbox.id, additionalData.get(checkbox.id))})
              </span>
            )}
          </span>
          {checkbox.description && (
            <p id={`${checkbox.id}-desc`} className="text-xs text-gray-600 mt-1">
              {checkbox.description}
            </p>
          )}
        </div>
      </label>
      
      {/* Dynamic additional input (always shown when checkbox is checked) */}
      {checkbox.checked && checkbox.requiresAdditionalInput && checkbox.additionalInputStrategy && (
        <DynamicAdditionalInput
          strategy={checkbox.additionalInputStrategy}
          checkboxId={checkbox.id}
          currentValue={additionalData.get(checkbox.id)}
          onDataChange={(data) => handleAdditionalDataChange(checkbox.id, data)}
          onSelectionChange={onSelectionChange}
          tabIndexBase={-1} // Managed by focus trap
          shouldFocus={focusedCheckboxId === checkbox.id && focusIntent.type !== 'returning-to-checkbox'}
          focusIntent={focusIntent}
          onFocusHandled={() => setFocusedCheckboxId(null)}
          onInputFocus={() => setFocusRegion('input')}
          onInputBlur={() => setFocusRegion('checkbox')}
          onIntentionalExit={handleInputIntentionalExit}
          onNaturalBlur={handleInputNaturalBlur}
          onDirectFocus={handleDirectInputFocus}
        />
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom equality check - only re-render when necessary
  const prevData = prevProps.additionalData.get(prevProps.checkbox.id);
  const nextData = nextProps.additionalData.get(nextProps.checkbox.id);
  
  return (
    prevProps.checkbox.checked === nextProps.checkbox.checked &&
    prevProps.checkbox.disabled === nextProps.checkbox.disabled &&
    prevProps.checkbox.label === nextProps.checkbox.label &&
    prevProps.checkbox.description === nextProps.checkbox.description &&
    prevProps.index === nextProps.index &&
    prevProps.focusedElement === nextProps.focusedElement &&
    prevProps.focusedCheckboxIndex === nextProps.focusedCheckboxIndex &&
    prevProps.focusedCheckboxId === nextProps.focusedCheckboxId &&
    prevProps.checkboxesLength === nextProps.checkboxesLength &&
    prevProps.focusIntent.type === nextProps.focusIntent.type &&
    prevProps.focusIntent.checkboxId === nextProps.focusIntent.checkboxId &&
    JSON.stringify(prevData) === JSON.stringify(nextData)
  );
});

MemoizedCheckboxItem.displayName = 'MemoizedCheckboxItem';

/**
 * Enhanced FocusTrappedCheckboxGroup with support for dynamic additional inputs
 * Maintains focus trap and WCAG compliance while supporting conditional content
 * Designed for reusability across different checkbox group implementations
 */
export const EnhancedFocusTrappedCheckboxGroup: React.FC<EnhancedCheckboxGroupProps> = observer(({
  id,
  title,
  checkboxes,
  onSelectionChange,
  onAdditionalDataChange,
  onContinue,
  onCancel,
  // Display configuration
  showLabel = true,
  maxVisibleItems = 7,
  // Reordering configuration
  enableReordering = false,
  reorderTrigger = 'onBlur',
  onFocusLost,
  // Summary display
  summaryRenderer,
  // Focus management
  baseTabIndex,
  nextTabIndex,
  // ARIA support
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  isRequired = false,
  hasError = false,
  errorMessage,
  helpText,
  // Button customization
  continueButtonText = 'Continue',
  cancelButtonText = 'Cancel'
}) => {
  const [focusedElement, setFocusedElement] = useState(0);
  const [focusedCheckboxIndex, setFocusedCheckboxIndex] = useState(0);
  const [focusedCheckboxId, setFocusedCheckboxId] = useState<string | null>(null);
  const [additionalData, setAdditionalData] = useState(new Map<string, any>());
  
  // Track which logical region has focus for proper keyboard handling (removed 'header')
  const [focusRegion, setFocusRegion] = useState<'checkbox' | 'input' | 'button'>('checkbox');
  
  // Focus Intent Pattern - track user's focus intent to prevent unwanted auto-focus
  const [focusIntent, setFocusIntent] = useState<FocusIntent>({ type: 'none' });
  
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const checkboxRefs = useRef<Map<string, HTMLElement>>(new Map());
  const refCallbacks = useRef<Map<string, (el: HTMLElement | null) => void>>(new Map());
  
  // Debug flag - set to true only when debugging ref issues
  const DEBUG_REFS = process.env.NODE_ENV === 'development' && false;
  
  // Default summary strategy if none provided
  const defaultSummaryStrategy = new DefaultSummaryStrategy();
  
  // Create stable ref callback factory with environment checks
  const createCheckboxRef = useCallback((checkboxId: string) => {
    return (el: HTMLElement | null) => {
      if (el) {
        // Only set if not already present
        if (!checkboxRefs.current.has(checkboxId)) {
          checkboxRefs.current.set(checkboxId, el);
          if (DEBUG_REFS) {
            console.log('[CheckboxGroup] Setting ref for checkbox:', checkboxId);
          }
        }
      } else {
        // Only remove if actually present
        if (checkboxRefs.current.has(checkboxId)) {
          checkboxRefs.current.delete(checkboxId);
          if (DEBUG_REFS) {
            console.log('[CheckboxGroup] Removing ref for checkbox:', checkboxId);
          }
        }
      }
    };
  }, [DEBUG_REFS]);
  
  // Get or create stable ref callback for a checkbox
  const getCheckboxRefCallback = useCallback((checkboxId: string) => {
    if (!refCallbacks.current.has(checkboxId)) {
      refCallbacks.current.set(checkboxId, createCheckboxRef(checkboxId));
    }
    return refCallbacks.current.get(checkboxId)!;
  }, [createCheckboxRef]);
  
  // Calculate container height based on max visible items
  const ITEM_HEIGHT = 44; // WCAG minimum touch target
  const containerHeight = maxVisibleItems ? 
    Math.min(checkboxes.length, maxVisibleItems) * ITEM_HEIGHT : 
    undefined;
  
  // Get summary text for a checkbox
  const getSummaryText = useCallback((checkboxId: string, data: any): string => {
    if (!data) return '';
    if (summaryRenderer) {
      return summaryRenderer(checkboxId, data);
    }
    return defaultSummaryStrategy.generateSummary(checkboxId, data);
  }, [summaryRenderer]);
  
  // Ensure focused item is visible in scroll container
  const ensureItemVisible = useCallback((index: number) => {
    if (!scrollContainerRef.current || !maxVisibleItems) return;
    
    const itemTop = index * ITEM_HEIGHT;
    const itemBottom = itemTop + ITEM_HEIGHT;
    const scrollTop = scrollContainerRef.current.scrollTop;
    const scrollBottom = scrollTop + (containerHeight || 0);
    
    if (itemTop < scrollTop) {
      scrollContainerRef.current.scrollTop = itemTop;
    } else if (itemBottom > scrollBottom) {
      scrollContainerRef.current.scrollTop = itemBottom - (containerHeight || 0);
    }
  }, [containerHeight, maxVisibleItems]);
  
  // Handle intentional exit from input (Enter/Escape keys)
  const handleInputIntentionalExit = useCallback((checkboxId: string, saveValue: boolean) => {
    console.log('[CheckboxGroup] Intentional exit from input:', checkboxId, 'save:', saveValue);
    
    // Set intent BEFORE any focus changes
    setFocusIntent({ type: 'returning-to-checkbox', checkboxId, source: 'keyboard' });
    
    // Clear the focusedCheckboxId to prevent re-render auto-focus issues
    setFocusedCheckboxId(null);
    setFocusRegion('checkbox');
    
    // Use queueMicrotask for reliable focus transition
    queueMicrotask(() => {
      const checkbox = checkboxRefs.current.get(checkboxId);
      if (checkbox) {
        console.log('[CheckboxGroup] Focusing checkbox after intentional exit');
        checkbox.focus();
        const index = checkboxes.findIndex(cb => cb.id === checkboxId);
        setFocusedCheckboxIndex(index);
        // Update intent after focus completes
        setFocusIntent({ type: 'checkbox', checkboxId, source: 'keyboard' });
      }
    });
  }, [checkboxes]);
  
  // Handle natural blur from input (user clicked elsewhere)
  const handleInputNaturalBlur = useCallback((checkboxId: string, relatedTarget: HTMLElement | null) => {
    // Check if focus is moving within our component
    const isInternalNavigation = relatedTarget && (
      checkboxRefs.current.has(relatedTarget.id) ||
      relatedTarget.closest('[role="group"]') === containerRef.current
    );
    
    if (!isInternalNavigation) {
      // External blur - user clicked outside
      console.log('[CheckboxGroup] Natural blur to external element');
      setFocusIntent({ type: 'external-blur', from: 'input' });
      setFocusedCheckboxId(null);
      setFocusRegion('checkbox');
      // Don't force focus back - user intentionally left
    } else {
      console.log('[CheckboxGroup] Internal navigation within component');
    }
  }, []);
  
  // Handle direct input focus via mouse click
  const handleDirectInputFocus = useCallback((checkboxId: string) => {
    console.log('[CheckboxGroup] Direct input focus via mouse');
    setFocusIntent({ type: 'input', checkboxId, source: 'mouse' });
    setFocusedCheckboxId(checkboxId);
    setFocusRegion('input');
  }, []);
  
  // Handle checkbox change
  const handleCheckboxChange = useCallback((checkboxId: string, checked: boolean) => {
    onSelectionChange(checkboxId, checked);
    
    // Clear additional data if unchecked
    if (!checked) {
      setAdditionalData(prev => {
        const newMap = new Map(prev);
        newMap.delete(checkboxId);
        return newMap;
      });
      if (onAdditionalDataChange) {
        onAdditionalDataChange(checkboxId, null);
      }
    } else {
      // If checkbox requires additional input, prepare for focus with intent
      const checkbox = checkboxes.find(cb => cb.id === checkboxId);
      if (checkbox?.requiresAdditionalInput) {
        // Determine source based on how the checkbox was activated
        // This will be keyboard if Space key was used, mouse if clicked
        const source = (window.event as any)?.detail === 0 ? 'keyboard' : 'mouse';
        setFocusIntent({ type: 'input', checkboxId, source: source as FocusSource });
        setFocusedCheckboxId(checkboxId);
      }
    }
  }, [checkboxes, onSelectionChange, onAdditionalDataChange]);
  
  // Handle additional data change with immutable updates
  const handleAdditionalDataChange = useCallback((checkboxId: string, data: any) => {
    // Use immutable update to trigger re-render
    setAdditionalData(prev => {
      const newMap = new Map(prev);
      if (data === null || data === undefined) {
        newMap.delete(checkboxId);
      } else {
        newMap.set(checkboxId, data);
      }
      return newMap; // Return new Map instance for React to detect change
    });
    
    if (onAdditionalDataChange) {
      onAdditionalDataChange(checkboxId, data);
    }
  }, [onAdditionalDataChange]);
  
  // Handle continue action
  const handleContinue = useCallback(() => {
    const selectedIds = checkboxes
      .filter(cb => cb.checked)
      .map(cb => cb.id);
    onContinue(selectedIds, additionalData);
  }, [checkboxes, onContinue, additionalData]);
  
  // Handle cancel action
  const handleCancel = useCallback(() => {
    // Clear all checkbox selections by unchecking each one
    checkboxes.forEach(checkbox => {
      if (checkbox.checked) {
        onSelectionChange(checkbox.id, false);
      }
    });
    
    // Clear the internal additional data state (dynamic input values)
    setAdditionalData(new Map<string, any>());
    
    // Reset focus tracking states
    setFocusedCheckboxId(null);
    setFocusedCheckboxIndex(0);
    setFocusIntent({ type: 'none' });
    
    // Call parent's cancel handler
    onCancel();
    
    // Focus next element if specified
    if (nextTabIndex !== undefined) {
      const nextElement = document.querySelector(`[tabindex="${nextTabIndex}"]`) as HTMLElement;
      nextElement?.focus();
    }
  }, [checkboxes, onCancel, onSelectionChange, nextTabIndex]);
  
  // Handle container focus - immediately redirect to first checkbox
  const handleContainerFocus = useCallback((e: React.FocusEvent) => {
    // Only handle focus on the container itself, not bubbled events
    if (e.target === containerRef.current) {
      e.preventDefault();
      // Immediately focus the first checkbox
      const checkboxElements = containerRef.current?.querySelectorAll('[role="checkbox"]');
      if (checkboxElements && checkboxElements[0]) {
        (checkboxElements[0] as HTMLElement).focus();
        setFocusedElement(0);
        setFocusedCheckboxIndex(0);
        setFocusRegion('checkbox');
      }
    }
  }, []);
  
  // Handle blur for reordering trigger
  const handleGroupBlur = useCallback((e: React.FocusEvent) => {
    // Check if focus is leaving the entire component
    const container = containerRef.current;
    if (container && !container.contains(e.relatedTarget as Node)) {
      if (onFocusLost) {
        onFocusLost();
      }
    }
  }, [onFocusLost]);
  
  // Enhanced keyboard navigation within the focus trap
  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent) => {
    console.log('[Container] KeyDown event:', {
      key: e.key,
      focusRegion,
      focusedElement,
      targetTagName: (e.target as HTMLElement).tagName,
      targetId: (e.target as HTMLElement).id,
      defaultPrevented: e.defaultPrevented
    });
    
    // Tab key - always handle for focus trap regardless of focus region
    // When in input region, Tab should be blocked by DynamicAdditionalInput
    // but we still handle it here for the container-level navigation
    if (e.key === 'Tab' && focusRegion !== 'input') {
      console.log('[Container] Tab key - preventing default (not in input)');
      e.preventDefault();
      console.log('[Container] Tab preventDefault done');
      // 0: checkbox group, 1: cancel, 2: continue
      const sectionCount = 3;
      const nextSection = e.shiftKey ? 
        (focusedElement - 1 + sectionCount) % sectionCount :
        (focusedElement + 1) % sectionCount;
      
      setFocusedElement(nextSection);
      
      if (nextSection === 0) {
        // Focus the currently selected checkbox
        const checkboxElements = containerRef.current?.querySelectorAll('[role="checkbox"]');
        if (checkboxElements && checkboxElements[focusedCheckboxIndex]) {
          (checkboxElements[focusedCheckboxIndex] as HTMLElement).focus();
        }
      } else if (nextSection === 1) {
        cancelButtonRef.current?.focus();
      } else if (nextSection === 2) {
        continueButtonRef.current?.focus();
      }
    } else if (e.key === 'Tab' && focusRegion === 'input') {
      // When in input region, ensure Tab doesn't escape
      // The DynamicAdditionalInput should have already prevented it
      // but we add this as a safety net
      console.log('[Container] Tab key in input region - already prevented by input');
      if (!e.defaultPrevented) {
        console.log('[Container] Tab was not prevented by input - preventing now');
        e.preventDefault();
        e.stopPropagation();
      }
    }
    
    // Handle keyboard events based on which region has focus
    // Note: Escape is handled in onKeyDownCapture to prevent propagation issues
    else if (focusRegion === 'checkbox') {
      // Arrow keys - navigate between checkboxes
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && focusedElement === 0) {
        e.preventDefault();
        const direction = e.key === 'ArrowDown' ? 1 : -1;
        const newIndex = (focusedCheckboxIndex + direction + checkboxes.length) % checkboxes.length;
        setFocusedCheckboxIndex(newIndex);
        ensureItemVisible(newIndex);
        
        // Focus the checkbox at new index
        const checkboxElements = containerRef.current?.querySelectorAll('[role="checkbox"]');
        if (checkboxElements && checkboxElements[newIndex]) {
          (checkboxElements[newIndex] as HTMLElement).focus();
        }
      }
      
      // Space key - toggle checkbox
      else if (e.key === ' ' && focusedElement === 0) {
        e.preventDefault();
        const checkbox = checkboxes[focusedCheckboxIndex];
        if (checkbox && !checkbox.disabled) {
          handleCheckboxChange(checkbox.id, !checkbox.checked);
        }
      }
      
      // Enhanced navigation for long lists
      if (maxVisibleItems && checkboxes.length > maxVisibleItems) {
        if (e.key === 'Home') {
          e.preventDefault();
          setFocusedCheckboxIndex(0);
          ensureItemVisible(0);
          const checkboxElements = containerRef.current?.querySelectorAll('[role="checkbox"]');
          if (checkboxElements && checkboxElements[0]) {
            (checkboxElements[0] as HTMLElement).focus();
          }
        } else if (e.key === 'End') {
          e.preventDefault();
          const lastIndex = checkboxes.length - 1;
          setFocusedCheckboxIndex(lastIndex);
          ensureItemVisible(lastIndex);
          const checkboxElements = containerRef.current?.querySelectorAll('[role="checkbox"]');
          if (checkboxElements && checkboxElements[lastIndex]) {
            (checkboxElements[lastIndex] as HTMLElement).focus();
          }
        } else if (e.key === 'PageUp') {
          e.preventDefault();
          const newIndex = Math.max(0, focusedCheckboxIndex - maxVisibleItems);
          setFocusedCheckboxIndex(newIndex);
          ensureItemVisible(newIndex);
          const checkboxElements = containerRef.current?.querySelectorAll('[role="checkbox"]');
          if (checkboxElements && checkboxElements[newIndex]) {
            (checkboxElements[newIndex] as HTMLElement).focus();
          }
        } else if (e.key === 'PageDown') {
          e.preventDefault();
          const newIndex = Math.min(checkboxes.length - 1, focusedCheckboxIndex + maxVisibleItems);
          setFocusedCheckboxIndex(newIndex);
          ensureItemVisible(newIndex);
          const checkboxElements = containerRef.current?.querySelectorAll('[role="checkbox"]');
          if (checkboxElements && checkboxElements[newIndex]) {
            (checkboxElements[newIndex] as HTMLElement).focus();
          }
        }
      }
    }
    // When focus is in input region, let inputs handle their own keyboard events naturally
    // This follows the Focus Region Tracking design principle from CLAUDE.md
    // When focus is in button region, standard behavior applies
  }, [focusedElement, focusedCheckboxIndex, checkboxes, handleCheckboxChange, handleCancel, focusRegion, maxVisibleItems, ensureItemVisible]);
  
  // No need for focus on mount - handled by container focus event
  
  // Maintain focus on same checkbox during reordering
  useEffect(() => {
    if (focusedCheckboxId && enableReordering) {
      const newIndex = checkboxes.findIndex(cb => cb.id === focusedCheckboxId);
      if (newIndex !== -1 && newIndex !== focusedCheckboxIndex) {
        setFocusedCheckboxIndex(newIndex);
        ensureItemVisible(newIndex);
      }
    }
  }, [checkboxes, focusedCheckboxId, focusedCheckboxIndex, enableReordering, ensureItemVisible]);
  
  // Count selected items for display
  const selectedCount = checkboxes.filter(cb => cb.checked).length;
  
  // Stable callback for checkbox focus
  const handleCheckboxFocus = useCallback((index: number, checkboxId: string) => {
    setFocusedCheckboxIndex(index);
    setFocusedCheckboxId(checkboxId);
    setFocusRegion('checkbox');
  }, []);
  
  // Cleanup effects
  useEffect(() => {
    // Log initial setup in debug mode
    if (DEBUG_REFS) {
      console.log(`[CheckboxGroup ${id}] Component mounted with ${checkboxes.length} checkboxes`);
    }
    
    return () => {
      // Clear all refs on unmount
      checkboxRefs.current.clear();
      refCallbacks.current.clear();
      
      if (DEBUG_REFS) {
        console.log(`[CheckboxGroup ${id}] Cleaned up all refs and callbacks`);
      }
    };
  }, [id, checkboxes.length, DEBUG_REFS]);
  
  // Clean up refs for removed checkboxes
  useEffect(() => {
    const currentCheckboxIds = new Set(checkboxes.map(cb => cb.id));
    
    checkboxRefs.current.forEach((_, refId) => {
      if (!currentCheckboxIds.has(refId)) {
        checkboxRefs.current.delete(refId);
        refCallbacks.current.delete(refId);
        if (DEBUG_REFS) {
          console.log(`[CheckboxGroup ${id}] Cleaned up removed checkbox:`, refId);
        }
      }
    });
  }, [checkboxes, id, DEBUG_REFS]);
  
  // Performance monitoring in development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && window.performance) {
      const startMark = `${id}-render-start`;
      const endMark = `${id}-render-end`;
      const measureName = `${id}-render`;
      
      performance.mark(startMark);
      
      return () => {
        performance.mark(endMark);
        try {
          performance.measure(measureName, startMark, endMark);
          const measures = performance.getEntriesByName(measureName);
          if (measures.length > 0) {
            const measure = measures[measures.length - 1];
            if (measure.duration > 16) { // Log slow renders (> 1 frame)
              console.warn(`[CheckboxGroup ${id}] Slow render: ${measure.duration.toFixed(2)}ms`);
            }
          }
          // Clear the measure to prevent memory buildup
          performance.clearMeasures(measureName);
          performance.clearMarks(startMark);
          performance.clearMarks(endMark);
        } catch (e) {
          // Ignore if marks don't exist
        }
      };
    }
  }, [id]);
  
  return (
    <div className="space-y-2">
      {/* Title positioned above the container */}
      {showLabel && (
        <Label htmlFor={id} className="text-base font-medium">
          {title}
        </Label>
      )}
      
      {/* Main container with proper borders and focus indication */}
      <div
        ref={containerRef}
        className="focus-trapped-checkbox-group border border-gray-200 rounded-lg transition-all focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 focus:outline-none"
        onKeyDown={handleContainerKeyDown}
        onKeyDownCapture={(e) => {
          console.log('[Container] KeyDownCapture:', {
            key: e.key,
            focusRegion,
            defaultPrevented: e.defaultPrevented,
            target: (e.target as HTMLElement).tagName
          });
          
          // Handle Escape in capture phase only when in checkbox region
          // Let inputs handle Escape naturally (e.g., close autocomplete, clear value)
          if (e.key === 'Escape' && focusRegion === 'checkbox') {
            console.log('[Container] Escape in checkbox region - closing modal');
            e.preventDefault();
            e.stopPropagation();
            handleCancel();
          } else if (e.key === 'Escape') {
            console.log('[Container] Escape in non-checkbox region (', focusRegion, ') - allowing propagation');
          }
        }}
        onFocus={handleContainerFocus}
        onBlur={handleGroupBlur}
        tabIndex={baseTabIndex} // Make container focusable
        role="group"
        aria-labelledby={showLabel ? undefined : (ariaLabelledBy || `${id}-title`)}
        aria-describedby={ariaDescribedBy || (helpText ? `${id}-help` : undefined)}
        aria-required={isRequired}
        aria-invalid={hasError}
      >
        {/* Hidden title for screen readers when label is shown */}
        {!showLabel && <span id={`${id}-title`} className="sr-only">{title}</span>}
        
        {/* Scrollable container for checkboxes */}
        <div
          ref={scrollContainerRef}
          className="overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100"
          style={{ maxHeight: containerHeight ? `${containerHeight}px` : undefined }}
        >
          {/* ARIA live region for reorder announcements */}
          <div 
            role="status" 
            aria-live="polite" 
            aria-atomic="true"
            className="sr-only"
            id={`${id}-announcements`}
          />
          
          {/* Item count announcement for long lists */}
          {checkboxes.length > maxVisibleItems && (
            <div 
              role="status"
              aria-live="polite" 
              className="sr-only"
            >
              Showing {Math.min(maxVisibleItems, checkboxes.length)} of {checkboxes.length} items. {selectedCount} selected.
            </div>
          )}
          
          {/* Content always visible (no expand/collapse) */}
          <div className="p-6 bg-white/50 backdrop-blur-sm">
            {/* Help text */}
            {helpText && (
              <p id={`${id}-help`} className="mb-4 text-sm text-gray-600">
                {helpText}
              </p>
            )}
            
            {/* Error message */}
            {hasError && errorMessage && (
              <p className="mb-4 text-sm text-red-600" role="alert">
                {errorMessage}
              </p>
            )}
            
            {/* Checkboxes with dynamic content */}
            <div className="space-y-3">
              {checkboxes.map((checkbox, index) => (
                <MemoizedCheckboxItem
                  key={checkbox.id}
                  checkbox={checkbox}
                  index={index}
                  focusedElement={focusedElement}
                  focusedCheckboxIndex={focusedCheckboxIndex}
                  focusedCheckboxId={focusedCheckboxId}
                  checkboxesLength={checkboxes.length}
                  onCheckboxChange={handleCheckboxChange}
                  onSelectionChange={onSelectionChange}
                  onCheckboxFocus={(checkboxId: string) => {
                    setFocusedCheckboxIndex(index);
                    setFocusedCheckboxId(checkboxId);
                    setFocusRegion('checkbox');
                  }}
                  getRefCallback={getCheckboxRefCallback}
                  getSummaryText={getSummaryText}
                  additionalData={additionalData}
                  focusIntent={focusIntent}
                  handleAdditionalDataChange={handleAdditionalDataChange}
                  handleInputIntentionalExit={handleInputIntentionalExit}
                  handleInputNaturalBlur={handleInputNaturalBlur}
                  handleDirectInputFocus={handleDirectInputFocus}
                  setFocusedCheckboxId={setFocusedCheckboxId}
                  setFocusRegion={setFocusRegion}
                />
              ))}
            </div>
          </div>
        </div>
        
        {/* Action buttons outside scroll area */}
        <div className="border-t border-gray-200 p-4 bg-white flex justify-end gap-3">
          <Button
            ref={cancelButtonRef}
            variant="outline"
            onClick={handleCancel}
            onFocus={() => setFocusRegion('button')}
            tabIndex={-1}
            className="min-w-[100px]"
          >
            {cancelButtonText}
          </Button>
          <Button
            ref={continueButtonRef}
            variant="default"
            onClick={handleContinue}
            onFocus={() => setFocusRegion('button')}
            tabIndex={-1}
            className="min-w-[100px]"
            disabled={checkboxes.filter(cb => cb.checked).length === 0}
          >
            {continueButtonText}
          </Button>
        </div>
      </div>
    </div>
  );
});