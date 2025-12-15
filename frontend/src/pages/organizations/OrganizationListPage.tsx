/**
 * Organization List Page
 *
 * Displays list of organizations with pagination, filtering, sorting, and search.
 * Uses OrganizationListViewModel for state management.
 *
 * Features:
 * - Paginated organization list from database
 * - Type filter (provider, partner, platform_owner)
 * - Status filter (active, inactive)
 * - Name/subdomain search with debouncing
 * - Sortable columns
 * - Saved drafts section
 * - Create new organization button
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Plus,
  Search,
  Building,
  Calendar,
  Edit,
  Eye,
  FileText,
  Trash2,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Filter,
  X,
  CheckCircle,
} from 'lucide-react';
import { OrganizationService } from '@/services/organization/OrganizationService';
import { OrganizationListViewModel, TypeFilter, StatusFilter, SortColumn } from '@/viewModels/organization/OrganizationListViewModel';
import type { Organization, DraftSummary } from '@/types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Glass card style for consistent appearance
 */
const glassCardStyle = {
  background: 'rgba(255, 255, 255, 0.7)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
};

/**
 * Type badge colors
 */
const typeBadgeColors: Record<string, { bg: string; text: string; border: string }> = {
  platform_owner: { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-200' },
  provider: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-200' },
  provider_partner: { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-200' },
};

/**
 * Type display names
 */
const typeDisplayNames: Record<string, string> = {
  platform_owner: 'Platform',
  provider: 'Provider',
  provider_partner: 'Partner',
};

/**
 * Organization Card Component
 */
const OrganizationCard: React.FC<{
  org: Organization;
  onClick: () => void;
  onView: (e: React.MouseEvent) => void;
}> = ({ org, onClick, onView }) => {
  const typeColors = typeBadgeColors[org.type] || typeBadgeColors.provider;

  return (
    <Card
      className="transition-all duration-300 cursor-pointer group hover:shadow-lg"
      onClick={onClick}
      style={glassCardStyle}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className="p-2 rounded-full transition-all duration-300 group-hover:scale-110"
              style={{
                background:
                  'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.25) 100%)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
              }}
            >
              <Building className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base truncate">{org.name}</CardTitle>
              <p className="text-xs text-gray-500 font-mono truncate">
                {org.subdomain}.firstovertheline.com
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeColors.bg} ${typeColors.text} border ${typeColors.border}`}
          >
            {typeDisplayNames[org.type] || org.type}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between mb-3">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
              org.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}
          >
            {org.is_active ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
            {org.is_active ? 'Active' : 'Inactive'}
          </span>
          <span className="text-xs text-gray-500">
            {org.created_at.toLocaleDateString()}
          </span>
        </div>

        <div
          className="pt-3 flex gap-2"
          style={{ borderTop: '1px solid rgba(0, 0, 0, 0.05)' }}
        >
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={onView}
            style={{
              background: 'rgba(255, 255, 255, 0.5)',
              backdropFilter: 'blur(10px)',
            }}
          >
            <Eye size={14} className="mr-1" />
            View
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

/**
 * Organization List Page Component
 */
export const OrganizationListPage: React.FC = observer(() => {
  const navigate = useNavigate();
  const [organizationService] = useState(() => new OrganizationService());
  const [viewModel] = useState(() => new OrganizationListViewModel());
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);

  /**
   * Load saved drafts from localStorage
   */
  const loadDrafts = useCallback(() => {
    const draftSummaries = organizationService.getDraftSummaries();
    setDrafts(draftSummaries);
  }, [organizationService]);

  // Load organizations on mount
  useEffect(() => {
    log.debug('OrganizationListPage mounting');
    viewModel.loadOrganizations();
    loadDrafts();

    return () => {
      viewModel.dispose();
    };
  }, [viewModel, loadDrafts]);

  /**
   * Handle draft deletion
   */
  const handleDeleteDraft = (draftId: string) => {
    if (globalThis.confirm('Are you sure you want to delete this draft?')) {
      organizationService.deleteDraft(draftId);
      loadDrafts();
      log.info('Draft deleted', { draftId });
    }
  };

  /**
   * Handle draft editing
   */
  const handleEditDraft = (draftId: string) => {
    navigate(`/organizations/create?draft=${draftId}`);
  };

  /**
   * Format date for display
   */
  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  /**
   * Filter drafts by search term
   */
  const filteredDrafts = drafts.filter(
    (draft) =>
      draft.organizationName.toLowerCase().includes(viewModel.searchTerm.toLowerCase()) ||
      draft.subdomain.toLowerCase().includes(viewModel.searchTerm.toLowerCase())
  );

  return (
    <div>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Organization Management</h1>
          <p className="text-gray-600 mt-1">Manage organizations and their configurations</p>
        </div>
        <Button
          className="flex items-center gap-2"
          onClick={() => navigate('/organizations/create')}
        >
          <Plus size={20} />
          Create Organization
        </Button>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        {/* Search Bar */}
        <div className="relative flex-1 max-w-md">
          <Search
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
            size={20}
          />
          <Input
            type="search"
            placeholder="Search organizations..."
            value={viewModel.searchTerm}
            onChange={(e) => viewModel.setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Type Filter */}
        <select
          value={viewModel.typeFilter}
          onChange={(e) => viewModel.setTypeFilter(e.target.value as TypeFilter)}
          className="px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
        >
          <option value="all">All Types</option>
          <option value="provider">Providers</option>
          <option value="provider_partner">Partners</option>
          <option value="platform_owner">Platform</option>
        </select>

        {/* Status Filter */}
        <select
          value={viewModel.statusFilter}
          onChange={(e) => viewModel.setStatusFilter(e.target.value as StatusFilter)}
          className="px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        {/* Sort */}
        <select
          value={`${viewModel.sortBy}-${viewModel.sortOrder}`}
          onChange={(e) => {
            const [column] = e.target.value.split('-') as [SortColumn];
            viewModel.setSortBy(column);
          }}
          className="px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
        >
          <option value="name-asc">Name (A-Z)</option>
          <option value="name-desc">Name (Z-A)</option>
          <option value="type-asc">Type (A-Z)</option>
          <option value="created_at-desc">Newest First</option>
          <option value="created_at-asc">Oldest First</option>
        </select>

        {/* Clear Filters */}
        {viewModel.hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={() => viewModel.clearFilters()}>
            <X size={16} className="mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Saved Drafts Section */}
      {drafts.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <FileText size={20} />
            Saved Drafts ({drafts.length})
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredDrafts.map((draft) => (
              <Card
                key={draft.draftId}
                className="transition-all duration-300 cursor-pointer group hover:shadow-lg"
                onClick={() => handleEditDraft(draft.draftId)}
                style={glassCardStyle}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="p-2 rounded-full transition-all duration-300 group-hover:scale-110"
                        style={{
                          background:
                            'linear-gradient(135deg, rgba(251, 191, 36, 0.15) 0%, rgba(251, 191, 36, 0.25) 100%)',
                          border: '1px solid rgba(251, 191, 36, 0.2)',
                        }}
                      >
                        <FileText className="w-5 h-5 text-yellow-600" />
                      </div>
                      <div className="flex-1">
                        <CardTitle className="text-base">
                          {draft.organizationName || 'Untitled Draft'}
                        </CardTitle>
                        <p className="text-xs text-gray-500 font-mono">
                          {draft.subdomain || 'No subdomain'}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-gray-600 flex items-center gap-2 mb-3">
                    <Calendar size={14} />
                    <span>Saved: {formatDate(draft.lastSaved)}</span>
                  </div>

                  <div
                    className="pt-3 flex gap-2"
                    style={{ borderTop: '1px solid rgba(0, 0, 0, 0.05)' }}
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditDraft(draft.draftId);
                      }}
                      style={{
                        background: 'rgba(255, 255, 255, 0.5)',
                        backdropFilter: 'blur(10px)',
                      }}
                    >
                      <Edit size={14} className="mr-1" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 border-red-300 hover:bg-red-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDraft(draft.draftId);
                      }}
                      style={{
                        background: 'rgba(255, 255, 255, 0.5)',
                        backdropFilter: 'blur(10px)',
                      }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Organizations Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Building size={20} />
            Organizations
            {!viewModel.isLoading && (
              <span className="text-sm font-normal text-gray-500">
                ({viewModel.displayRange})
              </span>
            )}
          </h2>
        </div>

        {/* Loading State */}
        {viewModel.isLoading && (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto mb-4" />
              <p className="text-gray-600">Loading organizations...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {viewModel.error && !viewModel.isLoading && (
          <Card style={glassCardStyle}>
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Failed to Load Organizations
                </h3>
                <p className="text-gray-600 mb-4">{viewModel.error}</p>
                <Button onClick={() => viewModel.loadOrganizations()}>Try Again</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Empty State */}
        {!viewModel.isLoading &&
          !viewModel.error &&
          viewModel.organizations.length === 0 &&
          !viewModel.hasActiveFilters && (
            <div className="text-center py-16">
              <Building className="w-20 h-20 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-medium text-gray-900 mb-2">No Organizations Yet</h3>
              <p className="text-gray-500 mb-6 max-w-md mx-auto">
                Get started by creating your first organization. The bootstrap workflow will guide
                you through setting up DNS, users, and configuration.
              </p>
              <Button size="lg" onClick={() => navigate('/organizations/create')}>
                <Plus size={20} className="mr-2" />
                Create Your First Organization
              </Button>
            </div>
          )}

        {/* No Results State (with filters) */}
        {!viewModel.isLoading &&
          !viewModel.error &&
          viewModel.organizations.length === 0 &&
          viewModel.hasActiveFilters && (
            <div className="text-center py-16">
              <Filter className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-medium text-gray-900 mb-2">No Matching Organizations</h3>
              <p className="text-gray-500 mb-4">
                No organizations match your current filters. Try adjusting your search criteria.
              </p>
              <Button variant="outline" onClick={() => viewModel.clearFilters()}>
                <X size={16} className="mr-2" />
                Clear Filters
              </Button>
            </div>
          )}

        {/* Organizations Grid */}
        {!viewModel.isLoading && !viewModel.error && viewModel.organizations.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {viewModel.organizations.map((org) => (
                <OrganizationCard
                  key={org.id}
                  org={org}
                  onClick={() => navigate(`/organizations/${org.id}/dashboard`)}
                  onView={(e) => {
                    e.stopPropagation();
                    navigate(`/organizations/${org.id}/dashboard`);
                  }}
                />
              ))}
            </div>

            {/* Pagination */}
            {viewModel.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-200 pt-4">
                <div className="text-sm text-gray-600">{viewModel.displayRange}</div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => viewModel.loadPreviousPage()}
                    disabled={!viewModel.hasPreviousPage}
                  >
                    <ChevronLeft size={16} className="mr-1" />
                    Previous
                  </Button>
                  <span className="text-sm text-gray-600 px-3">
                    Page {viewModel.currentPage} of {viewModel.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => viewModel.loadNextPage()}
                    disabled={!viewModel.hasNextPage}
                  >
                    Next
                    <ChevronRight size={16} className="ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});
