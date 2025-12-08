/**
 * Organization Units Management Page
 *
 * CRUD interface for managing organizational units with split view layout.
 * Left panel: Tree view with selection
 * Right panel: Action buttons and selected unit details
 *
 * Features:
 * - Split view layout (tree + action panel)
 * - Create, Edit, Deactivate actions based on selection
 * - Confirmation dialog for deactivate action
 * - Breadcrumb showing selected unit path
 * - Loading and error states
 *
 * Route: /organization-units/manage
 * Permission: organization.create_ou
 */

import React, { useEffect, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { OrganizationTree } from '@/components/organization-units';
import { OrganizationUnitsViewModel } from '@/viewModels/organization/OrganizationUnitsViewModel';
import {
  Plus,
  Edit,
  Trash2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ArrowLeft,
  Building2,
  MapPin,
  AlertTriangle,
  X,
} from 'lucide-react';
import { Logger } from '@/utils/logger';
import { cn } from '@/components/ui/utils';

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
  variant?: 'danger' | 'warning' | 'default';
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
    default: 'bg-blue-600 hover:bg-blue-700',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-start gap-4">
          <div className={cn(
            'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center',
            variant === 'danger' && 'bg-red-100',
            variant === 'warning' && 'bg-orange-100',
            variant === 'default' && 'bg-blue-100'
          )}>
            <AlertTriangle className={cn(
              'w-5 h-5',
              variant === 'danger' && 'text-red-600',
              variant === 'warning' && 'text-orange-600',
              variant === 'default' && 'text-blue-600'
            )} />
          </div>
          <div className="flex-1">
            <h3 id="confirm-dialog-title" className="text-lg font-semibold text-gray-900">
              {title}
            </h3>
            <p className="mt-2 text-gray-600">
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
 * Organization Units Management Page Component
 */
export const OrganizationUnitsManagePage: React.FC = observer(() => {
  const navigate = useNavigate();
  const [viewModel] = useState(() => new OrganizationUnitsViewModel());
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);

  // Load units on mount
  useEffect(() => {
    log.debug('OrganizationUnitsManagePage mounted, loading units');
    viewModel.loadUnits();
  }, [viewModel]);

  // Navigation handlers
  const handleBackClick = () => {
    navigate('/organization-units');
  };

  const handleCreateClick = () => {
    // Pass the selected unit ID as parent if one is selected
    const parentId = viewModel.selectedUnitId;
    if (parentId) {
      navigate(`/organization-units/create?parentId=${parentId}`);
    } else {
      navigate('/organization-units/create');
    }
  };

  const handleEditClick = () => {
    if (viewModel.selectedUnitId) {
      navigate(`/organization-units/${viewModel.selectedUnitId}/edit`);
    }
  };

  const handleDeactivateClick = () => {
    if (viewModel.canDeactivate) {
      setShowDeactivateDialog(true);
    }
  };

  const handleDeactivateConfirm = useCallback(async () => {
    if (!viewModel.selectedUnitId) return;

    setIsDeactivating(true);
    try {
      const result = await viewModel.deactivateUnit(viewModel.selectedUnitId);
      if (result.success) {
        setShowDeactivateDialog(false);
        log.info('Unit deactivated successfully');
      } else {
        // Error is displayed in viewModel.error
        log.warn('Deactivation failed', { error: result.error });
      }
    } finally {
      setIsDeactivating(false);
    }
  }, [viewModel]);

  const handleDeactivateCancel = () => {
    setShowDeactivateDialog(false);
  };

  const handleRefresh = async () => {
    await viewModel.refresh();
  };

  // Get selected unit details
  const selectedUnit = viewModel.selectedUnit;

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
              Back to Overview
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <Building2 className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Manage Organization Units
              </h1>
              <p className="text-gray-600 mt-1">
                Create, edit, and organize your departments and locations
              </p>
            </div>
          </div>
        </div>

        {/* Error Banner */}
        {viewModel.error && (
          <div
            className="mb-6 p-4 rounded-lg border border-red-300 bg-red-50"
            role="alert"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-red-800 font-semibold">Error</h3>
                <p className="text-red-700 text-sm mt-1">{viewModel.error}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => viewModel.clearError()}
                className="text-red-600 border-red-300"
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}

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
                      onClick={handleRefresh}
                      disabled={viewModel.isLoading}
                    >
                      <RefreshCw className={`w-4 h-4 ${viewModel.isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
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
                {!viewModel.isLoading || viewModel.unitCount > 0 ? (
                  <OrganizationTree
                    nodes={viewModel.treeNodes}
                    selectedId={viewModel.selectedUnitId}
                    expandedIds={viewModel.expandedNodeIds}
                    onSelect={viewModel.selectNode.bind(viewModel)}
                    onToggle={viewModel.toggleNode.bind(viewModel)}
                    onMoveDown={viewModel.moveSelectionDown.bind(viewModel)}
                    onMoveUp={viewModel.moveSelectionUp.bind(viewModel)}
                    onArrowRight={viewModel.handleArrowRight.bind(viewModel)}
                    onArrowLeft={viewModel.handleArrowLeft.bind(viewModel)}
                    onSelectFirst={viewModel.selectFirst.bind(viewModel)}
                    onSelectLast={viewModel.selectLast.bind(viewModel)}
                    ariaLabel="Organization hierarchy - select a unit to manage"
                    className="border rounded-lg p-4 bg-white min-h-[400px]"
                  />
                ) : null}
              </CardContent>
            </Card>
          </div>

          {/* Right Panel: Action Panel */}
          <div className="lg:col-span-1">
            <Card className="shadow-lg sticky top-8">
              <CardHeader className="border-b border-gray-200">
                <CardTitle className="text-lg font-semibold text-gray-900">
                  Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {/* Action Buttons */}
                <div className="space-y-3">
                  <Button
                    onClick={handleCreateClick}
                    disabled={viewModel.isLoading}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white justify-start"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Create New Unit
                    {selectedUnit && !selectedUnit.isRootOrganization && (
                      <span className="ml-auto text-xs opacity-75">
                        (under selected)
                      </span>
                    )}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={handleEditClick}
                    disabled={!viewModel.canEdit || viewModel.isLoading}
                    className="w-full justify-start"
                  >
                    <Edit className="w-4 h-4 mr-2" />
                    Edit Selected Unit
                  </Button>

                  <Button
                    variant="outline"
                    onClick={handleDeactivateClick}
                    disabled={!viewModel.canDeactivate || viewModel.isLoading}
                    className="w-full justify-start text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Deactivate Unit
                  </Button>
                </div>

                {/* Selected Unit Details */}
                {selectedUnit && (
                  <div className="mt-6 pt-6 border-t border-gray-200">
                    <h4 className="text-sm font-semibold text-gray-900 mb-3">
                      Selected Unit
                    </h4>
                    <div className="space-y-3">
                      {/* Unit Name */}
                      <div className="flex items-start gap-2">
                        {selectedUnit.isRootOrganization ? (
                          <Building2 className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                        ) : (
                          <MapPin className="w-5 h-5 text-gray-500 flex-shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className="font-medium text-gray-900">
                            {selectedUnit.displayName || selectedUnit.name}
                          </p>
                          {selectedUnit.isRootOrganization && (
                            <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                              Root Organization
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Path Breadcrumb */}
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Path</p>
                        <p className="text-sm text-gray-700 font-mono bg-gray-50 px-2 py-1 rounded break-all">
                          {selectedUnit.path}
                        </p>
                      </div>

                      {/* Status */}
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Status</p>
                        <span className={cn(
                          'text-sm px-2 py-0.5 rounded-full',
                          selectedUnit.isActive
                            ? 'bg-green-100 text-green-700'
                            : 'bg-orange-100 text-orange-700'
                        )}>
                          {selectedUnit.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>

                      {/* Child Count */}
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Direct Children</p>
                        <p className="text-sm text-gray-700">
                          {selectedUnit.childCount} unit{selectedUnit.childCount !== 1 ? 's' : ''}
                        </p>
                      </div>

                      {/* Timezone */}
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Time Zone</p>
                        <p className="text-sm text-gray-700">
                          {selectedUnit.timeZone}
                        </p>
                      </div>
                    </div>

                    {/* Deactivate Warning */}
                    {!viewModel.canDeactivate && selectedUnit && !selectedUnit.isRootOrganization && selectedUnit.isActive && (
                      <div className="mt-4 p-3 rounded-lg bg-orange-50 border border-orange-200">
                        <p className="text-xs text-orange-700">
                          {selectedUnit.childCount > 0
                            ? 'Cannot deactivate: This unit has child units. Remove or move them first.'
                            : 'Cannot deactivate this unit.'}
                        </p>
                      </div>
                    )}

                    {selectedUnit.isRootOrganization && (
                      <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-200">
                        <p className="text-xs text-blue-700">
                          The root organization cannot be deactivated. It represents your entire organization.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* No Selection State */}
                {!selectedUnit && (
                  <div className="mt-6 pt-6 border-t border-gray-200 text-center">
                    <MapPin className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">
                      Select a unit from the tree to view details and enable actions.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Help Text */}
        <div className="mt-6 text-center text-sm text-gray-500">
          <p>
            Click on a unit to select it. Use arrow keys to navigate, Enter to expand/collapse.
          </p>
        </div>
      </div>

      {/* Deactivate Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeactivateDialog}
        title="Deactivate Unit"
        message={`Are you sure you want to deactivate "${selectedUnit?.displayName || selectedUnit?.name}"? This action can be reversed by editing the unit later.`}
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        onConfirm={handleDeactivateConfirm}
        onCancel={handleDeactivateCancel}
        isLoading={isDeactivating}
        variant="danger"
      />
    </div>
  );
});

export default OrganizationUnitsManagePage;
