import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { RoleCard } from '@/components/roles/RoleCard';
import { RolesViewModel } from '@/viewModels/roles/RolesViewModel';
import { Plus, Search, Shield } from 'lucide-react';
import { Logger } from '@/utils/logger';
import { isCanonicalRole } from '@/config/roles.config';

const log = Logger.getLogger('component');

/**
 * RolesPage - Card-based listing of roles
 *
 * Displays roles in a responsive grid layout with:
 * - Status filter tabs (All / Active / Inactive)
 * - Search input
 * - Role cards with quick actions
 *
 * @example
 * // Route configuration
 * <Route path="/roles" element={<RolesPage />} />
 */
export const RolesPage: React.FC = observer(() => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Create ViewModel on mount
  const viewModel = useMemo(() => new RolesViewModel(), []);

  // Local state - read initial status from URL
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
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    roleId: string;
    roleName: string;
    action: 'deactivate' | 'reactivate';
  }>({
    isOpen: false,
    roleId: '',
    roleName: '',
    action: 'deactivate',
  });

  // Load data on mount
  useEffect(() => {
    log.debug('RolesPage mounting, loading roles');
    viewModel.loadAll();
  }, [viewModel]);

  // Filter roles by search term (client-side for responsiveness)
  const filteredRoles = useMemo(() => {
    // First, filter out canonical/system roles (defense in depth - also filtered in ViewModel)
    let roles = viewModel.roles.filter((r) => !isCanonicalRole(r.name));

    // Apply status filter
    if (statusFilter === 'active') {
      roles = roles.filter((r) => r.isActive);
    } else if (statusFilter === 'inactive') {
      roles = roles.filter((r) => !r.isActive);
    }

    // Apply search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      roles = roles.filter(
        (r) =>
          r.name.toLowerCase().includes(term) ||
          r.description.toLowerCase().includes(term)
      );
    }

    return roles;
  }, [viewModel.roles, statusFilter, searchTerm]);

  // Navigation handlers - preserve status filter in URL
  const handleCreateClick = () => {
    const params = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
    navigate(`/roles/manage${params}`);
  };

  const handleDeactivate = (roleId: string) => {
    const role = viewModel.getRoleById(roleId);
    if (role) {
      setConfirmDialog({
        isOpen: true,
        roleId,
        roleName: role.name,
        action: 'deactivate',
      });
    }
  };

  const handleReactivate = (roleId: string) => {
    const role = viewModel.getRoleById(roleId);
    if (role) {
      setConfirmDialog({
        isOpen: true,
        roleId,
        roleName: role.name,
        action: 'reactivate',
      });
    }
  };

  const handleConfirmAction = async () => {
    if (confirmDialog.action === 'deactivate') {
      await viewModel.deactivateRole(confirmDialog.roleId);
    } else {
      await viewModel.reactivateRole(confirmDialog.roleId);
    }
    setConfirmDialog({ ...confirmDialog, isOpen: false });
  };

  const handleCancelAction = () => {
    setConfirmDialog({ ...confirmDialog, isOpen: false });
  };

  log.debug('RolesPage rendering', {
    roleCount: viewModel.roleCount,
    filteredCount: filteredRoles.length,
    statusFilter,
    searchTerm,
  });

  return (
    <div>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Roles</h1>
          <p className="text-gray-600 mt-1">Manage role definitions and permissions</p>
        </div>
        <Button
          className="flex items-center gap-2"
          onClick={handleCreateClick}
          disabled={viewModel.isLoading}
        >
          <Plus size={20} />
          Create Role
        </Button>
      </div>

      {/* Filter Tabs */}
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
          All ({viewModel.roleCount})
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
          Active ({viewModel.activeRoleCount})
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
          Inactive ({viewModel.roleCount - viewModel.activeRoleCount})
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
          placeholder="Search by name or description..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 max-w-md"
          aria-label="Search roles"
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
      {viewModel.isLoading && filteredRoles.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-gray-500">
            <Shield className="w-6 h-6 animate-pulse" />
            <span>Loading roles...</span>
          </div>
        </div>
      )}

      {/* Role Grid */}
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        data-testid="role-list"
      >
        {filteredRoles.map((role) => (
          <RoleCard
            key={role.id}
            role={role}
            onDeactivate={handleDeactivate}
            onReactivate={handleReactivate}
            isLoading={viewModel.isLoading}
          />
        ))}
      </div>

      {/* Empty State */}
      {!viewModel.isLoading && filteredRoles.length === 0 && (
        <div className="text-center py-12">
          {viewModel.roleCount === 0 ? (
            <div>
              <Shield className="w-12 h-12 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500 mb-4">No roles defined yet.</p>
              <Button onClick={handleCreateClick}>
                <Plus size={16} className="mr-2" />
                Create Your First Role
              </Button>
            </div>
          ) : (
            <p className="text-gray-500">No roles found matching your search.</p>
          )}
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={
          confirmDialog.action === 'deactivate' ? 'Deactivate Role' : 'Reactivate Role'
        }
        message={
          confirmDialog.action === 'deactivate'
            ? `Are you sure you want to deactivate "${confirmDialog.roleName}"? Users with this role will lose their permissions until the role is reactivated.`
            : `Are you sure you want to reactivate "${confirmDialog.roleName}"? Users with this role will regain their permissions.`
        }
        confirmLabel={confirmDialog.action === 'deactivate' ? 'Deactivate' : 'Reactivate'}
        cancelLabel="Cancel"
        onConfirm={handleConfirmAction}
        onCancel={handleCancelAction}
        isLoading={viewModel.isLoading}
        variant={confirmDialog.action === 'deactivate' ? 'warning' : 'success'}
      />
    </div>
  );
});

export default RolesPage;
