/**
 * Schedules Management Page
 *
 * Single-page interface for managing schedules with split view layout.
 * Left panel: Filterable schedule list with selection
 * Right panel: Form for create/edit with weekly grid and user assignment
 *
 * Features:
 * - Split view layout (list 1/3 + form 2/3)
 * - Select schedule -> shows editable form with weekly grid
 * - Create mode for new schedules with user assignment
 * - Deactivate/Reactivate/Delete operations
 * - Unsaved changes warning
 *
 * Route: /schedules/manage
 * Permission: user.schedule_manage
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  ScheduleList,
  ScheduleFormFields,
  ScheduleUserAssignmentDialog,
} from '@/components/schedules';
import { ScheduleListViewModel } from '@/viewModels/schedule/ScheduleListViewModel';
import { ScheduleFormViewModel } from '@/viewModels/schedule/ScheduleFormViewModel';
import { getScheduleService } from '@/services/schedule/ScheduleServiceFactory';
import type { UserSchedulePolicy } from '@/types/schedule.types';
import {
  Plus,
  Trash2,
  RefreshCw,
  ArrowLeft,
  Calendar,
  AlertTriangle,
  X,
  CheckCircle,
  XCircle,
  Save,
  Users,
} from 'lucide-react';
import { Logger } from '@/utils/logger';
import { cn } from '@/components/ui/utils';

const log = Logger.getLogger('component');

type PanelMode = 'empty' | 'edit' | 'create';

type DialogState =
  | { type: 'none' }
  | { type: 'discard' }
  | { type: 'deactivate'; isLoading: boolean }
  | { type: 'reactivate'; isLoading: boolean }
  | { type: 'delete'; isLoading: boolean }
  | { type: 'activeWarning' };

export const SchedulesManagePage: React.FC = observer(() => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialStatus = searchParams.get('status') as 'all' | 'active' | 'inactive' | null;
  const initialScheduleId = searchParams.get('scheduleId');

  const [viewModel] = useState(() => new ScheduleListViewModel());

  const [panelMode, setPanelMode] = useState<PanelMode>('empty');
  const [currentSchedule, setCurrentSchedule] = useState<UserSchedulePolicy | null>(null);
  const [formViewModel, setFormViewModel] = useState<ScheduleFormViewModel | null>(null);

  const [dialogState, setDialogState] = useState<DialogState>({ type: 'none' });
  const pendingActionRef = useRef<{ type: 'select' | 'create'; scheduleId?: string } | null>(null);

  const [operationError, setOperationError] = useState<string | null>(null);

  const [showUserAssignDialog, setShowUserAssignDialog] = useState(false);

  // Load schedules on mount
  useEffect(() => {
    log.debug('SchedulesManagePage mounted, loading data');
    if (initialStatus && initialStatus !== 'all') {
      viewModel.setStatusFilter(initialStatus);
    }
    viewModel.loadSchedules();
  }, [viewModel, initialStatus]);

  // Select and load a schedule for editing
  const selectAndLoadSchedule = useCallback(
    async (scheduleId: string) => {
      setOperationError(null);
      try {
        const service = getScheduleService();
        const fullSchedule = await service.getScheduleById(scheduleId);
        if (fullSchedule) {
          setCurrentSchedule(fullSchedule);
          setFormViewModel(new ScheduleFormViewModel(service, 'edit', fullSchedule));
          setPanelMode('edit');
          viewModel.selectSchedule(scheduleId);
          log.debug('Schedule loaded for editing', {
            scheduleId,
            name: fullSchedule.schedule_name,
          });
        } else {
          log.warn('Schedule not found', { scheduleId });
          setOperationError('Schedule could not be loaded. Please refresh the page.');
        }
      } catch (error) {
        log.error('Failed to load schedule', error);
        setOperationError('Failed to load schedule details');
      }
    },
    [viewModel]
  );

  // Handle scheduleId from URL
  useEffect(() => {
    if (
      initialScheduleId &&
      !viewModel.isLoading &&
      viewModel.schedules.length > 0 &&
      panelMode === 'empty'
    ) {
      log.debug('Loading schedule from URL param', { scheduleId: initialScheduleId });
      selectAndLoadSchedule(initialScheduleId);
    }
  }, [
    initialScheduleId,
    viewModel.isLoading,
    viewModel.schedules.length,
    panelMode,
    selectAndLoadSchedule,
  ]);

  // Handle schedule list selection with dirty check
  const handleScheduleSelect = useCallback(
    (scheduleId: string) => {
      if (scheduleId === viewModel.selectedScheduleId && panelMode === 'edit') {
        return;
      }

      if (formViewModel?.isDirty) {
        pendingActionRef.current = { type: 'select', scheduleId };
        setDialogState({ type: 'discard' });
      } else {
        selectAndLoadSchedule(scheduleId);
      }
    },
    [viewModel.selectedScheduleId, panelMode, formViewModel, selectAndLoadSchedule]
  );

  // Handle discard changes
  const handleDiscardChanges = useCallback(() => {
    const pending = pendingActionRef.current;
    setDialogState({ type: 'none' });
    pendingActionRef.current = null;

    if (pending?.type === 'select' && pending.scheduleId) {
      selectAndLoadSchedule(pending.scheduleId);
    } else if (pending?.type === 'create') {
      enterCreateMode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectAndLoadSchedule]);

  const handleCancelDiscard = useCallback(() => {
    setDialogState({ type: 'none' });
    pendingActionRef.current = null;
  }, []);

  // Enter create mode
  const enterCreateMode = useCallback(() => {
    setOperationError(null);
    const service = getScheduleService();
    setFormViewModel(new ScheduleFormViewModel(service, 'create'));
    setCurrentSchedule(null);
    setPanelMode('create');
    viewModel.clearSelection();
    log.debug('Entered create mode');
  }, [viewModel]);

  // Handle create button click with dirty check
  const handleCreateClick = useCallback(() => {
    if (formViewModel?.isDirty) {
      pendingActionRef.current = { type: 'create' };
      setDialogState({ type: 'discard' });
    } else {
      enterCreateMode();
    }
  }, [formViewModel, enterCreateMode]);

  // Handle form submission
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!formViewModel) return;

      const result = await formViewModel.submit();

      if (result.success && result.scheduleId) {
        log.info('Form submitted successfully', {
          mode: panelMode,
          scheduleId: result.scheduleId,
        });

        try {
          await viewModel.refresh();

          if (panelMode === 'create') {
            await selectAndLoadSchedule(result.scheduleId);
          } else {
            await selectAndLoadSchedule(result.scheduleId);
          }
        } catch (err) {
          log.error('Failed to transition after save', err);
          setOperationError('Schedule was saved but failed to reload. Please refresh the page.');
        }
      } else if (!result.success) {
        setOperationError(result.error || 'Failed to save schedule');
      }
    },
    [formViewModel, panelMode, viewModel, selectAndLoadSchedule]
  );

  // Handle cancel in form
  const handleCancel = useCallback(() => {
    if (panelMode === 'create') {
      if (viewModel.selectedScheduleId) {
        selectAndLoadSchedule(viewModel.selectedScheduleId);
      } else {
        setPanelMode('empty');
        setFormViewModel(null);
        setCurrentSchedule(null);
      }
    }
  }, [panelMode, viewModel.selectedScheduleId, selectAndLoadSchedule]);

  const handleBackClick = () => {
    navigate('/schedules');
  };

  // Deactivate handlers
  const handleDeactivateClick = useCallback(() => {
    if (currentSchedule && currentSchedule.is_active) {
      setOperationError(null);
      setDialogState({ type: 'deactivate', isLoading: false });
    }
  }, [currentSchedule]);

  const handleDeactivateConfirm = useCallback(async () => {
    if (!currentSchedule) return;

    setDialogState({ type: 'deactivate', isLoading: true });
    setOperationError(null);
    try {
      const result = await viewModel.deactivateSchedule(
        currentSchedule.id,
        'Deactivated from manage page'
      );

      if (result.success) {
        setDialogState({ type: 'none' });
        log.info('Schedule deactivated', { scheduleId: currentSchedule.id });
        await selectAndLoadSchedule(currentSchedule.id);
      } else {
        setDialogState({ type: 'none' });
        setOperationError(result.error || 'Failed to deactivate schedule');
      }
    } catch (error) {
      setDialogState({ type: 'none' });
      setOperationError(error instanceof Error ? error.message : 'Failed to deactivate schedule');
    }
  }, [currentSchedule, viewModel, selectAndLoadSchedule]);

  // Reactivate handlers
  const handleReactivateClick = useCallback(() => {
    if (currentSchedule && !currentSchedule.is_active) {
      setOperationError(null);
      setDialogState({ type: 'reactivate', isLoading: false });
    }
  }, [currentSchedule]);

  const handleReactivateConfirm = useCallback(async () => {
    if (!currentSchedule) return;

    setDialogState({ type: 'reactivate', isLoading: true });
    setOperationError(null);
    try {
      const result = await viewModel.reactivateSchedule(
        currentSchedule.id,
        'Reactivated from manage page'
      );

      if (result.success) {
        setDialogState({ type: 'none' });
        log.info('Schedule reactivated', { scheduleId: currentSchedule.id });
        await selectAndLoadSchedule(currentSchedule.id);
      } else {
        setDialogState({ type: 'none' });
        setOperationError(result.error || 'Failed to reactivate schedule');
      }
    } catch (error) {
      setDialogState({ type: 'none' });
      setOperationError(error instanceof Error ? error.message : 'Failed to reactivate schedule');
    }
  }, [currentSchedule, viewModel, selectAndLoadSchedule]);

  // Delete handlers
  const handleDeleteClick = useCallback(() => {
    if (!currentSchedule) return;

    if (currentSchedule.is_active) {
      setDialogState({ type: 'activeWarning' });
    } else {
      setOperationError(null);
      setDialogState({ type: 'delete', isLoading: false });
    }
  }, [currentSchedule]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!currentSchedule) return;

    setDialogState({ type: 'delete', isLoading: true });
    setOperationError(null);
    try {
      const result = await viewModel.deleteSchedule(currentSchedule.id, 'Deleted from manage page');

      if (result.success) {
        setDialogState({ type: 'none' });
        log.info('Schedule deleted', { scheduleId: currentSchedule.id });
        setPanelMode('empty');
        setFormViewModel(null);
        setCurrentSchedule(null);
      } else {
        setDialogState({ type: 'none' });
        setOperationError(result.error || 'Failed to delete schedule');
      }
    } catch (error) {
      setDialogState({ type: 'none' });
      setOperationError(error instanceof Error ? error.message : 'Failed to delete schedule');
    }
  }, [currentSchedule, viewModel]);

  const handleDeactivateFirst = useCallback(() => {
    setDialogState({ type: 'deactivate', isLoading: false });
  }, []);

  // User assignment dialog handlers
  const handleUserAssignClick = useCallback(() => {
    setShowUserAssignDialog(true);
  }, []);

  const handleUserAssignClose = useCallback(() => {
    setShowUserAssignDialog(false);
  }, []);

  const handleUserAssignConfirm = useCallback(
    (userIds: string[]) => {
      if (formViewModel) {
        formViewModel.setAssignedUserIds(userIds);
      }
      setShowUserAssignDialog(false);
    },
    [formViewModel]
  );

  // Filter handlers
  const handleSearchChange = useCallback(
    (term: string) => {
      viewModel.setSearchTerm(term);
    },
    [viewModel]
  );

  const handleStatusChange = useCallback(
    (status: 'all' | 'active' | 'inactive') => {
      viewModel.setStatusFilter(status);
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev);
          if (status === 'all') {
            newParams.delete('status');
          } else {
            newParams.set('status', status);
          }
          return newParams;
        },
        { replace: true }
      );
    },
    [viewModel, setSearchParams]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-4">
            <Button variant="outline" size="sm" onClick={handleBackClick} className="text-gray-600">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Schedules
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <Calendar className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Schedule Management</h1>
              <p className="text-gray-600 mt-1">Create and manage staff work schedules</p>
            </div>
          </div>
        </div>

        {/* Error Banner */}
        {(viewModel.error || operationError) && (
          <div className="mb-6 p-4 rounded-lg border border-red-300 bg-red-50" role="alert">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-red-800 font-semibold">Error</h3>
                <p className="text-red-700 text-sm mt-1">{viewModel.error || operationError}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  viewModel.clearError();
                  setOperationError(null);
                }}
                className="text-red-600 border-red-300"
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}

        {/* Split View Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Panel: Schedule List */}
          <div className="lg:col-span-1">
            <Card className="shadow-lg h-[calc(100vh-280px)]">
              <CardHeader className="border-b border-gray-200 pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold text-gray-900">Schedules</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => viewModel.refresh()}
                    disabled={viewModel.isLoading}
                  >
                    <RefreshCw className={cn('w-4 h-4', viewModel.isLoading && 'animate-spin')} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-4 h-[calc(100%-80px)]">
                <ScheduleList
                  schedules={viewModel.schedules}
                  selectedScheduleId={viewModel.selectedScheduleId}
                  statusFilter={viewModel.statusFilter}
                  searchTerm={viewModel.searchTerm}
                  isLoading={viewModel.isLoading}
                  onSelect={handleScheduleSelect}
                  onSearchChange={handleSearchChange}
                  onStatusChange={handleStatusChange}
                />
              </CardContent>
            </Card>
          </div>

          {/* Right Panel: Form Panel */}
          <div className="lg:col-span-2">
            {/* Create Button */}
            <Button
              onClick={handleCreateClick}
              disabled={viewModel.isLoading}
              className="w-full mb-4 bg-blue-600 hover:bg-blue-700 text-white justify-start"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create New Schedule
            </Button>

            {/* Empty State */}
            {panelMode === 'empty' && (
              <Card className="shadow-lg">
                <CardContent className="p-12 text-center">
                  <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-xl font-medium text-gray-900 mb-2">No Schedule Selected</h3>
                  <p className="text-gray-500 max-w-md mx-auto">
                    Select a schedule from the list to view and edit its details, or click "Create
                    New Schedule" to add a new one.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Create Mode */}
            {panelMode === 'create' && formViewModel && (
              <Card className="shadow-lg">
                <CardHeader className="border-b border-gray-200">
                  <CardTitle className="text-xl font-semibold text-gray-900">
                    Create New Schedule
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Submission Error */}
                    {formViewModel.submissionError && (
                      <div className="p-4 rounded-lg border border-red-300 bg-red-50" role="alert">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
                          <div className="flex-1">
                            <h4 className="text-red-800 font-semibold">
                              Failed to create schedule
                            </h4>
                            <p className="text-red-700 text-sm mt-1">
                              {formViewModel.submissionError}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => formViewModel.clearSubmissionError()}
                            className="text-red-600 hover:text-red-800"
                            aria-label="Dismiss error"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Form Fields */}
                    <ScheduleFormFields
                      scheduleName={formViewModel.formData.scheduleName}
                      schedule={formViewModel.formData.schedule}
                      effectiveFrom={formViewModel.formData.effectiveFrom}
                      effectiveUntil={formViewModel.formData.effectiveUntil}
                      onScheduleNameChange={(name) => formViewModel.setScheduleName(name)}
                      onScheduleNameBlur={() => formViewModel.touchField('scheduleName')}
                      onToggleDay={(day) => formViewModel.toggleDay(day)}
                      onSetTime={(day, field, value) => formViewModel.setDayTime(day, field, value)}
                      onEffectiveFromChange={(date) => formViewModel.setEffectiveFrom(date)}
                      onEffectiveUntilChange={(date) => formViewModel.setEffectiveUntil(date)}
                      getFieldError={(field) => formViewModel.getFieldError(field)}
                      disabled={formViewModel.isSubmitting}
                    />

                    {/* User Assignment */}
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium text-gray-700">Assign Users</h3>
                      <p className="text-xs text-gray-500">
                        {formViewModel.assignedUserIds.length === 0
                          ? 'No users assigned yet. Click below to assign users to this schedule.'
                          : `${formViewModel.assignedUserIds.length} user(s) selected`}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleUserAssignClick}
                        disabled={formViewModel.isSubmitting}
                        className="text-blue-600 border-blue-300 hover:bg-blue-50"
                      >
                        <Users className="w-4 h-4 mr-1" />
                        {formViewModel.assignedUserIds.length === 0
                          ? 'Select Users'
                          : 'Change Users'}
                      </Button>
                    </div>

                    {/* Form Actions */}
                    <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCancel}
                        disabled={formViewModel.isSubmitting}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={
                          !formViewModel.canSubmit || formViewModel.assignedUserIds.length === 0
                        }
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        {formViewModel.isSubmitting ? 'Creating...' : 'Create Schedule'}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            {/* Edit Mode */}
            {panelMode === 'edit' && currentSchedule && formViewModel && (
              <div className="space-y-4">
                {/* Inactive Warning Banner */}
                {!currentSchedule.is_active && (
                  <div className="p-4 rounded-lg border border-amber-300 bg-amber-50">
                    <div className="flex items-start gap-3">
                      <XCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h3 className="text-amber-800 font-semibold">
                          Inactive Schedule - Editing Disabled
                        </h3>
                        <p className="text-amber-700 text-sm mt-1">
                          This schedule is deactivated. The form is read-only until the schedule is
                          reactivated.
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleReactivateClick}
                        disabled={
                          formViewModel.isSubmitting ||
                          (dialogState.type === 'reactivate' && dialogState.isLoading)
                        }
                        className="bg-green-600 hover:bg-green-700 text-white flex-shrink-0"
                      >
                        <CheckCircle className="w-4 h-4 mr-1" />
                        {dialogState.type === 'reactivate' && dialogState.isLoading
                          ? 'Reactivating...'
                          : 'Reactivate'}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Form Card */}
                <Card className="shadow-lg">
                  <CardHeader className="border-b border-gray-200">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xl font-semibold text-gray-900">
                        Edit Schedule
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                            currentSchedule.is_active
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-600'
                          )}
                        >
                          {currentSchedule.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                    {currentSchedule.user_name && (
                      <p className="text-sm text-gray-500 mt-1">
                        Assigned to: {currentSchedule.user_name}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="p-6">
                    <form onSubmit={handleSubmit} className="space-y-6">
                      {/* Submission Error */}
                      {formViewModel.submissionError && (
                        <div
                          className="p-4 rounded-lg border border-red-300 bg-red-50"
                          role="alert"
                        >
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
                            <div className="flex-1">
                              <h4 className="text-red-800 font-semibold">
                                Failed to update schedule
                              </h4>
                              <p className="text-red-700 text-sm mt-1">
                                {formViewModel.submissionError}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => formViewModel.clearSubmissionError()}
                              className="text-red-600 hover:text-red-800"
                              aria-label="Dismiss error"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Form Fields */}
                      <ScheduleFormFields
                        scheduleName={formViewModel.formData.scheduleName}
                        schedule={formViewModel.formData.schedule}
                        effectiveFrom={formViewModel.formData.effectiveFrom}
                        effectiveUntil={formViewModel.formData.effectiveUntil}
                        onScheduleNameChange={(name) => formViewModel.setScheduleName(name)}
                        onScheduleNameBlur={() => formViewModel.touchField('scheduleName')}
                        onToggleDay={(day) => formViewModel.toggleDay(day)}
                        onSetTime={(day, field, value) =>
                          formViewModel.setDayTime(day, field, value)
                        }
                        onEffectiveFromChange={(date) => formViewModel.setEffectiveFrom(date)}
                        onEffectiveUntilChange={(date) => formViewModel.setEffectiveUntil(date)}
                        getFieldError={(field) => formViewModel.getFieldError(field)}
                        disabled={formViewModel.isSubmitting || !currentSchedule.is_active}
                        isEditMode
                        scheduleId={currentSchedule.id}
                      />

                      {/* Form Actions */}
                      <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                        <div>
                          {formViewModel.isDirty && (
                            <span className="text-sm text-amber-600">Unsaved changes</span>
                          )}
                        </div>
                        <Button
                          type="submit"
                          disabled={!formViewModel.canSubmit || !currentSchedule.is_active}
                          className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                          <Save className="w-4 h-4 mr-1" />
                          {formViewModel.isSubmitting ? 'Saving...' : 'Save Changes'}
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>

                {/* Danger Zone */}
                <section aria-labelledby="danger-zone-heading">
                  <Card className="shadow-lg border-red-200">
                    <CardHeader className="border-b border-red-200 bg-red-50 py-3">
                      <CardTitle
                        id="danger-zone-heading"
                        className="text-sm font-semibold text-red-800"
                      >
                        Danger Zone
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 space-y-4">
                      {/* Deactivate/Reactivate */}
                      <div className="pb-4 border-b border-gray-200">
                        {currentSchedule.is_active ? (
                          <>
                            <h4 className="text-sm font-medium text-gray-900">
                              Deactivate this schedule
                            </h4>
                            <p className="text-xs text-gray-600 mt-1">
                              Deactivating suspends this schedule assignment. It can be reactivated
                              later.
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleDeactivateClick}
                              disabled={
                                formViewModel.isSubmitting ||
                                (dialogState.type === 'deactivate' && dialogState.isLoading)
                              }
                              className="mt-2 text-orange-600 border-orange-300 hover:bg-orange-50"
                            >
                              <XCircle className="w-3 h-3 mr-1" />
                              {dialogState.type === 'deactivate' && dialogState.isLoading
                                ? 'Deactivating...'
                                : 'Deactivate Schedule'}
                            </Button>
                          </>
                        ) : (
                          <>
                            <h4 className="text-sm font-medium text-gray-900">
                              Reactivate this schedule
                            </h4>
                            <p className="text-xs text-gray-600 mt-1">
                              Reactivating restores this schedule assignment.
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleReactivateClick}
                              disabled={
                                formViewModel.isSubmitting ||
                                (dialogState.type === 'reactivate' && dialogState.isLoading)
                              }
                              className="mt-2 text-green-600 border-green-300 hover:bg-green-50"
                            >
                              <CheckCircle className="w-3 h-3 mr-1" />
                              {dialogState.type === 'reactivate' && dialogState.isLoading
                                ? 'Reactivating...'
                                : 'Reactivate Schedule'}
                            </Button>
                          </>
                        )}
                      </div>

                      {/* Delete */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-900">Delete this schedule</h4>
                        <p className="text-xs text-gray-600 mt-1">
                          Permanently remove this schedule assignment.
                          {currentSchedule.is_active && (
                            <span className="block text-orange-600 mt-1">
                              Must be deactivated before deletion.
                            </span>
                          )}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleDeleteClick}
                          disabled={
                            formViewModel.isSubmitting ||
                            (dialogState.type === 'delete' && dialogState.isLoading)
                          }
                          className="mt-2 text-red-600 border-red-300 hover:bg-red-50"
                        >
                          <Trash2 className="w-3 h-3 mr-1" />
                          {dialogState.type === 'delete' && dialogState.isLoading
                            ? 'Deleting...'
                            : 'Delete Schedule'}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </section>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Unsaved Changes Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'discard'}
        title="Unsaved Changes"
        message="You have unsaved changes. Do you want to discard them?"
        confirmLabel="Discard Changes"
        cancelLabel="Stay Here"
        onConfirm={handleDiscardChanges}
        onCancel={handleCancelDiscard}
        variant="warning"
      />

      {/* Deactivate Confirmation Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'deactivate'}
        title="Deactivate Schedule"
        message={`Are you sure you want to deactivate "${currentSchedule?.schedule_name}" for ${currentSchedule?.user_name ?? 'this user'}?`}
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        onConfirm={handleDeactivateConfirm}
        onCancel={() => setDialogState({ type: 'none' })}
        isLoading={dialogState.type === 'deactivate' && dialogState.isLoading}
        variant="warning"
      />

      {/* Reactivate Confirmation Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'reactivate'}
        title="Reactivate Schedule"
        message={`Are you sure you want to reactivate "${currentSchedule?.schedule_name}" for ${currentSchedule?.user_name ?? 'this user'}?`}
        confirmLabel="Reactivate"
        cancelLabel="Cancel"
        onConfirm={handleReactivateConfirm}
        onCancel={() => setDialogState({ type: 'none' })}
        isLoading={dialogState.type === 'reactivate' && dialogState.isLoading}
        variant="success"
      />

      {/* Active Warning Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'activeWarning'}
        title="Cannot Delete Active Schedule"
        message={`"${currentSchedule?.schedule_name}" must be deactivated before it can be deleted. Would you like to deactivate it now?`}
        confirmLabel="Deactivate First"
        cancelLabel="Cancel"
        onConfirm={handleDeactivateFirst}
        onCancel={() => setDialogState({ type: 'none' })}
        variant="warning"
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'delete'}
        title="Delete Schedule"
        message={`Are you sure you want to delete "${currentSchedule?.schedule_name}" for ${currentSchedule?.user_name ?? 'this user'}? This action is permanent and cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDialogState({ type: 'none' })}
        isLoading={dialogState.type === 'delete' && dialogState.isLoading}
        variant="danger"
      />

      {/* User Assignment Dialog */}
      <ScheduleUserAssignmentDialog
        isOpen={showUserAssignDialog}
        onClose={handleUserAssignClose}
        onConfirm={handleUserAssignConfirm}
        selectedUserIds={formViewModel?.assignedUserIds ?? []}
        title="Assign Users to Schedule"
      />
    </div>
  );
});

SchedulesManagePage.displayName = 'SchedulesManagePage';
