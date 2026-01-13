/**
 * Organization Units Management Page (Unified)
 *
 * Single-page interface for managing organizational units with permission-based UI.
 * Left panel: Interactive tree view with selection
 * Right panel: Read-only details, editable form, or create form (based on permissions)
 *
 * Permission-Based UI Behavior:
 * - view_ou only: Full-width tree, read-only detail panel on click
 * - view_ou + create_ou: Split view with Create button
 * - view_ou + update_ou: Split view with editable form (no danger zone)
 * - view_ou + deactivate_ou: Shows Deactivate option in danger zone
 * - view_ou + reactivate_ou: Shows Reactivate button for inactive units
 * - view_ou + delete_ou: Shows Delete button in danger zone
 *
 * Features:
 * - Permission-based layout (full-width vs split view)
 * - Read-only detail panel for view-only users
 * - Select unit → immediately shows editable form (if has update_ou permission)
 * - Inline create mode (form clears for new unit creation)
 * - Unsaved changes warning when switching units
 * - Deactivate/Reactivate with cascade to children
 * - Delete (requires deactivation first)
 * - Query parameter support: ?select=uuid for deep links
 *
 * Route: /organization-units
 * Permission: organization.view_ou (minimum)
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StatusFilterTabs, type StatusFilterOption } from '@/components/ui/StatusFilterTabs';
import { OrganizationTree, OrganizationUnitFormFields } from '@/components/organization-units';
import { OrganizationUnitsViewModel } from '@/viewModels/organization/OrganizationUnitsViewModel';
import { OrganizationUnitFormViewModel } from '@/viewModels/organization/OrganizationUnitFormViewModel';
import { getOrganizationUnitService } from '@/services/organization/OrganizationUnitServiceFactory';
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Building2,
  MapPin,
  AlertTriangle,
  X,
  CheckCircle,
  XCircle,
  Save,
  Search,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Logger } from '@/utils/logger';
import { cn } from '@/components/ui/utils';
import * as Select from '@radix-ui/react-select';
import type { OrganizationUnit } from '@/types/organization-unit.types';

const log = Logger.getLogger('component');

/** Panel mode: empty (no selection), view (read-only detail), edit (unit selected), create (creating new unit) */
type PanelMode = 'empty' | 'view' | 'edit' | 'create';

/**
 * Discriminated union for dialog state.
 * Consolidates multiple boolean states into a single, type-safe state machine.
 * Only one dialog can be open at a time.
 */
type DialogState =
  | { type: 'none' }
  | { type: 'discard' }
  | { type: 'deactivate'; isLoading: boolean }
  | { type: 'reactivate'; isLoading: boolean }
  | { type: 'delete'; isLoading: boolean }
  | { type: 'activeWarning' };

/**
 * Organization Units Management Page Component
 */
