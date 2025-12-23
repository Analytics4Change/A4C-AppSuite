/**
 * Organization Unit Edit Page
 *
 * Form page for editing existing organizational units with split layout.
 *
 * Features:
 * - Split view: Tree hierarchy on left, form on right
 * - Load existing unit by ID from URL param
 * - Interactive tree navigation (click to edit different unit)
 * - Unsaved changes confirmation dialog
 * - Name and display name editing
 * - Timezone editing
 * - Active/inactive status toggle
 * - Form validation with field-level errors
 * - Submit and cancel actions
 * - Not found state handling
 *
 * Route: /organization-units/:unitId/edit
 * Permission: organization.create_ou
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  OrganizationUnitFormViewModel,
  COMMON_TIMEZONES,
} from '@/viewModels/organization/OrganizationUnitFormViewModel';
import { OrganizationUnitsViewModel } from '@/viewModels/organization/OrganizationUnitsViewModel';
import { OrganizationTree } from '@/components/organization-units';
import { getOrganizationUnitService } from '@/services/organization/OrganizationUnitServiceFactory';
import {
  ArrowLeft,
  Save,
  X,
  Building2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  AlertTriangle,
  Trash2,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { Logger } from '@/utils/logger';
import { cn } from '@/components/ui/utils';
import * as Select from '@radix-ui/react-select';
import type { OrganizationUnit } from '@/types/organization-unit.types';

const log = Logger.getLogger('component');

/**
 * Confirmation Dialog Props
 */
interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
  variant?: 'danger' | 'warning' | 'success' | 'default';
}

