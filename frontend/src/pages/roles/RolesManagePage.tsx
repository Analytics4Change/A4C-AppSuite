/**
 * Roles Management Page
 *
 * Single-page interface for managing roles with split view layout.
 * Left panel: Filterable role list with selection
 * Right panel: Form for create/edit with permission selector
 *
 * Features:
 * - Split view layout (list 1/3 + form 2/3)
 * - Select role → shows editable form with permissions
 * - Create mode for new roles
 * - Permission selector with subset-only enforcement
 * - Deactivate/Reactivate/Delete operations
 * - Unsaved changes warning
 *
 * Route: /roles/manage
 * Permission: role.create
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { RoleList, RoleFormFields, PermissionSelector } from '@/components/roles';
import { RolesViewModel } from '@/viewModels/roles/RolesViewModel';
import { RoleFormViewModel } from '@/viewModels/roles/RoleFormViewModel';
import { getRoleService } from '@/services/roles';
import { getOrganizationUnitService } from '@/services/organization/OrganizationUnitServiceFactory';
import type { RoleWithPermissions } from '@/types/role.types';
import type { OrganizationUnitNode } from '@/types/organization-unit.types';
import { buildOrganizationUnitTree } from '@/types/organization-unit.types';
import {
  Plus,
  Trash2,
  RefreshCw,
  ArrowLeft,
  Shield,
  AlertTriangle,
  X,
  CheckCircle,
  XCircle,
  Save,
  Copy,
} from 'lucide-react';
import { Logger } from '@/utils/logger';
import { cn } from '@/components/ui/utils';
import { isCanonicalRole } from '@/config/roles.config';

const log = Logger.getLogger('component');

/** Panel mode: empty (no selection), edit (role selected), create (creating new role) */
type PanelMode = 'empty' | 'edit' | 'create';

/**
 * Discriminated union for dialog state.
 */
type DialogState =
  | { type: 'none' }
  | { type: 'discard' }
  | { type: 'deactivate'; isLoading: boolean }
  | { type: 'reactivate'; isLoading: boolean }
  | { type: 'delete'; isLoading: boolean }
  | { type: 'activeWarning' };

/**
 * Roles Management Page Component
 */
