/**
 * Organization Units List Page
 *
 * Read-only view of the organization hierarchy tree with search and filtering.
 * Provides navigation to the management page for CRUD operations.
 *
 * Features:
 * - Status filter tabs (All / Active / Inactive)
 * - Search input for filtering by name
 * - Tree visualization of organizational units
 * - Expand/collapse all functionality
 * - Navigation to management page
 * - Loading and error states
 *
 * Route: /organization-units
 * Permission: organization.view_ou
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OrganizationTree } from '@/components/organization-units';
import { OrganizationUnitsViewModel } from '@/viewModels/organization/OrganizationUnitsViewModel';
import {
  Settings,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Building2,
  Search,
} from 'lucide-react';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Organization Units List Page Component
 *
 * Displays a read-only tree view of organizational units with search and filtering.
 */
export const OrganizationUnitsListPage: React.FC = observer(() => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewModel] = useState(() => new OrganizationUnitsViewModel());

  // Local state for search and filter - read initial status from URL
  const [searchTerm, setSearchTerm] = useState('');
  const statusParam = searchParams.get('status') as 'all' | 'active' | 'inactive' | null;
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>(
    statusParam || 'all'
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

  // Load units on mount
  useEffect(() => {
    log.debug('OrganizationUnitsListPage mounted, loading units');
    viewModel.loadUnits();
  }, [viewModel]);

  // Filter tree nodes based on search and status
  const filteredTreeNodes = useMemo(() => {
    let nodes = viewModel.treeNodes;

    // Apply status filter at the node level
    const filterNodes = (nodeList: typeof nodes): typeof nodes => {
      return nodeList
        .filter((node) => {
          // Status filter
          if (statusFilter === 'active' && !node.isActive) return false;
          if (statusFilter === 'inactive' && node.isActive) return false;

          // Search filter (check name and displayName)
          if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase();
            const nameMatch = node.name.toLowerCase().includes(term);
            const displayNameMatch = node.displayName?.toLowerCase().includes(term);
            const hasMatchingChild = node.children.some((child) =>
              filterNodes([child]).length > 0
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

  // Navigation handlers - preserve status filter in URL
  const handleManageClick = () => {
    const params = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
    navigate(`/organization-units/manage${params}`);
  };

  const handleRefresh = async () => {
    await viewModel.refresh();
  };

  // Calculate counts for filter tabs
  const activeCount = viewModel.activeUnitCount;
  const totalCount = viewModel.unitCount;
  const inactiveCount = totalCount - activeCount;

  log.debug('OrganizationUnitsListPage rendering', {
    unitCount: totalCount,
    filteredCount: filteredTreeNodes.length,
    statusFilter,
    searchTerm,
  });

  return (
    <div>
      {/* Page Header - Responsive like Roles */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Organization Structure</h1>
          <p className="text-gray-600 mt-1">
            View your organization's departments and locations
          </p>
        </div>
        <Button
          className="flex items-center gap-2"
          onClick={handleManageClick}
          disabled={viewModel.isLoading}
        >
          <Settings size={20} />
          Manage Units
        </Button>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex gap-2 mb-4" role="group" aria-label="Filter by status">
        <Button
          variant={statusFilter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => handleStatusFilterChange('all')}
          aria-pressed={statusFilter === 'all'}
          className={
            statusFilter === 'all'
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'hover:bg-gray-100'
          }
        >
          All ({totalCount})
        </Button>
        <Button
          variant={statusFilter === 'active' ? 'default' : 'outline'}
          size="sm"
          onClick={() => handleStatusFilterChange('active')}
          aria-pressed={statusFilter === 'active'}
          className={
            statusFilter === 'active'
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'hover:bg-gray-100'
          }
        >
          Active ({activeCount})
        </Button>
        <Button
          variant={statusFilter === 'inactive' ? 'default' : 'outline'}
          size="sm"
          onClick={() => handleStatusFilterChange('inactive')}
          aria-pressed={statusFilter === 'inactive'}
          className={
            statusFilter === 'inactive'
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'hover:bg-gray-100'
          }
        >
          Inactive ({inactiveCount})
        </Button>
      </div>

      {/* Search Bar */}
      <div className="relative mb-6">
        <Search
          className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
          size={20}
        />
        <Input
          type="search"
          placeholder="Search by name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 max-w-md"
          aria-label="Search organization units"
        />
      </div>

      {/* Error Display */}
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

      {/* Loading State */}
      {viewModel.isLoading && viewModel.unitCount === 0 && (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-gray-500">
            <Building2 className="w-6 h-6 animate-pulse" />
            <span>Loading organization structure...</span>
          </div>
        </div>
      )}

      {/* Tree Card */}
      {!viewModel.isLoading && !viewModel.error && (
        <Card className="shadow-lg">
          <CardHeader className="border-b border-gray-200 pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold text-gray-900">
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
                  <RefreshCw
                    className={`w-4 h-4 ${viewModel.isLoading ? 'animate-spin' : ''}`}
                  />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {/* Empty State */}
            {filteredTreeNodes.length === 0 ? (
              <div className="text-center py-12">
                {viewModel.unitCount === 0 ? (
                  <div>
                    <Building2 className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                    <p className="text-gray-500 mb-4">No organization units defined yet.</p>
                    <Button onClick={handleManageClick}>
                      <Settings size={16} className="mr-2" />
                      Create Your First Unit
                    </Button>
                  </div>
                ) : (
                  <p className="text-gray-500">No units found matching your search.</p>
                )}
              </div>
            ) : (
              <OrganizationTree
                nodes={filteredTreeNodes}
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
            )}
          </CardContent>
        </Card>
      )}

      {/* Help Text */}
      <div className="mt-6 text-center text-sm text-gray-500">
        <p>
          Use arrow keys to navigate the tree. Press Enter or Space to expand/collapse
          nodes.
        </p>
        <p className="mt-1">
          Click "Manage Units" to create, edit, or deactivate organizational units.
        </p>
      </div>
    </div>
  );
});

export default OrganizationUnitsListPage;