/**
 * Simple Confirmation Dialog Component
 */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  isLoading = false,
  variant = 'default',
}) => {
  if (!isOpen) return null;

  const variantStyles = {
    danger: 'bg-red-600 hover:bg-red-700',
    warning: 'bg-orange-600 hover:bg-orange-700',
    success: 'bg-green-600 hover:bg-green-700',
    default: 'bg-blue-600 hover:bg-blue-700',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-start gap-4">
          <div className={cn(
            'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center',
            variant === 'danger' && 'bg-red-100',
            variant === 'warning' && 'bg-orange-100',
            variant === 'success' && 'bg-green-100',
            variant === 'default' && 'bg-blue-100'
          )}>
            {variant === 'success' ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : (
              <AlertTriangle className={cn(
                'w-5 h-5',
                variant === 'danger' && 'text-red-600',
                variant === 'warning' && 'text-orange-600',
                variant === 'default' && 'text-blue-600'
              )} />
            )}
          </div>
          <div className="flex-1">
            <h3 id="confirm-dialog-title" className="text-lg font-semibold text-gray-900">
              {title}
            </h3>
            <p id="confirm-dialog-description" className="mt-2 text-gray-600">
              {message}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="flex-shrink-0 text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            {cancelLabel}
          </Button>
          <Button
            className={cn('text-white', variantStyles[variant])}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Processing...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * Organization Unit Edit Page Component
 */
export const OrganizationUnitEditPage: React.FC = observer(() => {
  const navigate = useNavigate();
  const { unitId } = useParams<{ unitId: string }>();

  // Loading and error states
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unit, setUnit] = useState<OrganizationUnit | null>(null);

  // Form ViewModel (created after unit is loaded)
  const [formViewModel, setFormViewModel] = useState<OrganizationUnitFormViewModel | null>(
    null
  );

  // Tree ViewModel for the hierarchy view
  const [treeViewModel] = useState(() => new OrganizationUnitsViewModel());

  // Unsaved changes dialog state
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const pendingNavigationRef = useRef<string | null>(null);

  // Delete dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showActiveWarningDialog, setShowActiveWarningDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Reactivate dialog state
  const [showReactivateDialog, setShowReactivateDialog] = useState(false);
  const [isReactivating, setIsReactivating] = useState(false);

  // Deactivate dialog state
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);

  // Error state for reactivate/deactivate operations
  const [reactivateError, setReactivateError] = useState<string | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  // Load units for tree view
  useEffect(() => {
    treeViewModel.loadUnits();
  }, [treeViewModel]);

  // Expand to current unit when it's loaded and tree is ready
  useEffect(() => {
    if (unitId && treeViewModel.unitCount > 0) {
      treeViewModel.expandToNode(unitId);
      treeViewModel.selectNode(unitId);
    }
  }, [unitId, treeViewModel.unitCount, treeViewModel]);

  // Load the unit for editing - extracted as useCallback so it can be called after API operations
  const loadUnit = useCallback(async () => {
    if (!unitId) {
      setLoadError('No unit ID provided');
      setIsLoading(false);
      return;
    }

    log.debug('Loading unit for editing', { unitId });
    setIsLoading(true);
    setLoadError(null);
    // Clear any previous operation errors when loading a new unit
    setReactivateError(null);
    setDeactivateError(null);
    setDeleteError(null);

    try {
      const service = getOrganizationUnitService();
      const loadedUnit = await service.getUnitById(unitId);

      if (!loadedUnit) {
        setLoadError('Unit not found');
        setIsLoading(false);
        return;
      }

      setUnit(loadedUnit);
      setFormViewModel(new OrganizationUnitFormViewModel(service, 'edit', loadedUnit));
      setIsLoading(false);
      log.debug('Unit loaded for editing', { unit: loadedUnit });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to load unit';
      setLoadError(errorMessage);
      setIsLoading(false);
      log.error('Failed to load unit', error);
    }
  }, [unitId]);

  // Initial load
  useEffect(() => {
    loadUnit();
  }, [loadUnit]);

  // Navigation handlers
  const handleCancel = useCallback(() => {
    navigate('/organization-units/manage');
  }, [navigate]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!formViewModel) return;

      const result = await formViewModel.submit();

      if (result.success) {
        log.info('Unit updated successfully', { unitId: result.unit?.id });
        navigate('/organization-units/manage');
      }
    },
    [formViewModel, navigate]
  );

  // Handle tree node selection - navigate to edit that unit
  const handleTreeSelect = useCallback((selectedId: string) => {
    // If clicking the same unit, do nothing
    if (selectedId === unitId) {
      return;
    }

    // Check for unsaved changes
    if (formViewModel?.isDirty) {
      pendingNavigationRef.current = selectedId;
      setShowUnsavedDialog(true);
    } else {
      // Navigate to edit the selected unit
      navigate(`/organization-units/${selectedId}/edit`);
    }
  }, [unitId, formViewModel, navigate]);

  // Handle unsaved changes dialog - discard and navigate
  const handleDiscardChanges = useCallback(() => {
    const targetId = pendingNavigationRef.current;
    setShowUnsavedDialog(false);
    pendingNavigationRef.current = null;
    if (targetId) {
      navigate(`/organization-units/${targetId}/edit`);
    }
  }, [navigate]);

  // Handle unsaved changes dialog - cancel (stay on current page)
  const handleCancelNavigation = useCallback(() => {
    setShowUnsavedDialog(false);
    pendingNavigationRef.current = null;
  }, []);

  // Handle delete button click
  const handleDeleteClick = useCallback(() => {
    if (!unit) return;

    // If unit is active, show warning that it needs to be deactivated first
    if (unit.isActive) {
      setShowActiveWarningDialog(true);
    } else {
      // Unit is inactive, show delete confirmation
      setShowDeleteDialog(true);
    }
  }, [unit]);

  // Handle delete confirmation
  const handleDeleteConfirm = useCallback(async () => {
    if (!unit) return;

    setIsDeleting(true);
    setDeleteError(null);
    try {
      const service = getOrganizationUnitService();
      const result = await service.deleteUnit(unit.id);

      if (result.success) {
        setShowDeleteDialog(false);
        log.info('Unit deleted successfully', { unitId: unit.id });
        // Navigate to manage page with parent selected
        if (unit.parentId) {
          navigate(`/organization-units/manage?expandParent=${unit.parentId}`);
        } else {
          navigate('/organization-units/manage');
        }
      } else {
        log.error('Failed to delete unit', { error: result.error });
        setDeleteError(result.error || 'Failed to delete unit');
        setShowDeleteDialog(false);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete unit';
      log.error('Delete failed', error);
      setDeleteError(errorMessage);
      setShowDeleteDialog(false);
    } finally {
      setIsDeleting(false);
    }
  }, [unit, navigate]);

  // Handle delete dialog cancel
  const handleDeleteCancel = useCallback(() => {
    setShowDeleteDialog(false);
  }, []);

  // Handle active warning dialog - proceed to deactivate via API
  const handleDeactivateFirst = useCallback(async () => {
    setShowActiveWarningDialog(false);
    // Show the deactivate dialog to confirm and call API
    setShowDeactivateDialog(true);
  }, []);

  // Handle active warning dialog cancel
  const handleActiveWarningCancel = useCallback(() => {
    setShowActiveWarningDialog(false);
  }, []);

  // Handle reactivate button click
  const handleReactivateClick = useCallback(() => {
    if (unit && !unit.isActive) {
      setReactivateError(null);  // Clear previous error
      setShowReactivateDialog(true);
    }
  }, [unit]);

  // Handle reactivate confirmation
  const handleReactivateConfirm = useCallback(async () => {
    if (!unit) return;

    setIsReactivating(true);
    setReactivateError(null);
    try {
      const service = getOrganizationUnitService();
      const result = await service.reactivateUnit(unit.id);

      if (result.success) {
        setShowReactivateDialog(false);
        log.info('Unit reactivated successfully', { unitId: unit.id });
        // Reload tree and unit (no full page refresh)
        await treeViewModel.loadUnits();
        await loadUnit();
      } else {
        // Close dialog and show error
        setShowReactivateDialog(false);
        setReactivateError(result.error || 'Failed to reactivate unit');
        log.warn('Reactivation failed', { error: result.error });
      }
    } catch (error) {
      // Handle exceptions
      const errorMessage = error instanceof Error ? error.message : 'Failed to reactivate unit';
      setShowReactivateDialog(false);
      setReactivateError(errorMessage);
      log.error('Reactivation error', error);
    } finally {
      setIsReactivating(false);
    }
  }, [unit, treeViewModel, loadUnit]);

  // Handle reactivate dialog cancel
  const handleReactivateCancel = useCallback(() => {
    setShowReactivateDialog(false);
  }, []);

  // Handle deactivate button/checkbox click
  const handleDeactivateClick = useCallback(() => {
    if (unit && unit.isActive) {
      setDeactivateError(null);  // Clear previous error
      setShowDeactivateDialog(true);
    }
  }, [unit]);

  // Handle deactivate confirmation
  const handleDeactivateConfirm = useCallback(async () => {
    if (!unit) return;

    setIsDeactivating(true);
    setDeactivateError(null);
    try {
      const service = getOrganizationUnitService();
      const result = await service.deactivateUnit(unit.id);

      if (result.success) {
        setShowDeactivateDialog(false);
        log.info('Unit deactivated successfully', { unitId: unit.id });
        // Reload tree and unit (no full page refresh)
        await treeViewModel.loadUnits();
        await loadUnit();
      } else {
        // Close dialog and show error
        setShowDeactivateDialog(false);
        setDeactivateError(result.error || 'Failed to deactivate unit');
        log.warn('Deactivation failed', { error: result.error });
      }
    } catch (error) {
      // Handle exceptions
      const errorMessage = error instanceof Error ? error.message : 'Failed to deactivate unit';
      setShowDeactivateDialog(false);
      setDeactivateError(errorMessage);
      log.error('Deactivation error', error);
    } finally {
      setIsDeactivating(false);
    }
  }, [unit, treeViewModel, loadUnit]);

  // Handle deactivate dialog cancel
  const handleDeactivateCancel = useCallback(() => {
    setShowDeactivateDialog(false);
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-gray-600">Loading unit...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (loadError || !unit || !formViewModel) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 p-8">
        <div className="max-w-7xl mx-auto">
          {/* Back Button */}
          <div className="mb-8">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              className="text-gray-600"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Manage
            </Button>
          </div>

          {/* Error Card */}
          <Card className="shadow-lg max-w-2xl mx-auto">
            <CardContent className="p-8">
              <div className="flex flex-col items-center text-center">
                <AlertTriangle className="w-12 h-12 text-orange-500 mb-4" />
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  {loadError === 'Unit not found'
                    ? 'Unit Not Found'
                    : 'Failed to Load Unit'}
                </h2>
                <p className="text-gray-600 mb-6">
                  {loadError === 'Unit not found'
                    ? 'The organizational unit you\'re looking for doesn\'t exist or has been removed.'
                    : loadError ?? 'An error occurred while loading the unit.'}
                </p>
                <Button onClick={handleCancel} className="bg-blue-600 hover:bg-blue-700">
                  Return to Management
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              className="text-gray-600"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Manage
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <Building2 className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Edit Organization Unit
              </h1>
              <p className="text-gray-600 mt-1">
                Modify the details of "{unit.displayName || unit.name}"
              </p>
            </div>
          </div>
        </div>

        {/* Split View Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Panel: Tree View */}
          <div className="lg:col-span-2">
            <Card className="shadow-lg h-full">
              <CardHeader className="border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl font-semibold text-gray-900">
                    Organization Hierarchy
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => treeViewModel.expandAll()}
                      disabled={treeViewModel.isLoading}
                    >
                      <ChevronDown className="w-4 h-4 mr-1" />
                      Expand All
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => treeViewModel.collapseAll()}
                      disabled={treeViewModel.isLoading}
                    >
                      <ChevronUp className="w-4 h-4 mr-1" />
                      Collapse All
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => treeViewModel.refresh()}
                      disabled={treeViewModel.isLoading}
                    >
                      <RefreshCw className={`w-4 h-4 ${treeViewModel.isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                {/* Loading State */}
                {treeViewModel.isLoading && treeViewModel.unitCount === 0 && (
                  <div className="flex items-center justify-center py-12">
                    <div className="flex flex-col items-center gap-3">
                      <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                      <p className="text-gray-600">Loading organization structure...</p>
                    </div>
                  </div>
                )}

                {/* Tree View */}
                {!treeViewModel.isLoading || treeViewModel.unitCount > 0 ? (
                  <OrganizationTree
                    nodes={treeViewModel.treeNodes}
                    selectedId={unitId ?? null}
                    expandedIds={treeViewModel.expandedNodeIds}
                    onSelect={handleTreeSelect}
                    onToggle={treeViewModel.toggleNode.bind(treeViewModel)}
                    onMoveDown={treeViewModel.moveSelectionDown.bind(treeViewModel)}
                    onMoveUp={treeViewModel.moveSelectionUp.bind(treeViewModel)}
                    onArrowRight={treeViewModel.handleArrowRight.bind(treeViewModel)}
                    onArrowLeft={treeViewModel.handleArrowLeft.bind(treeViewModel)}
                    onSelectFirst={treeViewModel.selectFirst.bind(treeViewModel)}
                    onSelectLast={treeViewModel.selectLast.bind(treeViewModel)}
                    ariaLabel="Organization hierarchy - click a unit to edit it"
                    className="border rounded-lg p-4 bg-white min-h-[400px]"
                  />
                ) : null}

                {/* Help text */}
                <p className="mt-4 text-sm text-gray-500 text-center">
                  Click on any unit in the tree to edit it
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Right Panel: Edit Form */}
          <div className="lg:col-span-1">
            {/* Root Organization Warning */}
            {unit.isRootOrganization && (
              <div className="mb-4 p-4 rounded-lg border border-blue-300 bg-blue-50">
                <div className="flex items-start gap-3">
                  <Building2 className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-blue-800 font-semibold text-sm">
                      Root Organization
                    </h3>
                    <p className="text-blue-700 text-xs mt-1">
                      This is your root organization. You can edit its name and display name,
                      but it cannot be deactivated.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Form Card */}
            <Card className="shadow-lg">
              <CardHeader className="border-b border-gray-200">
                <CardTitle className="text-lg font-semibold text-gray-900">
                  Unit Details
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Submission Error */}
                  {formViewModel.submissionError && (
                    <div
                      className="p-3 rounded-lg border border-red-300 bg-red-50"
                      role="alert"
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1">
                          <h3 className="text-red-800 font-semibold text-sm">
                            Failed to update unit
                          </h3>
                          <p className="text-red-700 text-xs mt-1">
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

                  {/* Path Display (read-only) */}
                  <div>
                    <Label className="block text-xs font-medium text-gray-700 mb-1">
                      Hierarchy Path
                    </Label>
                    <p className="text-xs text-gray-700 font-mono bg-gray-50 px-2 py-1.5 rounded-md border border-gray-200 break-all">
                      {unit.path}
                    </p>
                  </div>

                  {/* Name Input */}
                  <div>
                    <Label htmlFor="unit-name" className="block text-xs font-medium text-gray-700 mb-1">
                      Unit Name <span className="text-red-500">*</span>
                    </Label>
                    <input
                      type="text"
                      id="unit-name"
                      value={formViewModel.formData.name}
                      onChange={(e) => formViewModel.updateName(e.target.value)}
                      onBlur={() => formViewModel.touchField('name')}
                      className={cn(
                        'w-full px-2 py-1.5 text-sm rounded-md border shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors',
                        formViewModel.hasFieldError('name')
                          ? 'border-red-300 bg-red-50'
                          : 'border-gray-300 bg-white'
                      )}
                      placeholder="e.g., Main Campus"
                      aria-required="true"
                      aria-invalid={formViewModel.hasFieldError('name')}
                      aria-describedby={
                        formViewModel.hasFieldError('name') ? 'name-error' : undefined
                      }
                    />
                    {formViewModel.hasFieldError('name') && (
                      <p id="name-error" role="alert" className="text-red-600 text-xs mt-1">
                        {formViewModel.getFieldError('name')}
                      </p>
                    )}
                  </div>

                  {/* Display Name Input */}
                  <div>
                    <Label
                      htmlFor="display-name"
                      className="block text-xs font-medium text-gray-700 mb-1"
                    >
                      Display Name <span className="text-red-500">*</span>
                    </Label>
                    <input
                      type="text"
                      id="display-name"
                      value={formViewModel.formData.displayName}
                      onChange={(e) => formViewModel.updateField('displayName', e.target.value)}
                      onBlur={() => formViewModel.touchField('displayName')}
                      className={cn(
                        'w-full px-2 py-1.5 text-sm rounded-md border shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors',
                        formViewModel.hasFieldError('displayName')
                          ? 'border-red-300 bg-red-50'
                          : 'border-gray-300 bg-white'
                      )}
                      placeholder="e.g., Main Campus - Building A"
                      aria-required="true"
                      aria-invalid={formViewModel.hasFieldError('displayName')}
                      aria-describedby={
                        formViewModel.hasFieldError('displayName')
                          ? 'displayName-error'
                          : undefined
                      }
                    />
                    {formViewModel.hasFieldError('displayName') && (
                      <p id="displayName-error" role="alert" className="text-red-600 text-xs mt-1">
                        {formViewModel.getFieldError('displayName')}
                      </p>
                    )}
                  </div>

                  {/* Timezone Dropdown */}
                  <div>
                    <Label htmlFor="timezone" className="block text-xs font-medium text-gray-700 mb-1">
                      Time Zone <span className="text-red-500">*</span>
                    </Label>
                    <Select.Root
                      value={formViewModel.formData.timeZone}
                      onValueChange={(value) => formViewModel.setTimeZone(value)}
                    >
                      <Select.Trigger
                        id="timezone"
                        className={cn(
                          'w-full px-2 py-1.5 text-sm rounded-md border shadow-sm bg-white flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors',
                          formViewModel.hasFieldError('timeZone')
                            ? 'border-red-300 bg-red-50'
                            : 'border-gray-300'
                        )}
                        aria-label="Time Zone"
                        aria-required="true"
                        aria-invalid={formViewModel.hasFieldError('timeZone')}
                      >
                        <Select.Value>
                          {COMMON_TIMEZONES.find(
                            (tz) => tz.value === formViewModel.formData.timeZone
                          )?.label ?? formViewModel.formData.timeZone}
                        </Select.Value>
                        <Select.Icon>
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        </Select.Icon>
                      </Select.Trigger>
                      <Select.Portal>
                        <Select.Content className="bg-white rounded-md shadow-lg border border-gray-200 overflow-hidden z-50">
                          <Select.Viewport className="p-1">
                            {COMMON_TIMEZONES.map((tz) => (
                              <Select.Item
                                key={tz.value}
                                value={tz.value}
                                className="px-3 py-2 cursor-pointer hover:bg-gray-100 rounded outline-none data-[highlighted]:bg-gray-100 text-sm"
                              >
                                <Select.ItemText>{tz.label}</Select.ItemText>
                              </Select.Item>
                            ))}
                          </Select.Viewport>
                        </Select.Content>
                      </Select.Portal>
                    </Select.Root>
                    {formViewModel.hasFieldError('timeZone') && (
                      <p id="timeZone-error" role="alert" className="text-red-600 text-xs mt-1">
                        {formViewModel.getFieldError('timeZone')}
                      </p>
                    )}
                  </div>

                  {/* Active Status Toggle (not for root org) */}
                  {!unit.isRootOrganization && (
                    <>
                      {/* Deactivate/Reactivate Error */}
                      {(deactivateError || reactivateError) && (
                        <div className="p-3 rounded-lg border border-red-300 bg-red-50" role="alert">
                          <div className="flex items-start gap-2">
                            <div className="flex-1">
                              <h4 className="text-red-800 font-semibold text-xs">
                                {deactivateError ? 'Failed to deactivate unit' : 'Failed to reactivate unit'}
                              </h4>
                              <p className="text-red-700 text-xs mt-1">
                                {deactivateError || reactivateError}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setDeactivateError(null);
                                setReactivateError(null);
                              }}
                              className="text-red-600 hover:text-red-800"
                              aria-label="Dismiss error"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="flex items-start gap-2 p-3 rounded-lg bg-gray-50 border border-gray-200">
                        <Checkbox
                          id="is-active"
                          checked={unit.isActive}
                          onCheckedChange={() => {
                            if (unit.isActive) {
                              handleDeactivateClick();
                            } else {
                              handleReactivateClick();
                            }
                          }}
                          disabled={isDeactivating || isReactivating || formViewModel.isSubmitting}
                          className="mt-0.5 shadow-sm ring-1 ring-gray-300 bg-white/80 backdrop-blur-sm"
                        />
                        <div>
                          <Label
                            htmlFor="is-active"
                            className="text-xs font-medium text-gray-900 cursor-pointer"
                          >
                            Unit is Active
                          </Label>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Inactive units are hidden from most views.
                            {unit.isActive && unit.childCount > 0 && (
                              <span className="block text-orange-600 mt-1 font-medium">
                                Warning: Deactivating will also deactivate all {unit.childCount} child unit(s).
                              </span>
                            )}
                            {!unit.isActive && unit.childCount > 0 && (
                              <span className="block text-green-600 mt-1 font-medium">
                                Note: Reactivating will also reactivate all {unit.childCount} child unit(s).
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Form Actions */}
                  <div className="flex items-center justify-between pt-3 border-t border-gray-200">
                    <div>
                      {formViewModel.isDirty && (
                        <span className="text-xs text-amber-600">
                          Unsaved changes
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleCancel}
                        disabled={formViewModel.isSubmitting}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!formViewModel.canSubmit}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        <Save className="w-3 h-3 mr-1" />
                        {formViewModel.isSubmitting ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* Danger Zone - only for non-root orgs */}
            {!unit.isRootOrganization && (
              <section
                className="mt-4"
                aria-labelledby="danger-zone-heading"
              >
                <Card className="shadow-lg border-red-200">
                  <CardHeader className="border-b border-red-200 bg-red-50">
                    <CardTitle
                      id="danger-zone-heading"
                      className="text-lg font-semibold text-red-800"
                    >
                      Danger Zone
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="space-y-4">
                      {/* Reactivate Section - Only for inactive units */}
                      {!unit.isActive && (
                        <div className="pb-4 border-b border-gray-200">
                          <h4 className="text-sm font-medium text-gray-900">
                            Reactivate this organization unit
                          </h4>
                          <p className="text-xs text-gray-600 mt-1">
                            Reactivating this unit will allow new role assignments and make it visible in most views.
                            {unit.childCount > 0 && (
                              <span className="block text-green-600 mt-1">
                                This will also reactivate all {unit.childCount} child unit(s).
                              </span>
                            )}
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleReactivateClick}
                            disabled={formViewModel.isSubmitting || isReactivating}
                            className="mt-2 text-green-600 border-green-300 hover:bg-green-50 hover:border-green-400"
                            aria-describedby="reactivate-description"
                          >
                            <CheckCircle className="w-3 h-3 mr-1" />
                            {isReactivating ? 'Reactivating...' : 'Reactivate Unit'}
                          </Button>
                          <p id="reactivate-description" className="sr-only">
                            Reactivate this organization unit and all its descendants. Role assignments will be allowed again.
                          </p>
                        </div>
                      )}

                      {/* Delete Error */}
                      {deleteError && (
                        <div
                          className="p-3 rounded-lg border border-red-300 bg-red-50"
                          role="alert"
                        >
                          <div className="flex items-start gap-2">
                            <div className="flex-1">
                              <h4 className="text-red-800 font-semibold text-xs">
                                Failed to delete unit
                              </h4>
                              <p className="text-red-700 text-xs mt-1">
                                {deleteError}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setDeleteError(null)}
                              className="text-red-600 hover:text-red-800"
                              aria-label="Dismiss error"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}

                      <div>
                        <h4 className="text-sm font-medium text-gray-900">
                          Delete this organization unit
                        </h4>
                        <p className="text-xs text-gray-600 mt-1">
                          Once deleted, this unit will be permanently removed from the organization hierarchy.
                          {unit.isActive && (
                            <span className="block text-orange-600 mt-1">
                              This unit must be deactivated before it can be deleted.
                            </span>
                          )}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleDeleteClick}
                        disabled={formViewModel.isSubmitting || isDeleting}
                        className="text-red-600 border-red-300 hover:bg-red-50 hover:border-red-400"
                        aria-describedby="delete-description"
                      >
                        <Trash2 className="w-3 h-3 mr-1" />
                        {isDeleting ? 'Deleting...' : 'Delete Unit'}
                      </Button>
                      <p id="delete-description" className="sr-only">
                        Permanently delete this organization unit. This action cannot be undone.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </section>
            )}
          </div>
        </div>
      </div>

      {/* Unsaved Changes Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showUnsavedDialog}
        title="Unsaved Changes"
        message="You have unsaved changes to this unit. Do you want to discard them and edit a different unit?"
        confirmLabel="Discard Changes"
        cancelLabel="Stay Here"
        onConfirm={handleDiscardChanges}
        onCancel={handleCancelNavigation}
        variant="warning"
      />

      {/* Active Unit Warning Dialog - Cannot delete active units */}
      <ConfirmDialog
        isOpen={showActiveWarningDialog}
        title="Cannot Delete Active Unit"
        message={`"${unit?.displayName || unit?.name}" must be deactivated before it can be deleted. Deactivation freezes the unit, prevents new role assignments, and hides it from most views. Would you like to deactivate this unit now?`}
        confirmLabel="Deactivate First"
        cancelLabel="Cancel"
        onConfirm={handleDeactivateFirst}
        onCancel={handleActiveWarningCancel}
        variant="warning"
      />

      {/* Delete Confirmation Dialog - For inactive units only */}
      <ConfirmDialog
        isOpen={showDeleteDialog}
        title="Delete Organization Unit"
        message={`Are you sure you want to delete "${unit?.displayName || unit?.name}"? This action is permanent and cannot be undone. The unit will be removed from the organization hierarchy.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        isLoading={isDeleting}
        variant="danger"
      />

      {/* Reactivate Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showReactivateDialog}
        title="Reactivate Organization Unit"
        message={`Are you sure you want to reactivate "${unit?.displayName || unit?.name}"?${
          unit?.childCount && unit.childCount > 0
            ? ` This will also reactivate all ${unit.childCount} child unit(s).`
            : ''
        } Role assignments will be allowed again for this unit and its descendants.`}
        confirmLabel="Reactivate"
        cancelLabel="Cancel"
        onConfirm={handleReactivateConfirm}
        onCancel={handleReactivateCancel}
        isLoading={isReactivating}
        variant="success"
      />

      {/* Deactivate Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeactivateDialog}
        title="Deactivate Organization Unit"
        message={`Are you sure you want to deactivate "${unit?.displayName || unit?.name}"?${
          unit?.childCount && unit.childCount > 0
            ? ` This will also deactivate all ${unit.childCount} child unit(s).`
            : ''
        } Inactive units cannot have new role assignments.`}
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        onConfirm={handleDeactivateConfirm}
        onCancel={handleDeactivateCancel}
        isLoading={isDeactivating}
        variant="warning"
      />
    </div>
  );
});

export default OrganizationUnitEditPage;