export const RolesManagePage: React.FC = observer(() => {
  const navigate = useNavigate();

  // List ViewModel - manages role list state
  const [viewModel] = useState(() => new RolesViewModel());

  // Panel mode: empty, edit, or create
  const [panelMode, setPanelMode] = useState<PanelMode>('empty');

  // Current role being edited (for edit mode)
  const [currentRole, setCurrentRole] = useState<RoleWithPermissions | null>(null);

  // Form ViewModel (for edit and create modes)
  const [formViewModel, setFormViewModel] = useState<RoleFormViewModel | null>(null);

  // Dialog state
  const [dialogState, setDialogState] = useState<DialogState>({ type: 'none' });
  const pendingActionRef = useRef<{ type: 'select' | 'create'; roleId?: string } | null>(null);

  // Error states
  const [operationError, setOperationError] = useState<string | null>(null);

  // OU tree nodes for scope selection
  const [ouNodes, setOuNodes] = useState<OrganizationUnitNode[]>([]);

  // Load roles and permissions on mount
  useEffect(() => {
    log.debug('RolesManagePage mounted, loading data');
    viewModel.loadAll();
  }, [viewModel]);

  // Load OU tree data on mount
  useEffect(() => {
    const loadOUData = async () => {
      try {
        const service = getOrganizationUnitService();
        const units = await service.getUnits({ status: 'active' });
        // Find root path (shortest path in the set)
        const rootPath = units.length > 0
          ? units.reduce(
              (shortest: string, unit) =>
                unit.path.length < shortest.length ? unit.path : shortest,
              units[0].path
            )
          : '';
        const tree = buildOrganizationUnitTree(units, rootPath);
        setOuNodes(tree);
        log.debug('OU tree loaded for role scope selection', { nodeCount: units.length });
      } catch (error) {
        log.error('Failed to load OU tree for scope selection', error);
        // Don't set error state - scope selection is optional
      }
    };
    loadOUData();
  }, []);

  // Select and load a role for editing
  const selectAndLoadRole = useCallback(
    async (roleId: string) => {
      setOperationError(null);
      try {
        const service = getRoleService();
        const fullRole = await service.getRoleById(roleId);
        if (fullRole) {
          // Guard: Reject selection of canonical roles
          if (isCanonicalRole(fullRole.name)) {
            log.warn('Attempted to select canonical role', { roleId, name: fullRole.name });
            setOperationError('System roles cannot be managed through this interface.');
            return;
          }

          setCurrentRole(fullRole);
          setFormViewModel(
            new RoleFormViewModel(
              service,
              'edit',
              viewModel.allPermissions,
              viewModel.userPermissionIds,
              fullRole
            )
          );
          setPanelMode('edit');
          viewModel.selectRole(roleId);
          log.debug('Role loaded for editing', { roleId, name: fullRole.name });
        }
      } catch (error) {
        log.error('Failed to load role', error);
        setOperationError('Failed to load role details');
      }
    },
    [viewModel]
  );

  // Handle role list selection with dirty check
  const handleRoleSelect = useCallback(
    (roleId: string) => {
      if (roleId === viewModel.selectedRoleId && panelMode === 'edit') {
        return;
      }

      if (formViewModel?.isDirty) {
        pendingActionRef.current = { type: 'select', roleId };
        setDialogState({ type: 'discard' });
      } else {
        selectAndLoadRole(roleId);
      }
    },
    [viewModel.selectedRoleId, panelMode, formViewModel, selectAndLoadRole]
  );

  // Handle discard changes
  const handleDiscardChanges = useCallback(() => {
    const pending = pendingActionRef.current;
    setDialogState({ type: 'none' });
    pendingActionRef.current = null;

    if (pending?.type === 'select' && pending.roleId) {
      selectAndLoadRole(pending.roleId);
    } else if (pending?.type === 'create') {
      enterCreateMode();
    }
  }, [selectAndLoadRole]);

  // Handle cancel discard
  const handleCancelDiscard = useCallback(() => {
    setDialogState({ type: 'none' });
    pendingActionRef.current = null;
  }, []);

  // Enter create mode
  const enterCreateMode = useCallback(() => {
    setOperationError(null);
    const service = getRoleService();
    setFormViewModel(
      new RoleFormViewModel(
        service,
        'create',
        viewModel.allPermissions,
        viewModel.userPermissionIds
      )
    );
    setCurrentRole(null);
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

  // Handle duplicate role
  const handleDuplicateRole = useCallback(() => {
    if (!currentRole) return;

    setOperationError(null);
    const service = getRoleService();
    const newFormViewModel = new RoleFormViewModel(
      service,
      'create',
      viewModel.allPermissions,
      viewModel.userPermissionIds
    );
    // Initialize with cloned data
    newFormViewModel.initializeFromRole(currentRole);
    setFormViewModel(newFormViewModel);
    setCurrentRole(null);
    setPanelMode('create');
    viewModel.clearSelection();
    log.debug('Duplicating role', { sourceRoleId: currentRole.id, sourceRoleName: currentRole.name });
  }, [currentRole, viewModel]);

  // Handle form submission
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!formViewModel) return;

      const result = await formViewModel.submit();

      if (result.success && result.role) {
        log.info('Form submitted successfully', {
          mode: panelMode,
          roleId: result.role.id,
        });

        await viewModel.refresh();

        if (panelMode === 'create') {
          await selectAndLoadRole(result.role.id);
        } else {
          await selectAndLoadRole(result.role.id);
        }
      }
    },
    [formViewModel, panelMode, viewModel, selectAndLoadRole]
  );

  // Handle cancel in form
  const handleCancel = useCallback(() => {
    if (panelMode === 'create') {
      if (viewModel.selectedRoleId) {
        selectAndLoadRole(viewModel.selectedRoleId);
      } else {
        setPanelMode('empty');
        setFormViewModel(null);
        setCurrentRole(null);
      }
    }
  }, [panelMode, viewModel.selectedRoleId, selectAndLoadRole]);

  // Navigation handlers
  const handleBackClick = () => {
    navigate('/settings');
  };

  // Deactivate handlers
  const handleDeactivateClick = useCallback(() => {
    if (currentRole && currentRole.isActive) {
      setOperationError(null);
      setDialogState({ type: 'deactivate', isLoading: false });
    }
  }, [currentRole]);

  const handleDeactivateConfirm = useCallback(async () => {
    if (!currentRole) return;

    setDialogState({ type: 'deactivate', isLoading: true });
    setOperationError(null);
    try {
      const result = await viewModel.deactivateRole(currentRole.id);

      if (result.success) {
        setDialogState({ type: 'none' });
        log.info('Role deactivated successfully', { roleId: currentRole.id });
        await selectAndLoadRole(currentRole.id);
      } else {
        setDialogState({ type: 'none' });
        setOperationError(result.error || 'Failed to deactivate role');
      }
    } catch (error) {
      setDialogState({ type: 'none' });
      setOperationError(error instanceof Error ? error.message : 'Failed to deactivate role');
    }
  }, [currentRole, viewModel, selectAndLoadRole]);

  // Reactivate handlers
  const handleReactivateClick = useCallback(() => {
    if (currentRole && !currentRole.isActive) {
      setOperationError(null);
      setDialogState({ type: 'reactivate', isLoading: false });
    }
  }, [currentRole]);

  const handleReactivateConfirm = useCallback(async () => {
    if (!currentRole) return;

    setDialogState({ type: 'reactivate', isLoading: true });
    setOperationError(null);
    try {
      const result = await viewModel.reactivateRole(currentRole.id);

      if (result.success) {
        setDialogState({ type: 'none' });
        log.info('Role reactivated successfully', { roleId: currentRole.id });
        await selectAndLoadRole(currentRole.id);
      } else {
        setDialogState({ type: 'none' });
        setOperationError(result.error || 'Failed to reactivate role');
      }
    } catch (error) {
      setDialogState({ type: 'none' });
      setOperationError(error instanceof Error ? error.message : 'Failed to reactivate role');
    }
  }, [currentRole, viewModel, selectAndLoadRole]);

  // Delete handlers
  const handleDeleteClick = useCallback(() => {
    if (!currentRole) return;

    if (currentRole.isActive) {
      setDialogState({ type: 'activeWarning' });
    } else if (currentRole.userCount > 0) {
      setOperationError(`Cannot delete role with ${currentRole.userCount} assigned users. Remove all user assignments first.`);
    } else {
      setOperationError(null);
      setDialogState({ type: 'delete', isLoading: false });
    }
  }, [currentRole]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!currentRole) return;

    setDialogState({ type: 'delete', isLoading: true });
    setOperationError(null);
    try {
      const result = await viewModel.deleteRole(currentRole.id);

      if (result.success) {
        setDialogState({ type: 'none' });
        log.info('Role deleted successfully', { roleId: currentRole.id });
        setPanelMode('empty');
        setFormViewModel(null);
        setCurrentRole(null);
      } else {
        setDialogState({ type: 'none' });
        setOperationError(result.error || 'Failed to delete role');
      }
    } catch (error) {
      setDialogState({ type: 'none' });
      setOperationError(error instanceof Error ? error.message : 'Failed to delete role');
    }
  }, [currentRole, viewModel]);

  // Handle "deactivate first" flow from active warning dialog
  const handleDeactivateFirst = useCallback(() => {
    setDialogState({ type: 'deactivate', isLoading: false });
  }, []);

  // Filter handlers
  const handleSearchChange = useCallback(
    async (searchTerm: string) => {
      await viewModel.setSearchFilter(searchTerm);
    },
    [viewModel]
  );

  const handleStatusChange = useCallback(
    async (status: 'all' | 'active' | 'inactive') => {
      await viewModel.setStatusFilter(status);
    },
    [viewModel]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBackClick}
              className="text-gray-600"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Settings
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Role Management</h1>
              <p className="text-gray-600 mt-1">
                Create and manage roles with permission assignments
              </p>
            </div>
          </div>
        </div>

        {/* Error Banner */}
        {(viewModel.error || operationError) && (
          <div
            className="mb-6 p-4 rounded-lg border border-red-300 bg-red-50"
            role="alert"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-red-800 font-semibold">Error</h3>
                <p className="text-red-700 text-sm mt-1">
                  {viewModel.error || operationError}
                </p>
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
          {/* Left Panel: Role List */}
          <div className="lg:col-span-1">
            <Card className="shadow-lg h-[calc(100vh-280px)]">
              <CardHeader className="border-b border-gray-200 pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold text-gray-900">
                    Roles
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => viewModel.refresh()}
                    disabled={viewModel.isLoading}
                  >
                    <RefreshCw
                      className={cn('w-4 h-4', viewModel.isLoading && 'animate-spin')}
                    />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-4 h-[calc(100%-80px)]">
                <RoleList
                  roles={viewModel.roles}
                  selectedRoleId={viewModel.selectedRoleId}
                  filters={viewModel.filters}
                  isLoading={viewModel.isLoading}
                  onSelect={handleRoleSelect}
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
              Create New Role
            </Button>

            {/* Empty State */}
            {panelMode === 'empty' && (
              <Card className="shadow-lg">
                <CardContent className="p-12 text-center">
                  <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-xl font-medium text-gray-900 mb-2">
                    No Role Selected
                  </h3>
                  <p className="text-gray-500 max-w-md mx-auto">
                    Select a role from the list to view and edit its details and
                    permissions, or click "Create New Role" to add a new one.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Create Mode */}
            {panelMode === 'create' && formViewModel && (
              <Card className="shadow-lg">
                <CardHeader className="border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    {formViewModel.clonedFromRoleId && (
                      <Copy className="w-5 h-5 text-blue-600" />
                    )}
                    <CardTitle className="text-xl font-semibold text-gray-900">
                      {formViewModel.clonedFromRoleId ? 'Duplicate Role' : 'Create New Role'}
                    </CardTitle>
                  </div>
                  {formViewModel.clonedFromRoleId && (
                    <p className="text-sm text-gray-500 mt-1">
                      Creating a copy with the same permissions
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
                              Failed to create role
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
                    <RoleFormFields
                      formData={formViewModel.formData}
                      onFieldChange={formViewModel.updateField.bind(formViewModel)}
                      onFieldBlur={formViewModel.touchField.bind(formViewModel)}
                      getFieldError={formViewModel.getFieldError.bind(formViewModel)}
                      ouNodes={ouNodes}
                      disabled={formViewModel.isSubmitting}
                    />

                    {/* Permission Selector */}
                    <PermissionSelector
                      permissionGroups={formViewModel.filteredPermissionGroups}
                      selectedIds={formViewModel.selectedPermissionIds}
                      userPermissionIds={formViewModel.userPermissionIds}
                      onTogglePermission={formViewModel.togglePermission.bind(formViewModel)}
                      onToggleApplet={formViewModel.toggleApplet.bind(formViewModel)}
                      isAppletFullySelected={formViewModel.isAppletFullySelected.bind(formViewModel)}
                      isAppletPartiallySelected={formViewModel.isAppletPartiallySelected.bind(formViewModel)}
                      canGrant={formViewModel.canGrant.bind(formViewModel)}
                      disabled={formViewModel.isSubmitting}
                      showOnlyGrantable={formViewModel.showOnlyGrantable}
                      onToggleShowOnlyGrantable={formViewModel.toggleShowOnlyGrantable.bind(formViewModel)}
                      searchTerm={formViewModel.permissionSearchTerm}
                      onSearchChange={formViewModel.setPermissionSearchTerm.bind(formViewModel)}
                      isAppletCollapsed={formViewModel.isAppletCollapsed.bind(formViewModel)}
                      onToggleAppletCollapsed={formViewModel.toggleAppletCollapsed.bind(formViewModel)}
                      onExpandAll={formViewModel.expandAllApplets.bind(formViewModel)}
                      onCollapseAll={formViewModel.collapseAllApplets.bind(formViewModel)}
                    />

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
                        disabled={!formViewModel.canSubmit}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        {formViewModel.isSubmitting ? 'Creating...' : 'Create Role'}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            {/* Edit Mode */}
            {panelMode === 'edit' && currentRole && formViewModel && (
              <div className="space-y-4">
                {/* Inactive Warning Banner with Quick Reactivate */}
                {!currentRole.isActive && (
                  <div className="p-4 rounded-lg border border-amber-300 bg-amber-50">
                    <div className="flex items-start gap-3">
                      <XCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h3 className="text-amber-800 font-semibold">Inactive Role - Editing Disabled</h3>
                        <p className="text-amber-700 text-sm mt-1">
                          This role is deactivated. The form is read-only until the role is reactivated.
                          Users with this role cannot perform any actions.
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
                        Edit Role
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDuplicateRole}
                          disabled={formViewModel.isSubmitting}
                          className="text-gray-600"
                        >
                          <Copy className="w-4 h-4 mr-1" />
                          Duplicate
                        </Button>
                        <span
                          className={cn(
                            'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                            currentRole.isActive
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-600'
                          )}
                        >
                          {currentRole.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
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
                                Failed to update role
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
                      <RoleFormFields
                        formData={formViewModel.formData}
                        onFieldChange={formViewModel.updateField.bind(formViewModel)}
                        onFieldBlur={formViewModel.touchField.bind(formViewModel)}
                        getFieldError={formViewModel.getFieldError.bind(formViewModel)}
                        ouNodes={ouNodes}
                        disabled={formViewModel.isSubmitting || !currentRole.isActive}
                        isEditMode
                        roleId={currentRole.id}
                      />

                      {/* Permission Selector */}
                      <PermissionSelector
                        permissionGroups={formViewModel.filteredPermissionGroups}
                        selectedIds={formViewModel.selectedPermissionIds}
                        userPermissionIds={formViewModel.userPermissionIds}
                        onTogglePermission={formViewModel.togglePermission.bind(formViewModel)}
                        onToggleApplet={formViewModel.toggleApplet.bind(formViewModel)}
                        isAppletFullySelected={formViewModel.isAppletFullySelected.bind(formViewModel)}
                        isAppletPartiallySelected={formViewModel.isAppletPartiallySelected.bind(formViewModel)}
                        canGrant={formViewModel.canGrant.bind(formViewModel)}
                        disabled={formViewModel.isSubmitting || !currentRole.isActive}
                        showOnlyGrantable={formViewModel.showOnlyGrantable}
                        onToggleShowOnlyGrantable={formViewModel.toggleShowOnlyGrantable.bind(formViewModel)}
                        searchTerm={formViewModel.permissionSearchTerm}
                        onSearchChange={formViewModel.setPermissionSearchTerm.bind(formViewModel)}
                        isAppletCollapsed={formViewModel.isAppletCollapsed.bind(formViewModel)}
                        onToggleAppletCollapsed={formViewModel.toggleAppletCollapsed.bind(formViewModel)}
                        onExpandAll={formViewModel.expandAllApplets.bind(formViewModel)}
                        onCollapseAll={formViewModel.collapseAllApplets.bind(formViewModel)}
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
                          disabled={!formViewModel.canSubmit || !currentRole.isActive}
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
                      {/* Deactivate/Reactivate Section */}
                      <div className="pb-4 border-b border-gray-200">
                        {currentRole.isActive ? (
                          <>
                            <h4 className="text-sm font-medium text-gray-900">
                              Deactivate this role
                            </h4>
                            <p className="text-xs text-gray-600 mt-1">
                              Deactivating freezes the role. Users with this role will lose their
                              permissions until reactivated.
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
                                : 'Deactivate Role'}
                            </Button>
                          </>
                        ) : (
                          <>
                            <h4 className="text-sm font-medium text-gray-900">
                              Reactivate this role
                            </h4>
                            <p className="text-xs text-gray-600 mt-1">
                              Reactivating restores permissions to users with this role.
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
                                : 'Reactivate Role'}
                            </Button>
                          </>
                        )}
                      </div>

                      {/* Delete Section */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-900">Delete this role</h4>
                        <p className="text-xs text-gray-600 mt-1">
                          Permanently remove this role.
                          {currentRole.isActive && (
                            <span className="block text-orange-600 mt-1">
                              Must be deactivated before deletion.
                            </span>
                          )}
                          {currentRole.userCount > 0 && (
                            <span className="block text-orange-600 mt-1">
                              Cannot delete: {currentRole.userCount} user(s) assigned.
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
                            : 'Delete Role'}
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
        title="Deactivate Role"
        message={`Are you sure you want to deactivate "${currentRole?.name}"? Users with this role will lose their permissions until reactivated.`}
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
        title="Reactivate Role"
        message={`Are you sure you want to reactivate "${currentRole?.name}"? Users with this role will regain their permissions.`}
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
        title="Cannot Delete Active Role"
        message={`"${currentRole?.name}" must be deactivated before it can be deleted. Would you like to deactivate it now?`}
        confirmLabel="Deactivate First"
        cancelLabel="Cancel"
        onConfirm={handleDeactivateFirst}
        onCancel={() => setDialogState({ type: 'none' })}
        variant="warning"
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'delete'}
        title="Delete Role"
        message={`Are you sure you want to delete "${currentRole?.name}"? This action is permanent and cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDialogState({ type: 'none' })}
        isLoading={dialogState.type === 'delete' && dialogState.isLoading}
        variant="danger"
      />
    </div>
  );
});

export default RolesManagePage;
