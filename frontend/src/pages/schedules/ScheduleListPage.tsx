/**
 * Schedule List Page
 *
 * Overview of all staff schedules in the organization.
 * Filterable by organization unit and user.
 */

import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import { Calendar, Search, X } from 'lucide-react';
import { ScheduleListViewModel } from '@/viewModels/schedule/ScheduleListViewModel';
import type { DayOfWeek } from '@/types/schedule.types';
import { DAYS_OF_WEEK } from '@/types/schedule.types';

const DAY_SHORT: Record<DayOfWeek, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};

/** Format HHMM to HH:MM display */
function formatTime(hhmm: string): string {
  if (!hhmm || hhmm.length < 4) return '—';
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
}

export const ScheduleListPage: React.FC = observer(() => {
  const [vm] = useState(() => new ScheduleListViewModel());
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    vm.loadSchedules();
  }, [vm]);

  const filteredSchedules = searchTerm
    ? vm.schedules.filter(
        (s) =>
          s.user_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          s.user_email?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : vm.schedules;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="h-6 w-6 text-blue-600" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-gray-900">Staff Schedules</h1>
        </div>
      </div>

      {/* Search and filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm
                     focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            aria-label="Search schedules"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={vm.showInactive}
            onChange={(e) => {
              vm.setShowInactive(e.target.checked);
              vm.loadSchedules();
            }}
            className="h-4 w-4 rounded border-gray-300 text-blue-600"
          />
          Show inactive
        </label>
      </div>

      {/* Loading state */}
      {vm.isLoading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" role="status">
            <span className="sr-only">Loading schedules...</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {vm.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
          {vm.error}
        </div>
      )}

      {/* Empty state */}
      {!vm.isLoading && !vm.error && filteredSchedules.length === 0 && (
        <div className="text-center py-12">
          <Calendar className="mx-auto h-12 w-12 text-gray-300" aria-hidden="true" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">No schedules found</h3>
          <p className="mt-2 text-sm text-gray-500">
            {searchTerm
              ? 'No schedules match your search criteria.'
              : 'No staff schedules have been created yet.'}
          </p>
        </div>
      )}

      {/* Schedule cards */}
      {!vm.isLoading && filteredSchedules.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSchedules.map((schedule) => (
            <button
              key={schedule.id}
              onClick={() => navigate(`/schedules/${schedule.user_id}`)}
              className="text-left rounded-xl border border-gray-200/60 bg-white/70 backdrop-blur-sm p-4
                       shadow-sm hover:shadow-md hover:border-blue-200 transition-all
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-medium text-gray-900">{schedule.user_name ?? 'Unknown User'}</p>
                  <p className="text-xs text-gray-500">{schedule.user_email}</p>
                </div>
                {!schedule.is_active && (
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                    Inactive
                  </span>
                )}
              </div>

              {schedule.org_unit_name && (
                <p className="text-xs text-gray-500 mb-2">Unit: {schedule.org_unit_name}</p>
              )}

              {/* Mini schedule view */}
              <div className="flex gap-1">
                {DAYS_OF_WEEK.map((day) => {
                  const daySchedule = schedule.schedule[day];
                  const isActive = daySchedule !== null && daySchedule !== undefined;
                  return (
                    <div
                      key={day}
                      className={`flex-1 text-center py-1 rounded text-[10px] font-medium ${
                        isActive
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-50 text-gray-300'
                      }`}
                      title={
                        isActive
                          ? `${DAY_SHORT[day]}: ${formatTime(daySchedule.begin)}–${formatTime(daySchedule.end)}`
                          : `${DAY_SHORT[day]}: Off`
                      }
                    >
                      {DAY_SHORT[day][0]}
                    </div>
                  );
                })}
              </div>

              {(schedule.effective_from || schedule.effective_until) && (
                <p className="text-[10px] text-gray-400 mt-2">
                  {schedule.effective_from && `From: ${schedule.effective_from}`}
                  {schedule.effective_from && schedule.effective_until && ' · '}
                  {schedule.effective_until && `Until: ${schedule.effective_until}`}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

ScheduleListPage.displayName = 'ScheduleListPage';
