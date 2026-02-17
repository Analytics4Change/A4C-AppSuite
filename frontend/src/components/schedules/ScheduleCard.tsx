/**
 * Schedule Card Component
 *
 * Displays a schedule template as a glass-morphism styled card in the list view.
 * Shows template name, status, assigned user count, and mini day grid.
 * Mirrors RoleCard pattern.
 */

import React, { useCallback } from 'react';
import { Calendar, Users, Building2 } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import type { ScheduleTemplate, DayOfWeek } from '@/types/schedule.types';
import { DAYS_OF_WEEK } from '@/types/schedule.types';

const DAY_SHORT: Record<DayOfWeek, string> = {
  monday: 'M',
  tuesday: 'T',
  wednesday: 'W',
  thursday: 'T',
  friday: 'F',
  saturday: 'S',
  sunday: 'S',
};

interface ScheduleCardProps {
  schedule: ScheduleTemplate;
  isSelected: boolean;
  onSelect: (templateId: string) => void;
}

export const ScheduleCard: React.FC<ScheduleCardProps> = React.memo(
  ({ schedule, isSelected, onSelect }) => {
    const handleClick = useCallback(() => {
      onSelect(schedule.id);
    }, [onSelect, schedule.id]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(schedule.id);
        }
      },
      [onSelect, schedule.id]
    );

    const activeDays = DAYS_OF_WEEK.filter(
      (day) => schedule.schedule[day] !== null && schedule.schedule[day] !== undefined
    ).length;

    return (
      <li>
        <button
          type="button"
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          className={cn(
            'w-full text-left p-4 rounded-lg border transition-all',
            'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
            isSelected
              ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
              : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
          )}
          aria-selected={isSelected}
          aria-label={`${schedule.schedule_name}, ${schedule.assigned_user_count} user${schedule.assigned_user_count !== 1 ? 's' : ''}, ${schedule.is_active ? 'active' : 'inactive'}, ${activeDays} days`}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-gray-900 truncate">{schedule.schedule_name}</h3>
            <span
              className={cn(
                'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0',
                schedule.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
              )}
            >
              {schedule.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>

          {/* User count */}
          <p className="mt-1 text-sm text-gray-600">
            {schedule.assigned_user_count} assigned user
            {schedule.assigned_user_count !== 1 ? 's' : ''}
          </p>

          {/* Mini day grid */}
          <div className="mt-2 flex gap-1">
            {DAYS_OF_WEEK.map((day) => {
              const isActive =
                schedule.schedule[day] !== null && schedule.schedule[day] !== undefined;
              return (
                <div
                  key={day}
                  className={cn(
                    'flex-1 text-center py-0.5 rounded text-[10px] font-medium',
                    isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-50 text-gray-300'
                  )}
                >
                  {DAY_SHORT[day]}
                </div>
              );
            })}
          </div>

          {/* Metadata row */}
          <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1" title={`${activeDays} active days`}>
              <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{activeDays}d</span>
            </span>

            <span
              className="flex items-center gap-1"
              title={`${schedule.assigned_user_count} assigned users`}
            >
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{schedule.assigned_user_count}</span>
            </span>

            {schedule.org_unit_name && (
              <span
                className="flex items-center gap-1 truncate"
                title={`Unit: ${schedule.org_unit_name}`}
              >
                <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="truncate max-w-[80px]">{schedule.org_unit_name}</span>
              </span>
            )}
          </div>
        </button>
      </li>
    );
  }
);

ScheduleCard.displayName = 'ScheduleCard';
