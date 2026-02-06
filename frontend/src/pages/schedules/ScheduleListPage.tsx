/**
 * Schedule List Page
 *
 * Card-based listing of schedules with status tabs, search, and quick actions.
 * Mirrors RolesPage pattern.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Plus, Search, Calendar } from 'lucide-react';
import { ScheduleListViewModel } from '@/viewModels/schedule/ScheduleListViewModel';
import type { UserSchedulePolicy, DayOfWeek } from '@/types/schedule.types';
import { DAYS_OF_WEEK } from '@/types/schedule.types';
import { cn } from '@/components/ui/utils';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

const DAY_SHORT: Record<DayOfWeek, string> = {
  monday: 'M',
  tuesday: 'T',
  wednesday: 'W',
  thursday: 'T',
  friday: 'F',
  saturday: 'S',
  sunday: 'S',
};

function formatTime(hhmm: string): string {
  if (!hhmm || hhmm.length < 4) return '';
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
}

const ScheduleGridCard: React.FC<{
  schedule: UserSchedulePolicy;
  onClick: () => void;
  isLoading: boolean;
}> = ({ schedule, onClick, isLoading }) => {
  const activeDays = DAYS_OF_WEEK.filter(
    (day) => schedule.schedule[day] !== null && schedule.schedule[day] !== undefined
  ).length;

  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      className="text-left rounded-xl border border-gray-200/60 bg-white/70 backdrop-blur-sm p-4
               shadow-sm hover:shadow-md hover:border-blue-200 transition-all w-full
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      aria-label={`${schedule.schedule_name}, ${schedule.user_name ?? 'unassigned'}, ${schedule.is_active ? 'active' : 'inactive'}`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">{schedule.schedule_name}</p>
          <p className="text-sm text-gray-600 truncate">
            {schedule.user_name ?? schedule.user_email ?? 'Unknown User'}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0 ml-2',
            schedule.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
          )}
        >
          {schedule.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>

      {schedule.org_unit_name && (
        <p className="text-xs text-gray-500 mb-2">Unit: {schedule.org_unit_name}</p>
      )}

      {/* Mini day grid */}
      <div className="flex gap-1">
        {DAYS_OF_WEEK.map((day) => {
          const daySchedule = schedule.schedule[day];
          const isActive = daySchedule !== null && daySchedule !== undefined;
          return (
            <div
              key={day}
              className={cn(
                'flex-1 text-center py-1 rounded text-[10px] font-medium',
                isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-50 text-gray-300'
              )}
              title={
                isActive && daySchedule
                  ? `${DAY_SHORT[day]}: ${formatTime(daySchedule.begin)}-${formatTime(daySchedule.end)}`
                  : `${DAY_SHORT[day]}: Off`
              }
            >
              {DAY_SHORT[day]}
            </div>
          );
        })}
      </div>

      {/* Metadata */}
      <div className="mt-2 flex items-center gap-3 text-[10px] text-gray-400">
        <span>
          {activeDays} day{activeDays !== 1 ? 's' : ''}
        </span>
        {schedule.effective_from && <span>From: {schedule.effective_from}</span>}
      </div>
    </button>
  );
};

