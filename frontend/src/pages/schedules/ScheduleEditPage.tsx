/**
 * Schedule Edit Page
 *
 * Edit or create a weekly schedule for a specific user.
 * Displays a WeeklyScheduleGrid with save/reset controls.
 */

import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, Save, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WeeklyScheduleGrid } from './WeeklyScheduleGrid';
import { ScheduleEditViewModel } from '@/viewModels/schedule/ScheduleEditViewModel';

export const ScheduleEditPage: React.FC = observer(() => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [vm] = useState(() => new ScheduleEditViewModel());

  useEffect(() => {
    if (userId) {
      vm.loadSchedule(userId);
    }
  }, [vm, userId]);

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/schedules')}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="Back to schedules"
        >
          <ArrowLeft className="h-5 w-5 text-gray-600" />
        </button>
        <Calendar className="h-6 w-6 text-blue-600" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {vm.isNewSchedule ? 'Create Schedule' : 'Edit Schedule'}
          </h1>
          {vm.existingSchedule && (
            <p className="text-sm text-gray-500">
              {vm.existingSchedule.user_name ?? vm.existingSchedule.user_email}
            </p>
          )}
        </div>
      </div>

      {/* Loading */}
      {vm.isLoading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" role="status">
            <span className="sr-only">Loading schedule...</span>
          </div>
        </div>
      )}

      {/* Error */}
      {vm.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
          {vm.error}
        </div>
      )}

      {/* Schedule editor */}
      {!vm.isLoading && !vm.error && (
        <div className="rounded-xl border border-gray-200/60 bg-white/70 backdrop-blur-sm p-6 shadow-sm">
          <WeeklyScheduleGrid
            schedule={vm.editedSchedule}
            onToggleDay={(day) => vm.toggleDay(day)}
            onSetTime={(day, field, value) => vm.setDayTime(day, field, value)}
            disabled={vm.isSaving}
          />

          {/* Reason input */}
          <div className="mt-6">
            <label htmlFor="schedule-reason" className="block text-sm font-medium text-gray-700 mb-1">
              Reason for change
            </label>
            <input
              id="schedule-reason"
              type="text"
              value={vm.reason}
              onChange={(e) => vm.setReason(e.target.value)}
              placeholder="Describe why you are making this change (min. 10 characters)"
              disabled={vm.isSaving}
              aria-describedby="schedule-reason-hint"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm
                       focus:border-blue-500 focus:ring-1 focus:ring-blue-500
                       disabled:bg-gray-100"
            />
            <p id="schedule-reason-hint" className="mt-1 text-xs text-gray-400">
              {vm.reason.length}/10 characters minimum
            </p>
          </div>

          {/* Save error */}
          {vm.saveError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
              {vm.saveError}
            </div>
          )}

          {/* Save success */}
          {vm.saveSuccess && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700" role="status">
              Schedule saved successfully.
            </div>
          )}

          {/* Actions */}
          <div className="mt-6 flex items-center gap-3">
            <Button
              onClick={() => vm.save()}
              disabled={!vm.canSave}
              className="inline-flex items-center gap-2"
            >
              {vm.isSaving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Schedule
                </>
              )}
            </Button>

            <Button
              variant="outline"
              onClick={() => vm.resetChanges()}
              disabled={!vm.hasChanges || vm.isSaving}
              className="inline-flex items-center gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
          </div>
        </div>
      )}
    </div>
  );
});

ScheduleEditPage.displayName = 'ScheduleEditPage';
