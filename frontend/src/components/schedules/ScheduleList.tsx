/**
 * Schedule List Component
 *
 * Renders a filterable list of schedules with search, status filter, and selection.
 * Mirrors RoleList pattern.
 */

import React, { useCallback, useId } from 'react';
import { observer } from 'mobx-react-lite';
import { cn } from '@/components/ui/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Search, Calendar } from 'lucide-react';
import { ScheduleCard } from './ScheduleCard';
import type { UserSchedulePolicy } from '@/types/schedule.types';
import type { ScheduleStatusFilter } from '@/viewModels/schedule/ScheduleListViewModel';

const STATUS_OPTIONS: { value: ScheduleStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

export interface ScheduleListProps {
  schedules: UserSchedulePolicy[];
  selectedScheduleId: string | null;
  statusFilter: ScheduleStatusFilter;
  searchTerm: string;
  isLoading: boolean;
  onSelect: (scheduleId: string) => void;
  onSearchChange: (term: string) => void;
  onStatusChange: (status: ScheduleStatusFilter) => void;
  className?: string;
}

const ScheduleCardSkeleton: React.FC = () => (
  <li className="p-4 rounded-lg border border-gray-200 bg-white animate-pulse">
    <div className="flex items-start justify-between gap-2">
      <div className="h-5 bg-gray-200 rounded w-32" />
      <div className="h-5 bg-gray-200 rounded w-16" />
    </div>
    <div className="mt-2 h-4 bg-gray-200 rounded w-3/4" />
    <div className="mt-2 flex gap-1">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex-1 h-5 bg-gray-200 rounded" />
      ))}
    </div>
  </li>
);

export const ScheduleList = observer(
  ({
    schedules,
    selectedScheduleId,
    statusFilter,
    searchTerm,
    isLoading,
    onSelect,
    onSearchChange,
    onStatusChange,
    className,
  }: ScheduleListProps) => {
    const searchId = useId();

    const handleSearchChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        onSearchChange(e.target.value);
      },
      [onSearchChange]
    );

    return (
      <div className={cn('flex flex-col h-full', className)}>
        {/* Filters */}
        <div className="flex-shrink-0 space-y-3 pb-4 border-b border-gray-200">
          <div>
            <Label htmlFor={searchId} className="sr-only">
              Search schedules
            </Label>
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
                aria-hidden="true"
              />
              <Input
                id={searchId}
                type="search"
                placeholder="Search schedules..."
                value={searchTerm}
                onChange={handleSearchChange}
                className="pl-9"
                aria-label="Search schedules by name or user"
              />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap" role="group" aria-label="Filter by status">
            {STATUS_OPTIONS.map((option) => {
              const isSelected = statusFilter === option.value;
              return (
                <Button
                  key={option.value}
                  size="sm"
                  variant={isSelected ? 'default' : 'outline'}
                  onClick={() => onStatusChange(option.value)}
                  className={cn(
                    'flex items-center gap-1.5 transition-all',
                    isSelected ? 'bg-blue-600 text-white hover:bg-blue-700' : 'hover:bg-gray-100'
                  )}
                  aria-pressed={isSelected}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
        </div>

        {/* Count */}
        <div className="flex-shrink-0 py-2 text-sm text-gray-500">
          {isLoading ? (
            <span>Loading schedules...</span>
          ) : (
            <span>
              {schedules.length} schedule{schedules.length !== 1 ? 's' : ''}
              {searchTerm && ` matching "${searchTerm}"`}
            </span>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {isLoading ? (
            <ul className="space-y-2" aria-busy="true" aria-label="Loading schedules">
              {[1, 2, 3].map((n) => (
                <ScheduleCardSkeleton key={n} />
              ))}
            </ul>
          ) : schedules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Calendar className="h-12 w-12 text-gray-300 mb-4" aria-hidden="true" />
              <h3 className="text-lg font-medium text-gray-900">No schedules found</h3>
              <p className="mt-1 text-sm text-gray-500">
                {searchTerm
                  ? 'Try adjusting your search or filters.'
                  : 'Create a new schedule to get started.'}
              </p>
            </div>
          ) : (
            <ul
              className="space-y-2"
              role="listbox"
              aria-label="Schedules"
              aria-activedescendant={selectedScheduleId || undefined}
            >
              {schedules.map((schedule) => (
                <ScheduleCard
                  key={schedule.id}
                  schedule={schedule}
                  isSelected={schedule.id === selectedScheduleId}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }
);

ScheduleList.displayName = 'ScheduleList';