export const OrganizationUnitsManagePage: React.FC = observer(() => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { session } = useAuth();

  // Permission checks - synchronous check against session claims
  const permissions = useMemo(() => {
    const userPermissions = session?.claims.permissions ?? [];
    return {
      canCreate: userPermissions.includes('organization.create_ou'),
      canUpdate: userPermissions.includes('organization.update_ou'),
      canDelete: userPermissions.includes('organization.delete_ou'),
      canDeactivate: userPermissions.includes('organization.deactivate_ou'),
      canReactivate: userPermissions.includes('organization.reactivate_ou'),
    };
  }, [session?.claims.permissions]);

  // Determine if user has any write permissions (controls layout width)
  const hasAnyWritePermission = permissions.canCreate || permissions.canUpdate ||
    permissions.canDelete || permissions.canDeactivate || permissions.canReactivate;

  // Tree ViewModel - manages tree state, selection, expansion
  const [viewModel] = useState(() => new OrganizationUnitsViewModel());

  // Panel mode: empty, edit, or create
  const [panelMode, setPanelMode] = useState<PanelMode>('empty');

  // Current unit being edited (for edit mode)
  const [currentUnit, setCurrentUnit] = useState<OrganizationUnit | null>(null);

  // Form ViewModel (for edit and create modes)
  const [formViewModel, setFormViewModel] =
    useState<OrganizationUnitFormViewModel | null>(null);

  // Dialog state - discriminated union for type-safe dialog management
  const [dialogState, setDialogState] = useState<DialogState>({ type: 'none' });
  const pendingActionRef = useRef<{ type: 'select' | 'create'; unitId?: string } | null>(null);

  // Error states
  const [operationError, setOperationError] = useState<string | null>(null);

  // Status filter state - read initial value from URL
  const statusParam = searchParams.get('status') as 'all' | 'active' | 'inactive' | null;
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>(
    statusParam || 'all'
  );

  // Search filter state
  const [searchTerm, setSearchTerm] = useState('');

  // Status filter options with counts
  const statusOptions: StatusFilterOption<'all' | 'active' | 'inactive'>[] = useMemo(
    () => [
      { value: 'all', label: 'All', count: viewModel.unitCount },
      { value: 'active', label: 'Active', count: viewModel.activeUnitCount },
      {
        value: 'inactive',
        label: 'Inactive',
        count: viewModel.unitCount - viewModel.activeUnitCount,
      },
    ],
    [viewModel.unitCount, viewModel.activeUnitCount]
  );

  // Handle status filter change with URL persistence
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

  // Filter tree nodes based on search and status
  const filteredTreeNodes = useMemo(() => {
    let nodes = viewModel.treeNodes;

    // Helper: Check if node or any descendant matches the status filter
    // This preserves ancestor nodes that lead to matching descendants
    const hasMatchingDescendant = (
      node: (typeof nodes)[0],
      filter: 'active' | 'inactive'
    ): boolean => {
      const matchesSelf = filter === 'active' ? node.isActive : !node.isActive;
      if (matchesSelf) return true;
      return node.children.some((child) => hasMatchingDescendant(child, filter));
    };

    const filterNodes = (nodeList: typeof nodes): typeof nodes => {
      return nodeList
        .filter((node) => {
          // Status filter - keep node if it matches OR has matching descendants
          if (statusFilter === 'active') {
            if (!node.isActive && !hasMatchingDescendant(node, 'active')) return false;
          }
          if (statusFilter === 'inactive') {
            if (node.isActive && !hasMatchingDescendant(node, 'inactive')) return false;
          }

          // Search filter
          if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase();
            const nameMatch = node.name.toLowerCase().includes(term);
            const displayNameMatch = node.displayName?.toLowerCase().includes(term);
            const hasMatchingChild = node.children.some(
              (child) => filterNodes([child]).length > 0
            );
            return nameMatch || displayNameMatch || hasMatchingChild;
          }

          return true;
        })
        .map((node) => ({
          ...node,
          children: filterNodes(node.children),
        }));
    };

    return filterNodes(nodes);
  }, [viewModel.treeNodes, statusFilter, searchTerm]);

  // Load units on mount
  useEffect(() => {
    log.debug('OrganizationUnitsManagePage mounted, loading units');
    viewModel.loadUnits();
  }, [viewModel]);

  // Track previous filter to detect when it changes to 'inactive'
  const prevStatusFilterRef = useRef(statusFilter);
  useEffect(() => {
    // When filter changes to 'inactive' and tree is mostly collapsed, expand inactive paths
    if (statusFilter === 'inactive' && prevStatusFilterRef.current !== 'inactive') {
      if (viewModel.expandedNodeIds.size <= 1) {
        viewModel.expandToInactiveNodes();
        log.debug('Auto-expanded paths to inactive nodes');
      }
    }
    prevStatusFilterRef.current = statusFilter;
  }, [statusFilter, viewModel]);

  // Handle query parameters for deep linking and auto-expand
  useEffect(() => {
    const selectId = searchParams.get('select');
    const expandParentId = searchParams.get('expandParent');

    if (viewModel.unitCount === 0) return; // Wait for units to load

    if (selectId) {
      // Deep link: auto-select and expand to the specified unit
      const unit = viewModel.getUnitById(selectId);
      if (unit) {
        viewModel.expandToNode(selectId);
        viewModel.selectNode(selectId);
        selectAndLoadUnit(selectId);
        log.info('Auto-selected unit from URL', { unitId: selectId });
      }
      setSearchParams({}, { replace: true });
    } else if (expandParentId) {
      // After creating a new unit, expand to parent
      const parent = viewModel.getUnitById(expandParentId);
      if (parent) {
        viewModel.expandToNode(expandParentId);
        log.info('Auto-expanded parent node from URL', { parentId: expandParentId });
      }
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, viewModel.unitCount, viewModel, setSearchParams]);

  // Select and load a unit for viewing or editing (based on permissions)
  const selectAndLoadUnit = useCallback(
    async (unitId: string) => {
      setOperationError(null);
      const unit = viewModel.getUnitById(unitId);
      if (!unit) {
        log.warn('Unit not found', { unitId });
        return;
      }

      // Fetch full unit details from service
      try {
        const service = getOrganizationUnitService();
        const fullUnit = await service.getUnitById(unitId);
        if (fullUnit) {
          setCurrentUnit(fullUnit);

          // Determine panel mode based on permissions
          if (permissions.canUpdate) {
            // User can edit - show editable form
            setFormViewModel(new OrganizationUnitFormViewModel(service, 'edit', fullUnit));
            setPanelMode('edit');
            log.debug('Unit loaded for editing', { unitId, name: fullUnit.name });
          } else {
            // User can only view - show read-only panel
            setFormViewModel(null);
            setPanelMode('view');
            log.debug('Unit loaded for viewing (read-only)', { unitId, name: fullUnit.name });
          }

          viewModel.selectNode(unitId);
        }
      } catch (error) {
        log.error('Failed to load unit', error);
        setOperationError('Failed to load unit details');
      }
    },
    [viewModel, permissions.canUpdate]
  );

  // Handle tree node selection with dirty check
  const handleTreeSelect = useCallback(
    (selectedId: string) => {
      // If clicking the same unit, do nothing
      if (selectedId === viewModel.selectedUnitId && panelMode === 'edit') {
        return;
      }

      // Check for unsaved changes
      if (formViewModel?.isDirty) {
        pendingActionRef.current = { type: 'select', unitId: selectedId };
        setDialogState({ type: 'discard' });
      } else {
        selectAndLoadUnit(selectedId);
      }
    },
    [viewModel.selectedUnitId, panelMode, formViewModel, selectAndLoadUnit]
  );

  // Handle discard changes - proceed with pending action
  const handleDiscardChanges = useCallback(() => {
    const pending = pendingActionRef.current;
    setDialogState({ type: 'none' });
    pendingActionRef.current = null;

    if (pending?.type === 'select' && pending.unitId) {
      selectAndLoadUnit(pending.unitId);
    } else if (pending?.type === 'create') {
      enterCreateMode();
    }
  }, [selectAndLoadUnit]);

  // Handle cancel discard - stay on current unit
  const handleCancelDiscard = useCallback(() => {
    setDialogState({ type: 'none' });
    pendingActionRef.current = null;
  }, []);

  // Enter create mode
  const enterCreateMode = useCallback(() => {
    setOperationError(null);
    const service = getOrganizationUnitService();
    const vm = new OrganizationUnitFormViewModel(service, 'create');

    // Pre-select parent if a unit is currently selected
    if (viewModel.selectedUnitId) {
      const parent = viewModel.getUnitById(viewModel.selectedUnitId);
      if (parent && parent.isActive) {
        vm.setParent(viewModel.selectedUnitId);
      }
    }

    setFormViewModel(vm);
    setCurrentUnit(null);
    setPanelMode('create');

    // Auto-focus Unit Name input after form renders
    setTimeout(() => {
      document.getElementById('create-unit-name')?.focus();
    }, 0);

    log.debug('Entered create mode', { parentId: viewModel.selectedUnitId });
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

  // Handle form submission (both edit and create)
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!formViewModel) return;

      const result = await formViewModel.submit();

      if (result.success && result.unit) {
        log.info('Form submitted successfully', {
          mode: panelMode,
          unitId: result.unit.id,
        });

        // Reload tree to reflect changes
        await viewModel.loadUnits();

        if (panelMode === 'create') {
          // After create: expand to parent, select new unit, switch to edit mode
          const parentId = formViewModel.formData.parentId;
          if (parentId) {
            viewModel.expandToNode(parentId);
          }
          await selectAndLoadUnit(result.unit.id);
        } else {
          // After edit: stay on same unit, reload its data
          await selectAndLoadUnit(result.unit.id);
        }
      }
    },
    [formViewModel, panelMode, viewModel, selectAndLoadUnit]
  );

  // Handle cancel in form
  const handleCancel = useCallback(() => {
    if (panelMode === 'create') {
      // Return to previous selection or empty state
      if (viewModel.selectedUnitId) {
        selectAndLoadUnit(viewModel.selectedUnitId);
      } else {
        setPanelMode('empty');
        setFormViewModel(null);
        setCurrentUnit(null);
      }
    }
  }, [panelMode, viewModel.selectedUnitId, selectAndLoadUnit]);

  // Deactivate handlers
  const handleDeactivateClick = useCallback(() => {
    if (currentUnit && currentUnit.isActive && !currentUnit.isRootOrganization) {
      setOperationError(null);
      setDialogState({ type: 'deactivate', isLoading: false });
    }
  }, [currentUnit]);

  const handleDeactivateConfirm = useCallback(async () => {
    if (!currentUnit) return;

    setDialogState({ type: 'deactivate', isLoading: true });
    setOperationError(null);
    try {
      const service = getOrganizationUnitService();
      const result = await service.deactivateUnit(currentUnit.id);

      if (result.success) {
        setDialogState({ type: 'none' });
        log.info('Unit deactivated successfully', { unitId: currentUnit.id });
        await viewModel.loadUnits();
        await selectAndLoadUnit(currentUnit.id);
      } else {
        setDialogState({ type: 'none' });
        setOperationError(result.error || 'Failed to deactivate unit');
      }
    } catch (error) {
      setDialogState({ type: 'none' });
      setOperationError(error instanceof Error ? error.message : 'Failed to deactivate unit');
    }
  }, [currentUnit, viewModel, selectAndLoadUnit]);

  // Reactivate handlers
  const handleReactivateClick = useCallback(() => {
    if (currentUnit && !currentUnit.isActive) {
      setOperationError(null);
      setDialogState({ type: 'reactivate', isLoading: false });
    }
  }, [currentUnit]);

  const handleReactivateConfirm = useCallback(async () => {
    if (!currentUnit) return;

    setDialogState({ type: 'reactivate', isLoading: true });
    setOperationError(null);
    try {
      const service = getOrganizationUnitService();
      const result = await service.reactivateUnit(currentUnit.id);

      if (result.success) {
        setDialogState({ type: 'none' });
        log.info('Unit reactivated successfully', { unitId: currentUnit.id });
        await viewModel.loadUnits();
        await selectAndLoadUnit(currentUnit.id);
      } else {
        setDialogState({ type: 'none' });
        setOperationError(result.error || 'Failed to reactivate unit');
      }
    } catch (error) {
      setDialogState({ type: 'none' });
      setOperationError(error instanceof Error ? error.message : 'Failed to reactivate unit');
    }
  }, [currentUnit, viewModel, selectAndLoadUnit]);

  // Delete handlers
  const handleDeleteClick = useCallback(() => {
    if (!currentUnit || currentUnit.isRootOrganization) return;

    if (currentUnit.isActive) {
      // Show warning that unit must be deactivated first
      setDialogState({ type: 'activeWarning' });
    } else {
      setOperationError(null);
      setDialogState({ type: 'delete', isLoading: false });
    }
  }, [currentUnit]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!currentUnit) return;

    setDialogState({ type: 'delete', isLoading: true });
    setOperationError(null);
    try {
      const service = getOrganizationUnitService();
      const result = await service.deleteUnit(currentUnit.id);

      if (result.success) {
        setDialogState({ type: 'none' });
        log.info('Unit deleted successfully', { unitId: currentUnit.id });

        const parentId = currentUnit.parentId;
        await viewModel.loadUnits();

        // Select parent or reset to empty
        if (parentId) {
          await selectAndLoadUnit(parentId);
        } else {
          setPanelMode('empty');
          setFormViewModel(null);
          setCurrentUnit(null);
        }
      } else {
        setDialogState({ type: 'none' });
        setOperationError(result.error || 'Failed to delete unit');
      }
    } catch (error) {
      setDialogState({ type: 'none' });
      setOperationError(error instanceof Error ? error.message : 'Failed to delete unit');
    }
  }, [currentUnit, viewModel, selectAndLoadUnit]);

  // Handle "deactivate first" flow from active warning dialog
  const handleDeactivateFirst = useCallback(() => {
    setDialogState({ type: 'deactivate', isLoading: false });
  }, []);

  // Get available parents for create mode
  const availableParents = viewModel.getAvailableParents();
  const selectedParentInCreate = formViewModel?.formData.parentId
    ? viewModel.getUnitById(formViewModel.formData.parentId)
    : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <Building2 className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Organization Units
              </h1>
              <p className="text-gray-600 mt-1">
                {hasAnyWritePermission
                  ? 'Create, edit, and organize your departments and locations'
                  : 'View your organization hierarchy'}
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

        {/* Layout: Full-width for view-only users, split view for users with write permissions */}
        <div className={cn(
          "grid grid-cols-1 gap-6",
          hasAnyWritePermission && "lg:grid-cols-3"
        )}>
          {/* Left Panel: Tree View */}
          <div className={hasAnyWritePermission ? "lg:col-span-2" : "lg:col-span-1"}>
            <Card className="shadow-lg h-[calc(100vh-280px)]">
              <CardHeader className="border-b border-gray-200 pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl font-semibold text-gray-900">
                    Organization Hierarchy
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => viewModel.expandAll()}
                      disabled={viewModel.isLoading}
                    >
                      <ChevronDown className="w-4 h-4 mr-1" />
                      Expand All
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => viewModel.collapseAll()}
                      disabled={viewModel.isLoading}
                    >
                      <ChevronUp className="w-4 h-4 mr-1" />
                      Collapse All
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => viewModel.refresh()}
                      disabled={viewModel.isLoading}
                    >
                      <RefreshCw
                        className={`w-4 h-4 ${viewModel.isLoading ? 'animate-spin' : ''}`}
                      />
                    </Button>
                  </div>
                </div>

                {/* Status Filter Tabs */}
                <StatusFilterTabs
                  options={statusOptions}
                  value={statusFilter}
                  onChange={handleStatusFilterChange}
                  ariaLabel="Filter organization units by status"
                  className="mt-4"
                />

                {/* Search Bar */}
                <div className="relative mt-3">
                  <Search
                    className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
                    size={18}
                    aria-hidden="true"
                  />
                  <Input
                    type="search"
                    placeholder="Search by name..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                    aria-label="Search organization units"
                  />
                </div>
              </CardHeader>
              <CardContent className="p-6">
                {/* Loading State */}
                {viewModel.isLoading && viewModel.unitCount === 0 && (
                  <div className="flex items-center justify-center py-12">
                    <div className="flex flex-col items-center gap-3">
                      <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                      <p className="text-gray-600">Loading organization structure...</p>
                    </div>
                  </div>
                )}

                {/* Tree View */}
                {(!viewModel.isLoading || viewModel.unitCount > 0) && (
                  <OrganizationTree
                    nodes={filteredTreeNodes}
                    selectedId={viewModel.selectedUnitId}
                    expandedIds={viewModel.expandedNodeIds}
                    onSelect={handleTreeSelect}
                    onToggle={viewModel.toggleNode.bind(viewModel)}
                    onMoveDown={viewModel.moveSelectionDown.bind(viewModel)}
                    onMoveUp={viewModel.moveSelectionUp.bind(viewModel)}
                    onArrowRight={viewModel.handleArrowRight.bind(viewModel)}
                    onArrowLeft={viewModel.handleArrowLeft.bind(viewModel)}
                    onSelectFirst={viewModel.selectFirst.bind(viewModel)}
                    onSelectLast={viewModel.selectLast.bind(viewModel)}
                    ariaLabel="Organization hierarchy - select a unit to edit"
                    activeStatusFilter={statusFilter}
                    className="border rounded-lg p-4 min-h-[400px]"
                  />
                )}

                {/* Help text */}
                <p className="mt-4 text-sm text-gray-500 text-center">
                  Click a unit to edit • Arrow keys to navigate • Enter to expand/collapse
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Right Panel: Form Panel (only shown if user has write permissions) */}
          {hasAnyWritePermission && (
          <div className="lg:col-span-1">
            {/* Create Button - Only visible if user has create_ou permission */}
            {permissions.canCreate && (
            <Button
              onClick={handleCreateClick}
              disabled={viewModel.isLoading}
              className="w-full mb-4 bg-blue-600 hover:bg-blue-700 text-white justify-start"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create New Unit
              {panelMode === 'edit' && currentUnit && !currentUnit.isRootOrganization && (
                <span className="ml-auto text-xs opacity-75">(under selected)</span>
              )}
            </Button>
            )}

            {/* Empty State */}
            {panelMode === 'empty' && (
              <Card className="shadow-lg">
                <CardContent className="p-12 text-center">
                  <MapPin className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-xl font-medium text-gray-900 mb-2">
                    No Unit Selected
                  </h3>
                  <p className="text-gray-500 max-w-md mx-auto">
                    {permissions.canCreate
                      ? 'Select a unit from the tree to view and edit its details, or click "Create New Unit" to add a new one.'
                      : 'Select a unit from the tree to view its details.'}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* View Mode (read-only detail panel for users without update permission) */}
            {panelMode === 'view' && currentUnit && (
              <Card className="shadow-lg">
                <CardHeader className="border-b border-gray-200">
                  <CardTitle className="text-xl font-semibold text-gray-900">
                    Unit Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                  {/* Status Badge */}
                  <div className="flex items-center gap-2">
                    {currentUnit.isActive ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                        <XCircle className="w-3 h-3 mr-1" />
                        Inactive
                      </span>
                    )}
                    {currentUnit.isRootOrganization && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        <Building2 className="w-3 h-3 mr-1" />
                        Root Organization
                      </span>
                    )}
                  </div>

                  {/* Name */}
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-gray-500">Unit Name</Label>
                    <p className="text-gray-900">{currentUnit.name}</p>
                  </div>

                  {/* Display Name */}
                  {currentUnit.displayName && (
                    <div className="space-y-1">
                      <Label className="text-sm font-medium text-gray-500">Display Name</Label>
                      <p className="text-gray-900">{currentUnit.displayName}</p>
                    </div>
                  )}

                  {/* Hierarchy Path */}
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-gray-500">Hierarchy Path</Label>
                    <p className="text-sm text-gray-700 font-mono bg-gray-50 px-3 py-2 rounded-md border border-gray-200 break-all">
                      {currentUnit.path}
                    </p>
                  </div>

                  {/* Timezone */}
                  {currentUnit.timeZone && (
                    <div className="space-y-1">
                      <Label className="text-sm font-medium text-gray-500">Timezone</Label>
                      <p className="text-gray-900">{currentUnit.timeZone}</p>
                    </div>
                  )}

                  {/* Child Count */}
                  {currentUnit.childCount > 0 && (
                    <div className="space-y-1">
                      <Label className="text-sm font-medium text-gray-500">Child Units</Label>
                      <p className="text-gray-900">{currentUnit.childCount} unit(s)</p>
                    </div>
                  )}

                  {/* Read-only notice */}
                  <div className="pt-4 border-t border-gray-200">
                    <p className="text-xs text-gray-500 text-center">
                      You have view-only access to organization units.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Create Mode */}
            {panelMode === 'create' && formViewModel && (
              <Card className="shadow-lg">
                <CardHeader className="border-b border-gray-200">
                  <CardTitle className="text-xl font-semibold text-gray-900">
                    Create New Unit
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
                              Failed to create unit
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

                    {/* Parent Unit Dropdown */}
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-gray-700">
                        Parent Unit
                      </Label>
                      <Select.Root
                        value={formViewModel.formData.parentId ?? 'root'}
                        onValueChange={(value) =>
                          formViewModel.setParent(value === 'root' ? null : value)
                        }
                      >
                        <Select.Trigger
                          className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm items-center justify-between focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          aria-label="Parent Unit"
                        >
                          <Select.Value>
                            {selectedParentInCreate
                              ? selectedParentInCreate.displayName || selectedParentInCreate.name
                              : 'Root Organization (direct child)'}
                          </Select.Value>
                          <Select.Icon>
                            <ChevronDown className="h-4 w-4 text-gray-400" />
                          </Select.Icon>
                        </Select.Trigger>
                        <Select.Portal>
                          <Select.Content className="bg-white rounded-md shadow-lg border border-gray-200 overflow-hidden z-50 max-h-[300px]">
                            <Select.Viewport className="p-1">
                              <Select.Item
                                value="root"
                                className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-100 rounded outline-none data-[highlighted]:bg-gray-100"
                              >
                                <Select.ItemText>Root Organization (direct child)</Select.ItemText>
                              </Select.Item>
                              {availableParents.map((unit) => (
                                <Select.Item
                                  key={unit.id}
                                  value={unit.id}
                                  className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-100 rounded outline-none data-[highlighted]:bg-gray-100"
                                >
                                  <Select.ItemText>
                                    <span
                                      className="inline-block"
                                      style={{
                                        marginLeft: `${(unit.path.split('.').length - 2) * 12}px`,
                                      }}
                                    >
                                      {unit.displayName || unit.name}
                                    </span>
                                  </Select.ItemText>
                                </Select.Item>
                              ))}
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </div>

                    {/* Shared Form Fields: Name, Display Name, Timezone */}
                    <OrganizationUnitFormFields
                      formViewModel={formViewModel}
                      idPrefix="create"
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
                        {formViewModel.isSubmitting ? 'Creating...' : 'Create Unit'}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            {/* Edit Mode */}
            {panelMode === 'edit' && currentUnit && formViewModel && (
              <>
                {/* Root Organization Warning */}
                {currentUnit.isRootOrganization && (
                  <div className="mb-4 p-4 rounded-lg border border-blue-300 bg-blue-50">
                    <div className="flex items-start gap-3">
                      <Building2 className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <h3 className="text-blue-800 font-semibold text-sm">Root Organization</h3>
                        <p className="text-blue-700 text-xs mt-1">
                          This is your root organization. You can edit its name and display name,
                          but it cannot be deactivated or deleted.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Form Card */}
                <Card className="shadow-lg">
                  <CardHeader className="border-b border-gray-200">
                    <CardTitle className="text-xl font-semibold text-gray-900">
                      Unit Details
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
                                Failed to update unit
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

                      {/* Path Display (read-only) */}
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-gray-700">
                          Hierarchy Path
                        </Label>
                        <p className="text-sm text-gray-700 font-mono bg-gray-50 px-3 py-2 rounded-md border border-gray-200 break-all">
                          {currentUnit.path}
                        </p>
                      </div>

                      {/* Shared Form Fields: Name, Display Name, Timezone */}
                      <OrganizationUnitFormFields
                        formViewModel={formViewModel}
                        idPrefix="edit"
                      />

                      {/* Active Status Toggle (not for root org, only if user has deactivate or reactivate permission) */}
                      {!currentUnit.isRootOrganization && (
                        (currentUnit.isActive && permissions.canDeactivate) ||
                        (!currentUnit.isActive && permissions.canReactivate)
                      ) && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-gray-50 border border-gray-200">
                          <Checkbox
                            id="is-active"
                            checked={currentUnit.isActive}
                            onCheckedChange={() => {
                              if (currentUnit.isActive) {
                                handleDeactivateClick();
                              } else {
                                handleReactivateClick();
                              }
                            }}
                            disabled={
                              dialogState.type === 'deactivate' ||
                              dialogState.type === 'reactivate' ||
                              formViewModel.isSubmitting
                            }
                            className="mt-0.5 shadow-sm ring-1 ring-gray-300 bg-white/80 backdrop-blur-sm"
                          />
                          <div>
                            <Label htmlFor="is-active" className="text-xs font-medium text-gray-900 cursor-pointer">
                              Unit is Active
                            </Label>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Inactive units are hidden from most views.
                              {currentUnit.isActive && currentUnit.childCount > 0 && (
                                <span className="block text-orange-600 mt-1 font-medium">
                                  Warning: Deactivating will also deactivate all {currentUnit.childCount} child
                                  unit(s).
                                </span>
                              )}
                              {!currentUnit.isActive && currentUnit.childCount > 0 && (
                                <span className="block text-green-600 mt-1 font-medium">
                                  Note: Reactivating will also reactivate all {currentUnit.childCount} child
                                  unit(s).
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Form Actions */}
                      <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                        <div>
                          {formViewModel.isDirty && (
                            <span className="text-sm text-amber-600">Unsaved changes</span>
                          )}
                        </div>
                        <Button
                          type="submit"
                          disabled={!formViewModel.canSubmit}
                          className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                          <Save className="w-4 h-4 mr-1" />
                          {formViewModel.isSubmitting ? 'Saving...' : 'Save Changes'}
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>

                {/* Danger Zone - only for non-root orgs and if user has deactivate, reactivate, or delete permissions */}
                {!currentUnit.isRootOrganization && (permissions.canDeactivate || permissions.canReactivate || permissions.canDelete) && (
                  <section className="mt-4" aria-labelledby="danger-zone-heading">
                    <Card className="shadow-lg border-red-200">
                      <CardHeader className="border-b border-red-200 bg-red-50 py-3">
                        <CardTitle id="danger-zone-heading" className="text-sm font-semibold text-red-800">
                          Danger Zone
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 space-y-4">
                        {/* Reactivate Section - Only for inactive units and if user has reactivate_ou permission */}
                        {!currentUnit.isActive && permissions.canReactivate && (
                          <div className={permissions.canDelete ? "pb-4 border-b border-gray-200" : ""}>
                            <h4 className="text-sm font-medium text-gray-900">Reactivate this unit</h4>
                            <p className="text-xs text-gray-600 mt-1">
                              Reactivating allows new role assignments.
                              {currentUnit.childCount > 0 && (
                                <span className="block text-green-600 mt-1">
                                  This will also reactivate all {currentUnit.childCount} child unit(s).
                                </span>
                              )}
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleReactivateClick}
                              disabled={
                                formViewModel?.isSubmitting ||
                                (dialogState.type === 'reactivate' && dialogState.isLoading)
                              }
                              className="mt-2 text-green-600 border-green-300 hover:bg-green-50"
                            >
                              <CheckCircle className="w-3 h-3 mr-1" />
                              {dialogState.type === 'reactivate' && dialogState.isLoading
                                ? 'Reactivating...'
                                : 'Reactivate Unit'}
                            </Button>
                          </div>
                        )}

                        {/* Delete Section - Only if user has delete_ou permission */}
                        {permissions.canDelete && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-900">Delete this unit</h4>
                          <p className="text-xs text-gray-600 mt-1">
                            Permanently remove from the organization hierarchy.
                            {currentUnit.isActive && (
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
                              formViewModel?.isSubmitting ||
                              (dialogState.type === 'delete' && dialogState.isLoading)
                            }
                            className="mt-2 text-red-600 border-red-300 hover:bg-red-50"
                          >
                            <Trash2 className="w-3 h-3 mr-1" />
                            {dialogState.type === 'delete' && dialogState.isLoading
                              ? 'Deleting...'
                              : 'Delete Unit'}
                          </Button>
                        </div>
                        )}
                      </CardContent>
                    </Card>
                  </section>
                )}
              </>
            )}
          </div>
          )}
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
        title="Deactivate Unit"
        message={
          currentUnit?.childCount && currentUnit.childCount > 0
            ? `Are you sure you want to deactivate "${currentUnit?.displayName || currentUnit?.name}" and all ${currentUnit.childCount} of its child unit(s)?`
            : `Are you sure you want to deactivate "${currentUnit?.displayName || currentUnit?.name}"?`
        }
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
        title="Reactivate Unit"
        message={
          currentUnit?.childCount && currentUnit.childCount > 0
            ? `Are you sure you want to reactivate "${currentUnit?.displayName || currentUnit?.name}" and all ${currentUnit.childCount} child unit(s)?`
            : `Are you sure you want to reactivate "${currentUnit?.displayName || currentUnit?.name}"?`
        }
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
        title="Cannot Delete Active Unit"
        message={`"${currentUnit?.displayName || currentUnit?.name}" must be deactivated before it can be deleted. Would you like to deactivate it now?`}
        confirmLabel="Deactivate First"
        cancelLabel="Cancel"
        onConfirm={handleDeactivateFirst}
        onCancel={() => setDialogState({ type: 'none' })}
        variant="warning"
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'delete'}
        title="Delete Organization Unit"
        message={`Are you sure you want to delete "${currentUnit?.displayName || currentUnit?.name}"? This action is permanent and cannot be undone.`}
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

export default OrganizationUnitsManagePage;
