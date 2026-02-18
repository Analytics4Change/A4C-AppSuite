/**
 * Schedules Management Page
 *
 * Single-page interface for managing schedule templates with split view layout.
 * Left panel: Filterable template list with selection
 * Right panel: Form for create/edit with weekly grid and user assignment
 *
 * Features:
 * - Split view layout (list 1/3 + form 2/3)
 * - Select template -> shows editable form with weekly grid
 * - Create mode for new templates with user assignment
 * - Deactivate/Reactivate/Delete operations with structured error handling
 * - DangerZone component for destructive operations
 * - Unsaved changes warning
 *
 * Route: /schedules/manage
 * Permission: user.schedule_manage
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DangerZone } from '@/components/ui/DangerZone';
import {
  ScheduleList,
  ScheduleFormFields,
  ScheduleUserAssignmentDialog,
  ScheduleAssignmentDialog,
} from '@/components/schedules';
import { ScheduleListViewModel } from '@/viewModels/schedule/ScheduleListViewModel';
import { ScheduleFormViewModel } from '@/viewModels/schedule/ScheduleFormViewModel';
import { ScheduleAssignmentViewModel } from '@/viewModels/schedule/ScheduleAssignmentViewModel';
import { getScheduleService } from '@/services/schedule/ScheduleServiceFactory';
import type { ScheduleTemplateDetail } from '@/types/schedule.types';
import {
  Plus,
  RefreshCw,
  ArrowLeft,
  Calendar,
  AlertTriangle,
  X,
  XCircle,
  CheckCircle,
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
  | { type: 'activeWarning' }
  | { type: 'hasUsers'; users: string[] };

export const SchedulesManagePage: React.FC = observer(() => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialStatus = searchParams.get('status') as 'all' | 'active' | 'inactive' | null;
  const initialTemplateId = searchParams.get('templateId');

  const [viewModel] = useState(() => new ScheduleListViewModel());

  const [panelMode, setPanelMode] = useState<PanelMode>('empty');
  const [currentTemplate, setCurrentTemplate] = useState<ScheduleTemplateDetail | null>(null);
  const [formViewModel, setFormViewModel] = useState<ScheduleFormViewModel | null>(null);

  const [dialogState, setDialogState] = useState<DialogState>({ type: 'none' });
  const pendingActionRef = useRef<{ type: 'select' | 'create'; templateId?: string } | null>(null);

  const [operationError, setOperationError] = useState<string | null>(null);

  const [showUserAssignDialog, setShowUserAssignDialog] = useState(false);
  const [showManageAssignDialog, setShowManageAssignDialog] = useState(false);

  // Memoize the ScheduleAssignmentViewModel on currentTemplate ID only
  // This prevents recreation on every render while recreating when the template changes
  const scheduleAssignVM = useMemo(() => {
    if (!currentTemplate) return null;
    return new ScheduleAssignmentViewModel(getScheduleService(), {
      id: currentTemplate.id,
      name: currentTemplate.schedule_name,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTemplate?.id]);

  // Load templates on mount
  useEffect(() => {
    log.debug('SchedulesManagePage mounted, loading data');
    if (initialStatus && initialStatus !== 'all') {
      viewModel.setStatusFilter(initialStatus);
    }
    viewModel.loadTemplates();
  }, [viewModel, initialStatus]);

  // Select and load a template for editing
  const selectAndLoadTemplate = useCallback(
    async (templateId: string) => {
      setOperationError(null);
      try {
        const service = getScheduleService();
        const detail = await service.getTemplate(templateId);
        if (detail) {
          setCurrentTemplate(detail);
          setFormViewModel(new ScheduleFormViewModel(service, 'edit', detail));
          setPanelMode('edit');
          viewModel.selectTemplate(templateId);
          log.debug('Template loaded for editing', {
            templateId,
            name: detail.schedule_name,
          });
        } else {
          log.warn('Template not found', { templateId });
          setOperationError('Template could not be loaded. Please refresh the page.');
        }
      } catch (error) {
        log.error('Failed to load template', error);
        setOperationError('Failed to load template details');
      }
    },
    [viewModel]
  );

  // Handle templateId from URL
  useEffect(() => {
    if (
      initialTemplateId &&
      !viewModel.isLoading &&
      viewModel.templates.length > 0 &&
      panelMode === 'empty'
    ) {
      log.debug('Loading template from URL param', { templateId: initialTemplateId });
      selectAndLoadTemplate(initialTemplateId);
    }
  }, [
    initialTemplateId,
    viewModel.isLoading,
    viewModel.templates.length,
    panelMode,
    selectAndLoadTemplate,
  ]);

  // Handle template list selection with dirty check
  const handleTemplateSelect = useCallback(
    (templateId: string) => {
      if (templateId === viewModel.selectedTemplateId && panelMode === 'edit') {
        return;
      }

      if (formViewModel?.isDirty) {
        pendingActionRef.current = { type: 'select', templateId };
        setDialogState({ type: 'discard' });
      } else {
        selectAndLoadTemplate(templateId);
      }
    },
    [viewModel.selectedTemplateId, panelMode, formViewModel, selectAndLoadTemplate]
  );

  // Handle discard changes
  const handleDiscardChanges = useCallback(() => {
    const pending = pendingActionRef.current;
    setDialogState({ type: 'none' });
    pendingActionRef.current = null;

    if (pending?.type === 'select' && pending.templateId) {
      selectAndLoadTemplate(pending.templateId);
    } else if (pending?.type === 'create') {
      enterCreateMode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectAndLoadTemplate]);

  const handleCancelDiscard = useCallback(() => {
    setDialogState({ type: 'none' });
    pendingActionRef.current = null;
  }, []);

  // Enter create mode
  const enterCreateMode = useCallback(() => {
    setOperationError(null);
    const service = getScheduleService();
    setFormViewModel(new ScheduleFormViewModel(service, 'create'));
    setCurrentTemplate(null);
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

      if (result.success && result.templateId) {
        log.info('Form submitted successfully', {
          mode: panelMode,
          templateId: result.templateId,
        });

        try {
          await viewModel.refresh();
          await selectAndLoadTemplate(result.templateId);
        } catch (err) {
          log.error('Failed to transition after save', err);
          setOperationError('Template was saved but failed to reload. Please refresh the page.');
        }
      } else if (!result.success) {
        setOperationError(result.error || 'Failed to save template');
      }
    },
    [formViewModel, panelMode, viewModel, selectAndLoadTemplate]
  );

  // Handle cancel in form
  const handleCancel = useCallback(() => {
    if (panelMode === 'create') {
      if (viewModel.selectedTemplateId) {
        selectAndLoadTemplate(viewModel.selectedTemplateId);
      } else {
        setPanelMode('empty');
        setFormViewModel(null);
        setCurrentTemplate(null);
      }
    }
  }, [panelMode, viewModel.selectedTemplateId, selectAndLoadTemplate]);

  const handleBackClick = () => {
    navigate('/schedules');
  };

  // Deactivate handlers
  const handleDeactivateClick = useCallback(() => {
    if (currentTemplate && currentTemplate.is_active) {
      setOperationError(null);
      setDialogState({ type: 'deactivate', isLoading: false });
    }
  }, [currentTemplate]);

  const handleDeactivateConfirm = useCallback(async () => {
    if (!currentTemplate) return;

    setDialogState({ type: 'deactivate', isLoading: true });
    setOperationError(null);
    try {
      const result = await viewModel.deactivateTemplate(
        currentTemplate.id,
        'Deactivated from manage page'
      );

      if (result.success) {
        setDialogState({ type: 'none' });
        log.info('Template deactivated', { templateId: currentTemplate.id });
        await selectAndLoadTemplate(currentTemplate.id);
      } else {
        setDialogState({ type: 'none' });
        setOperationError(result.error || 'Failed to deactivate template');
      }
    } catch (error) {
      setDialogState({ type: 'none' });
      setOperationError(error instanceof Error ? error.message : 'Failed to deactivate template');
    }
  }, [currentTemplate, viewModel, selectAndLoadTemplate]);

  // Reactivate handlers
  const handleReactivateClick = useCallback(() => {
    if (currentTemplate && !currentTemplate.is_active) {
      setOperationError(null);
      setDialogState({ type: 'reactivate', isLoading: false });
    }
  }, [currentTemplate]);

  const handleReactivateConfirm = useCallback(async () => {
    if (!currentTemplate) return;

    setDialogState({ type: 'reactivate', isLoading: true });
    setOperationError(null);
    try {
      const result = await viewModel.reactivateTemplate(
        currentTemplate.id,
        'Reactivated from manage page'
      );

      if (result.success) {
        setDialogState({ type: 'none' });
        log.info('Template reactivated', { templateId: currentTemplate.id });
        await selectAndLoadTemplate(currentTemplate.id);
      } else {
        setDialogState({ type: 'none' });
        setOperationError(result.error || 'Failed to reactivate template');
      }
    } catch (error) {
      setDialogState({ type: 'none' });
      setOperationError(error instanceof Error ? error.message : 'Failed to reactivate template');
    }
  }, [currentTemplate, viewModel, selectAndLoadTemplate]);

  // Delete handlers — with structured error handling (HAS_USERS, STILL_ACTIVE)
  const handleDeleteClick = useCallback(() => {
    if (!currentTemplate) return;

    if (currentTemplate.is_active) {
      setDialogState({ type: 'activeWarning' });
    } else {
      setOperationError(null);
      setDialogState({ type: 'delete', isLoading: false });
    }
  }, [currentTemplate]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!currentTemplate) return;

    setDialogState({ type: 'delete', isLoading: true });
    setOperationError(null);
    try {
      const result = await viewModel.deleteTemplate(currentTemplate.id, 'Deleted from manage page');

      if (result.success) {
        setDialogState({ type: 'none' });
        log.info('Template deleted', { templateId: currentTemplate.id });
        setPanelMode('empty');
        setFormViewModel(null);
        setCurrentTemplate(null);
      } else if (result.errorDetails?.code === 'HAS_USERS') {
        // Show dialog listing assigned user names
        setDialogState({ type: 'none' });
        const userNames = currentTemplate.assigned_users.map(
          (u) => u.user_name || u.user_email || u.user_id
        );
        setDialogState({ type: 'hasUsers', users: userNames });
      } else if (result.errorDetails?.code === 'STILL_ACTIVE') {
        setDialogState({ type: 'activeWarning' });
      } else {
        setDialogState({ type: 'none' });
        setOperationError(result.error || 'Failed to delete template');
      }
    } catch (error) {
      setDialogState({ type: 'none' });
      setOperationError(error instanceof Error ? error.message : 'Failed to delete template');
    }
  }, [currentTemplate, viewModel]);

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

  // Manage assignments dialog handlers (edit mode)
  const handleManageAssignClick = useCallback(() => {
    setShowManageAssignDialog(true);
  }, []);

  const handleManageAssignClose = useCallback(() => {
    setShowManageAssignDialog(false);
  }, []);

  const handleManageAssignSuccess = useCallback(async () => {
    // Refresh template data and list after successful assignment changes
    if (currentTemplate) {
      await selectAndLoadTemplate(currentTemplate.id);
    }
    await viewModel.refresh();
  }, [currentTemplate, selectAndLoadTemplate, viewModel]);

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
              <h1 className="text-3xl font-bold text-gray-900">Schedule Template Management</h1>
              <p className="text-gray-600 mt-1">Create and manage staff work schedule templates</p>
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
          {/* Left Panel: Template List */}
          <div className="lg:col-span-1">
            <Card className="shadow-lg h-[calc(100vh-280px)]">
              <CardHeader className="border-b border-gray-200 pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold text-gray-900">Templates</CardTitle>
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
                  schedules={viewModel.templates}
                  selectedTemplateId={viewModel.selectedTemplateId}
                  statusFilter={viewModel.statusFilter}
                  searchTerm={viewModel.searchTerm}
                  isLoading={viewModel.isLoading}
                  onSelect={handleTemplateSelect}
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
              Create New Template
            </Button>

            {/* Empty State */}
            {panelMode === 'empty' && (
              <Card className="shadow-lg">
                <CardContent className="p-12 text-center">
                  <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-xl font-medium text-gray-900 mb-2">No Template Selected</h3>
                  <p className="text-gray-500 max-w-md mx-auto">
                    Select a template from the list to view and edit its details, or click "Create
                    New Template" to add a new one.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Create Mode */}
            {panelMode === 'create' && formViewModel && (
              <Card className="shadow-lg">
                <CardHeader className="border-b border-gray-200">
                  <CardTitle className="text-xl font-semibold text-gray-900">
                    Create New Template
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
                              Failed to create template
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
                      onScheduleNameChange={(name) => formViewModel.setScheduleName(name)}
                      onScheduleNameBlur={() => formViewModel.touchField('scheduleName')}
                      onToggleDay={(day) => formViewModel.toggleDay(day)}
                      onSetTime={(day, field, value) => formViewModel.setDayTime(day, field, value)}
                      getFieldError={(field) => formViewModel.getFieldError(field)}
                      disabled={formViewModel.isSubmitting}
                    />

                    {/* User Assignment */}
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium text-gray-700">Assign Users</h3>
                      <p className="text-xs text-gray-500">
                        {formViewModel.assignedUserIds.length === 0
                          ? 'No users assigned yet. Click below to assign users to this template.'
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
                        {formViewModel.isSubmitting ? 'Creating...' : 'Create Template'}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            {/* Edit Mode */}
            {panelMode === 'edit' && currentTemplate && formViewModel && (
              <div className="space-y-4">
                {/* Inactive Warning Banner */}
                {!currentTemplate.is_active && (
                  <div className="p-4 rounded-lg border border-amber-300 bg-amber-50">
                    <div className="flex items-start gap-3">
                      <XCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h3 className="text-amber-800 font-semibold">
                          Inactive Template - Editing Disabled
                        </h3>
                        <p className="text-amber-700 text-sm mt-1">
                          This template is deactivated. The form is read-only until the template is
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
                        Edit Template
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        {currentTemplate.is_active && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleManageAssignClick}
                            className="text-blue-600 border-blue-300 hover:bg-blue-50"
                          >
                            <Users className="w-4 h-4 mr-1" />
                            Manage User Assignments
                          </Button>
                        )}
                        <span
                          className={cn(
                            'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                            currentTemplate.is_active
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-600'
                          )}
                        >
                          {currentTemplate.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      {currentTemplate.assigned_user_count} assigned user
                      {currentTemplate.assigned_user_count !== 1 ? 's' : ''}
                    </p>
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
                                Failed to update template
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
                        onScheduleNameChange={(name) => formViewModel.setScheduleName(name)}
                        onScheduleNameBlur={() => formViewModel.touchField('scheduleName')}
                        onToggleDay={(day) => formViewModel.toggleDay(day)}
                        onSetTime={(day, field, value) =>
                          formViewModel.setDayTime(day, field, value)
                        }
                        getFieldError={(field) => formViewModel.getFieldError(field)}
                        disabled={formViewModel.isSubmitting || !currentTemplate.is_active}
                        isEditMode
                        templateId={currentTemplate.id}
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
                          disabled={!formViewModel.canSubmit || !currentTemplate.is_active}
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
                <DangerZone
                  entityType="Template"
                  isActive={currentTemplate.is_active}
                  isSubmitting={formViewModel.isSubmitting}
                  canDeactivate={currentTemplate.is_active}
                  onDeactivate={handleDeactivateClick}
                  isDeactivating={dialogState.type === 'deactivate' && dialogState.isLoading}
                  deactivateDescription="Deactivating suspends this template for all assigned users. It can be reactivated later."
                  deactivateSlot={
                    currentTemplate.assigned_user_count > 0 ? (
                      <span className="block text-orange-600 text-xs mt-1">
                        This will suspend the schedule for all {currentTemplate.assigned_user_count}{' '}
                        assigned user
                        {currentTemplate.assigned_user_count !== 1 ? 's' : ''}.
                      </span>
                    ) : undefined
                  }
                  canReactivate={!currentTemplate.is_active}
                  onReactivate={handleReactivateClick}
                  isReactivating={dialogState.type === 'reactivate' && dialogState.isLoading}
                  reactivateDescription="Reactivating restores this template for all assigned users."
                  reactivateSlot={
                    currentTemplate.assigned_user_count > 0 ? (
                      <span className="block text-green-600 text-xs mt-1">
                        This will reactivate the schedule for all{' '}
                        {currentTemplate.assigned_user_count} assigned user
                        {currentTemplate.assigned_user_count !== 1 ? 's' : ''}.
                      </span>
                    ) : undefined
                  }
                  canDelete
                  onDelete={handleDeleteClick}
                  isDeleting={dialogState.type === 'delete' && dialogState.isLoading}
                  deleteDescription="Permanently remove this schedule template."
                  activeDeleteConstraint="Must be deactivated before deletion."
                />
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
        title="Deactivate Template"
        message={`Are you sure you want to deactivate "${currentTemplate?.schedule_name}"? This will suspend the schedule for all ${currentTemplate?.assigned_user_count ?? 0} assigned user${(currentTemplate?.assigned_user_count ?? 0) !== 1 ? 's' : ''}.`}
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
        title="Reactivate Template"
        message={`Are you sure you want to reactivate "${currentTemplate?.schedule_name}"? This will reactivate the schedule for all ${currentTemplate?.assigned_user_count ?? 0} assigned user${(currentTemplate?.assigned_user_count ?? 0) !== 1 ? 's' : ''}.`}
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
        title="Cannot Delete Active Template"
        message={`"${currentTemplate?.schedule_name}" must be deactivated before it can be deleted. Would you like to deactivate it now?`}
        confirmLabel="Deactivate First"
        cancelLabel="Cancel"
        onConfirm={handleDeactivateFirst}
        onCancel={() => setDialogState({ type: 'none' })}
        variant="warning"
      />

      {/* Has Users Warning Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'hasUsers'}
        title="Cannot Delete Template"
        message={`"${currentTemplate?.schedule_name}" has assigned users that must be removed before deletion.`}
        details={dialogState.type === 'hasUsers' ? dialogState.users : []}
        confirmLabel="OK"
        cancelLabel="Close"
        onConfirm={() => setDialogState({ type: 'none' })}
        onCancel={() => setDialogState({ type: 'none' })}
        variant="warning"
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'delete'}
        title="Delete Template"
        message={`Are you sure you want to delete "${currentTemplate?.schedule_name}"? This action is permanent and cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDialogState({ type: 'none' })}
        isLoading={dialogState.type === 'delete' && dialogState.isLoading}
        variant="danger"
        requireConfirmText="DELETE"
      />

      {/* Manage Assignments Dialog (edit mode - delta tracking) */}
      {scheduleAssignVM && (
        <ScheduleAssignmentDialog
          viewModel={scheduleAssignVM}
          isOpen={showManageAssignDialog}
          onClose={handleManageAssignClose}
          onSuccess={handleManageAssignSuccess}
        />
      )}

      {/* User Assignment Dialog (create mode - simple picker) */}
      <ScheduleUserAssignmentDialog
        isOpen={showUserAssignDialog}
        onClose={handleUserAssignClose}
        onConfirm={handleUserAssignConfirm}
        selectedUserIds={formViewModel?.assignedUserIds ?? []}
        title="Assign Users to Template"
      />
    </div>
  );
});

SchedulesManagePage.displayName = 'SchedulesManagePage';