export const ScheduleListPage: React.FC = observer(() => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const viewModel = useMemo(() => new ScheduleListViewModel(), []);

  const [searchTerm, setSearchTerm] = useState('');
  const statusParam = searchParams.get('status') as 'all' | 'active' | 'inactive' | null;
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>(
    statusParam || 'all'
  );

  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    scheduleId: string;
    scheduleName: string;
    action: 'deactivate' | 'reactivate';
  }>({ isOpen: false, scheduleId: '', scheduleName: '', action: 'deactivate' });

  useEffect(() => {
    log.debug('ScheduleListPage mounting, loading schedules');
    viewModel.loadSchedules();
  }, [viewModel]);

  // Sync local filter to viewModel
  useEffect(() => {
    viewModel.setStatusFilter(statusFilter);
    viewModel.setSearchTerm(searchTerm);
  }, [viewModel, statusFilter, searchTerm]);

  const handleStatusFilterChange = useCallback(
    (newStatus: 'all' | 'active' | 'inactive') => {
      setStatusFilter(newStatus);
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev);
          if (newStatus === 'all') {
            newParams.delete('status');
          } else {
            newParams.set('status', newStatus);
          }
          return newParams;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const handleCreateClick = () => {
    const params = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
    navigate(`/schedules/manage${params}`);
  };

  const handleCardClick = (schedule: UserSchedulePolicy) => {
    navigate(`/schedules/manage?scheduleId=${schedule.id}`);
  };

  const handleConfirmAction = async () => {
    if (confirmDialog.action === 'deactivate') {
      await viewModel.deactivateSchedule(confirmDialog.scheduleId, 'Deactivated from list view');
    } else {
      await viewModel.reactivateSchedule(confirmDialog.scheduleId, 'Reactivated from list view');
    }
    setConfirmDialog({ ...confirmDialog, isOpen: false });
  };

  return (
    <div>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Schedules</h1>
          <p className="text-gray-600 mt-1">Manage staff work schedules</p>
        </div>
        <Button
          className="flex items-center gap-2"
          onClick={handleCreateClick}
          disabled={viewModel.isLoading}
        >
          <Plus size={20} />
          Create Schedule
        </Button>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-4" role="group" aria-label="Filter by status">
        {(['all', 'active', 'inactive'] as const).map((status) => {
          const count =
            status === 'all'
              ? viewModel.scheduleCount
              : status === 'active'
                ? viewModel.activeScheduleCount
                : viewModel.scheduleCount - viewModel.activeScheduleCount;
          return (
            <Button
              key={status}
              variant={statusFilter === status ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleStatusFilterChange(status)}
              aria-pressed={statusFilter === status}
              className={
                statusFilter === status
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'hover:bg-gray-100'
              }
            >
              {status.charAt(0).toUpperCase() + status.slice(1)} ({count})
            </Button>
          );
        })}
      </div>

      {/* Search Bar */}
      <div className="relative mb-6">
        <Search
          className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
          size={20}
        />
        <Input
          type="search"
          placeholder="Search by name, user, or email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 max-w-md"
          aria-label="Search schedules"
        />
      </div>

      {/* Error */}
      {viewModel.error && (
        <div
          className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700"
          role="alert"
        >
          {viewModel.error}
          <Button
            variant="ghost"
            size="sm"
            className="ml-4 text-red-600 hover:text-red-800"
            onClick={() => viewModel.clearError()}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Loading */}
      {viewModel.isLoading && viewModel.schedules.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-gray-500">
            <Calendar className="w-6 h-6 animate-pulse" />
            <span>Loading schedules...</span>
          </div>
        </div>
      )}

      {/* Schedule Grid */}
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        data-testid="schedule-list"
      >
        {viewModel.schedules.map((schedule) => (
          <ScheduleGridCard
            key={schedule.id}
            schedule={schedule}
            onClick={() => handleCardClick(schedule)}
            isLoading={viewModel.isLoading}
          />
        ))}
      </div>

      {/* Empty State */}
      {!viewModel.isLoading && viewModel.schedules.length === 0 && (
        <div className="text-center py-12">
          {viewModel.scheduleCount === 0 ? (
            <div>
              <Calendar className="w-12 h-12 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500 mb-4">No schedules defined yet.</p>
              <Button onClick={handleCreateClick}>
                <Plus size={16} className="mr-2" />
                Create Your First Schedule
              </Button>
            </div>
          ) : (
            <p className="text-gray-500">No schedules match your search.</p>
          )}
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={
          confirmDialog.action === 'deactivate' ? 'Deactivate Schedule' : 'Reactivate Schedule'
        }
        message={
          confirmDialog.action === 'deactivate'
            ? `Are you sure you want to deactivate "${confirmDialog.scheduleName}"?`
            : `Are you sure you want to reactivate "${confirmDialog.scheduleName}"?`
        }
        confirmLabel={confirmDialog.action === 'deactivate' ? 'Deactivate' : 'Reactivate'}
        cancelLabel="Cancel"
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        isLoading={viewModel.isLoading}
        variant={confirmDialog.action === 'deactivate' ? 'warning' : 'success'}
      />
    </div>
  );
});

ScheduleListPage.displayName = 'ScheduleListPage';
