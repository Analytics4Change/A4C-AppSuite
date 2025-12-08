/**
 * Organization Units List Page
 *
 * Read-only view of the organization hierarchy tree.
 * Provides navigation to the management page for CRUD operations.
 *
 * Features:
 * - Tree visualization of organizational units
 * - Expand/collapse all functionality
 * - Navigation to management page
 * - Loading and error states
 *
 * Route: /organization-units
 * Permission: organization.create_ou (view requires this permission)
 */

import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { OrganizationTree } from '@/components/organization-units';
import { OrganizationUnitsViewModel } from '@/viewModels/organization/OrganizationUnitsViewModel';
import { Settings, ChevronDown, ChevronUp, RefreshCw, Building2 } from 'lucide-react';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Organization Units List Page Component
 *
 * Displays a read-only tree view of organizational units.
 */
export const OrganizationUnitsListPage: React.FC = observer(() => {
  const navigate = useNavigate();
  const [viewModel] = useState(() => new OrganizationUnitsViewModel());

  // Load units on mount
  useEffect(() => {
    log.debug('OrganizationUnitsListPage mounted, loading units');
    viewModel.loadUnits();
  }, [viewModel]);

  // Navigation handlers
  const handleManageClick = () => {
    navigate('/organization-units/manage');
  };

  const handleRefresh = async () => {
    await viewModel.refresh();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Building2 className="w-8 h-8 text-blue-600" />
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  Organization Structure
                </h1>
                <p className="text-gray-600 mt-1">
                  View your organization's departments and locations
                </p>
              </div>
            </div>
            <Button
              onClick={handleManageClick}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Settings className="w-4 h-4 mr-2" />
              Manage Units
            </Button>
          </div>
        </div>

        {/* Main Content Card */}
        <Card className="shadow-lg">
          <CardHeader className="border-b border-gray-200">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl font-semibold text-gray-900">
                Organization Hierarchy
              </CardTitle>
              <div className="flex items-center gap-2">
                {/* Expand/Collapse All */}
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

            {/* Error State */}
            {viewModel.error && (
              <div
                className="p-4 rounded-lg border border-red-300 bg-red-50 mb-4"
                role="alert"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <h3 className="text-red-800 font-semibold">
                      Failed to load organization structure
                    </h3>
                    <p className="text-red-700 text-sm mt-1">
                      {viewModel.error}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefresh}
                    className="text-red-600 border-red-300 hover:bg-red-50"
                  >
                    Retry
                  </Button>
                </div>
              </div>
            )}

            {/* Tree View */}
            {!viewModel.isLoading && !viewModel.error && (
              <>
                {/* Stats Bar */}
                <div className="flex items-center gap-4 mb-4 text-sm text-gray-600">
                  <span>
                    <strong>{viewModel.unitCount}</strong> total units
                  </span>
                  <span className="text-gray-300">|</span>
                  <span>
                    <strong>{viewModel.activeUnitCount}</strong> active
                  </span>
                </div>

                {/* Organization Tree */}
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
                  ariaLabel="Organization hierarchy (read-only)"
                  readOnly
                  className="border rounded-lg p-4 bg-white"
                />
              </>
            )}
          </CardContent>
        </Card>

        {/* Help Text */}
        <div className="mt-6 text-center text-sm text-gray-500">
          <p>
            Use arrow keys to navigate the tree. Press Enter or Space to expand/collapse nodes.
          </p>
          <p className="mt-1">
            Click "Manage Units" to create, edit, or deactivate organizational units.
          </p>
        </div>
      </div>
    </div>
  );
});

export default OrganizationUnitsListPage;
