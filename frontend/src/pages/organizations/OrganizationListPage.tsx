import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OrganizationCard } from '@/components/organizations/OrganizationCard';
import { OrganizationManageListViewModel } from '@/viewModels/organization/OrganizationManageListViewModel';
import { useAuth } from '@/contexts/AuthContext';
import { Building2, Plus, Search } from 'lucide-react';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * OrganizationListPage - Card-based listing of organizations
 *
 * Platform owners see all organizations in a card grid.
 * Provider admins are redirected to /organizations/manage (their own org).
 */
export const OrganizationListPage: React.FC = observer(() => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session: authSession } = useAuth();

  const isPlatformOwner = authSession?.claims.org_type === 'platform_owner';

  // Provider admin redirect
  if (!isPlatformOwner) {
    log.info('Provider admin redirected from list to manage page', {
      orgType: authSession?.claims.org_type,
    });
    return <Navigate to="/organizations/manage" replace />;
  }

  // Create ViewModel on mount
  const viewModel = useMemo(() => new OrganizationManageListViewModel(), []);

  // Local state
  const [searchTerm, setSearchTerm] = useState('');
  const statusParam = searchParams.get('status') as 'all' | 'active' | 'inactive' | null;
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>(
    statusParam || 'all'
  );

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

  // Load data on mount
  useEffect(() => {
    log.debug('OrganizationListPage mounting, loading organizations');
    viewModel.loadOrganizations();
  }, [viewModel]);

  // Client-side filtering
  const filteredOrganizations = useMemo(() => {
    let orgs = viewModel.organizations;

    if (statusFilter === 'active') {
      orgs = orgs.filter((o) => o.is_active);
    } else if (statusFilter === 'inactive') {
      orgs = orgs.filter((o) => !o.is_active);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      orgs = orgs.filter(
        (o) =>
          o.name.toLowerCase().includes(term) ||
          (o.display_name && o.display_name.toLowerCase().includes(term)) ||
          (o.subdomain && o.subdomain.toLowerCase().includes(term)) ||
          (o.provider_admin_name && o.provider_admin_name.toLowerCase().includes(term)) ||
          (o.provider_admin_email && o.provider_admin_email.toLowerCase().includes(term))
      );
    }

    return orgs;
  }, [viewModel.organizations, statusFilter, searchTerm]);

  const handleCreateClick = () => {
    navigate('/organizations/manage?mode=create');
  };

  return (
    <div data-testid="org-list-page">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900" data-testid="org-list-heading">
            Organizations
          </h1>
          <p className="text-gray-600 mt-1">Manage provider organizations and partnerships</p>
        </div>
        <Button
          className="flex items-center gap-2"
          onClick={handleCreateClick}
          disabled={viewModel.isLoading}
          data-testid="org-list-create-btn"
        >
          <Plus size={20} />
          Create Organization
        </Button>
      </div>

      {/* Sticky Filter + Search */}
      <div
        className="sticky top-0 z-10 bg-white/95 motion-safe:backdrop-blur-sm pb-4"
        role="search"
      >
        {/* Filter Tabs */}
        <div className="flex gap-2 mb-4" role="group" aria-label="Filter by status">
          <Button
            variant={statusFilter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleStatusFilterChange('all')}
            aria-pressed={statusFilter === 'all'}
            data-testid="org-list-filter-all"
            className={
              statusFilter === 'all'
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'hover:bg-gray-100'
            }
          >
            All ({viewModel.organizationCount})
          </Button>
          <Button
            variant={statusFilter === 'active' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleStatusFilterChange('active')}
            aria-pressed={statusFilter === 'active'}
            data-testid="org-list-filter-active"
            className={
              statusFilter === 'active'
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'hover:bg-gray-100'
            }
          >
            Active ({viewModel.activeOrganizationCount})
          </Button>
          <Button
            variant={statusFilter === 'inactive' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleStatusFilterChange('inactive')}
            aria-pressed={statusFilter === 'inactive'}
            data-testid="org-list-filter-inactive"
            className={
              statusFilter === 'inactive'
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'hover:bg-gray-100'
            }
          >
            Inactive ({viewModel.organizationCount - viewModel.activeOrganizationCount})
          </Button>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
            size={20}
          />
          <Input
            type="search"
            placeholder="Search by name, admin, or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 max-w-md"
            aria-label="Search organizations"
            data-testid="org-list-search-input"
          />
        </div>
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
            onClick={() => viewModel.loadOrganizations()}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Loading State */}
      {viewModel.isLoading && filteredOrganizations.length === 0 && (
        <div className="flex items-center justify-center py-12" data-testid="org-list-loading">
          <div className="flex items-center gap-3 text-gray-500">
            <Building2 className="w-6 h-6 animate-pulse" />
            <span>Loading organizations...</span>
          </div>
        </div>
      )}

      {/* Organization Grid */}
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        data-testid="organization-list"
      >
        {filteredOrganizations.map((org) => (
          <OrganizationCard key={org.id} organization={org} />
        ))}
      </div>

      {/* Empty State */}
      {!viewModel.isLoading && filteredOrganizations.length === 0 && (
        <div className="text-center py-12" data-testid="org-list-empty">
          {viewModel.organizationCount === 0 ? (
            <div>
              <Building2 className="w-12 h-12 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500 mb-4">No organizations created yet.</p>
              <Button onClick={handleCreateClick}>
                <Plus size={16} className="mr-2" />
                Create Your First Organization
              </Button>
            </div>
          ) : (
            <p className="text-gray-500">No organizations found matching your search.</p>
          )}
        </div>
      )}
    </div>
  );
});

export default OrganizationListPage;
