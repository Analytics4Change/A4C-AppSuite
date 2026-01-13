/**
 * Status Filter Tabs Component
 *
 * Reusable tab-style status filter for consistent filtering UI across the application.
 * Implements pill-style buttons matching the UserList pattern.
 *
 * Features:
 * - Generic type support for different status values
 * - Optional counts displayed in labels
 * - Optional icons per option
 * - WCAG 2.1 Level AA compliant
 * - Keyboard accessible with aria-pressed states
 *
 * @see UserList.tsx for original implementation pattern
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/utils';

/**
 * Configuration for a single status filter option
 */
export interface StatusFilterOption<T extends string> {
  /** The value used for filtering */
  value: T;
  /** Display label for the tab */
  label: string;
  /** Optional count to display in parentheses */
  count?: number;
  /** Optional icon to display before label */
  icon?: React.ReactNode;
}

/**
 * Props for StatusFilterTabs component
 */
export interface StatusFilterTabsProps<T extends string> {
  /** Array of filter options to display */
  options: StatusFilterOption<T>[];
  /** Currently selected value */
  value: T;
  /** Callback when selection changes */
  onChange: (value: T) => void;
  /** Accessible label for the filter group */
  ariaLabel?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * StatusFilterTabs - Reusable tab-style status filter
 *
 * Provides a consistent filtering UI pattern across list and management pages.
 * Uses pill-style buttons with visual feedback for selected state.
 *
 * @example
 * const STATUS_OPTIONS = [
 *   { value: 'all', label: 'All', count: 10 },
 *   { value: 'active', label: 'Active', count: 8 },
 *   { value: 'inactive', label: 'Inactive', count: 2 },
 * ];
 *
 * <StatusFilterTabs
 *   options={STATUS_OPTIONS}
 *   value={statusFilter}
 *   onChange={setStatusFilter}
 *   ariaLabel="Filter by status"
 * />
 */
export function StatusFilterTabs<T extends string>({
  options,
  value,
  onChange,
  ariaLabel = 'Filter by status',
  className,
}: StatusFilterTabsProps<T>): React.ReactElement {
  return (
    <div
      className={cn('flex gap-2 flex-wrap', className)}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const isSelected = value === option.value;
        const label =
          option.count !== undefined
            ? `${option.label} (${option.count})`
            : option.label;

        return (
          <Button
            key={option.value}
            size="sm"
            variant={isSelected ? 'default' : 'outline'}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-center gap-1.5 transition-all',
              isSelected
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'hover:bg-gray-100'
            )}
            aria-pressed={isSelected}
          >
            {option.icon}
            {label}
          </Button>
        );
      })}
    </div>
  );
}

export default StatusFilterTabs;
