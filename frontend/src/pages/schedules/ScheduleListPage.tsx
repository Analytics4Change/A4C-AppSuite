/**
 * Schedule List Page
 *
 * Card-based listing of schedule templates with status tabs, search, and quick actions.
 * Mirrors RolesPage pattern.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Plus, Search, Calendar, Users } from 'lucide-react';
import { ScheduleListViewModel } from '@/viewModels/schedule/ScheduleListViewModel';
import type { ScheduleTemplate, DayOfWeek } from '@/types/schedule.types';
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
  template: ScheduleTemplate;
  onClick: () => void;
  isLoading: boolean;
}> = ({ template, onClick, isLoading }) => {
  const activeDays = DAYS_OF_WEEK.filter(
    (day) => template.schedule[day] !== null && template.schedule[day] !== undefined
  ).length;

  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      className="text-left rounded-xl border border-gray-200/60 bg-white/70 backdrop-blur-sm p-4
               shadow-sm hover:shadow-md hover:border-blue-200 transition-all w-full
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      aria-label={`${template.schedule_name}, ${template.assigned_user_count} user${template.assigned_user_count !== 1 ? 's' : ''}, ${template.is_active ? 'active' : 'inactive'}`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">{template.schedule_name}</p>
          <p className="text-sm text-gray-600 truncate flex items-center gap-1">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {template.assigned_user_count} assigned user
            {template.assigned_user_count !== 1 ? 's' : ''}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0 ml-2',
            template.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
          )}
        >
          {template.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>

      {template.org_unit_name && (
        <p className="text-xs text-gray-500 mb-2">Unit: {template.org_unit_name}</p>
      )}

      {/* Mini day grid */}
      <div className="flex gap-1">
        {DAYS_OF_WEEK.map((day) => {
          const daySchedule = template.schedule[day];
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
    templateId: string;
    templateName: string;
    action: 'deactivate' | 'reactivate';
  }>({ isOpen: false, templateId: '', templateName: '', action: 'deactivate' });

  useEffect(() => {
    log.debug('ScheduleListPage mounting, loading templates');
    viewModel.loadTemplates();
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

  const handleCardClick = (template: ScheduleTemplate) => {
    navigate(`/schedules/manage?templateId=${template.id}`);
  };

  const handleConfirmAction = async () => {
    if (confirmDialog.action === 'deactivate') {
      await viewModel.deactivateTemplate(confirmDialog.templateId, 'Deactivated from list view');
    } else {
      await viewModel.reactivateTemplate(confirmDialog.templateId, 'Reactivated from list view');
    }
    setConfirmDialog({ ...confirmDialog, isOpen: false });
  };

  return (
    <div>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Schedule Templates</h1>
          <p className="text-gray-600 mt-1">Manage staff work schedule templates</p>
        </div>
        <Button
          className="flex items-center gap-2"
          onClick={handleCreateClick}
          disabled={viewModel.isLoading}
        >
          <Plus size={20} />
          Create Template
        </Button>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-4" role="group" aria-label="Filter by status">
        {(['all', 'active', 'inactive'] as const).map((status) => {
          const count =
            status === 'all'
              ? viewModel.templateCount
              : status === 'active'
                ? viewModel.activeTemplateCount
                : viewModel.templateCount - viewModel.activeTemplateCount;
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
          placeholder="Search by name or unit..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 max-w-md"
          aria-label="Search schedule templates"
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
      {viewModel.isLoading && viewModel.templates.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-gray-500">
            <Calendar className="w-6 h-6 animate-pulse" />
            <span>Loading schedule templates...</span>
          </div>
        </div>
      )}

      {/* Schedule Grid */}
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        data-testid="schedule-list"
      >
        {viewModel.templates.map((template) => (
          <ScheduleGridCard
            key={template.id}
            template={template}
            onClick={() => handleCardClick(template)}
            isLoading={viewModel.isLoading}
          />
        ))}
      </div>

      {/* Empty State */}
      {!viewModel.isLoading && viewModel.templates.length === 0 && (
        <div className="text-center py-12">
          {viewModel.templateCount === 0 ? (
            <div>
              <Calendar className="w-12 h-12 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500 mb-4">No schedule templates defined yet.</p>
              <Button onClick={handleCreateClick}>
                <Plus size={16} className="mr-2" />
                Create Your First Template
              </Button>
            </div>
          ) : (
            <p className="text-gray-500">No templates match your search.</p>
          )}
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={
          confirmDialog.action === 'deactivate'
            ? 'Deactivate Schedule Template'
            : 'Reactivate Schedule Template'
        }
        message={
          confirmDialog.action === 'deactivate'
            ? `Are you sure you want to deactivate "${confirmDialog.templateName}"?`
            : `Are you sure you want to reactivate "${confirmDialog.templateName}"?`
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
