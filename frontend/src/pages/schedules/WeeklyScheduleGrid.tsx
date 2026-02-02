/**
 * Weekly Schedule Grid Component
 *
 * Displays a 7-row grid for editing daily work schedules.
 * Each row shows day name, start time, end time, and active toggle.
 */

import React from 'react';
import { observer } from 'mobx-react-lite';
import type { WeeklySchedule, DayOfWeek } from '@/types/schedule.types';
import { DAYS_OF_WEEK } from '@/types/schedule.types';

interface WeeklyScheduleGridProps {
  schedule: WeeklySchedule;
  onToggleDay: (day: DayOfWeek) => void;
  onSetTime: (day: DayOfWeek, field: 'begin' | 'end', value: string) => void;
  disabled?: boolean;
}

/** Convert HHMM string to HH:MM for input[type=time] */
function toTimeInput(hhmm: string): string {
  if (!hhmm || hhmm.length < 4) return '';
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
}

const DAY_LABELS: Record<DayOfWeek, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

export const WeeklyScheduleGrid: React.FC<WeeklyScheduleGridProps> = observer(
  ({ schedule, onToggleDay, onSetTime, disabled }) => {
    return (
      <div className="space-y-1">
        {/* Header row */}
        <div className="grid grid-cols-[140px_1fr_1fr_60px] gap-3 px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
          <div>Day</div>
          <div>Start</div>
          <div>End</div>
          <div className="text-center">Active</div>
        </div>

        {/* Day rows */}
        {DAYS_OF_WEEK.map((day) => {
          const daySchedule = schedule[day];
          const isActive = daySchedule !== null && daySchedule !== undefined;

          return (
            <div
              key={day}
              className={`grid grid-cols-[140px_1fr_1fr_60px] gap-3 items-center px-3 py-2.5 rounded-lg transition-colors ${
                isActive ? 'bg-blue-50/50' : 'bg-gray-50/50'
              }`}
            >
              <label
                htmlFor={`schedule-${day}-active`}
                className={`text-sm font-medium ${isActive ? 'text-gray-900' : 'text-gray-400'}`}
              >
                {DAY_LABELS[day]}
              </label>

              <input
                type="time"
                id={`schedule-${day}-start`}
                aria-label={`${DAY_LABELS[day]} start time`}
                value={isActive ? toTimeInput(daySchedule.begin) : ''}
                onChange={(e) => onSetTime(day, 'begin', e.target.value)}
                disabled={disabled || !isActive}
                className="block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm
                         disabled:bg-gray-100 disabled:text-gray-400
                         focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />

              <input
                type="time"
                id={`schedule-${day}-end`}
                aria-label={`${DAY_LABELS[day]} end time`}
                value={isActive ? toTimeInput(daySchedule.end) : ''}
                onChange={(e) => onSetTime(day, 'end', e.target.value)}
                disabled={disabled || !isActive}
                className="block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm
                         disabled:bg-gray-100 disabled:text-gray-400
                         focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />

              <div className="flex justify-center">
                <input
                  type="checkbox"
                  id={`schedule-${day}-active`}
                  checked={isActive}
                  onChange={() => onToggleDay(day)}
                  disabled={disabled}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600
                           focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  aria-label={`${DAY_LABELS[day]} active`}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  }
);

WeeklyScheduleGrid.displayName = 'WeeklyScheduleGrid';
