/**
 * Organization List Page
 *
 * Displays list of organizations and saved drafts.
 * Follows ProviderListPage pattern with glassomorphic styling.
 *
 * Features:
 * - Organization grid with status filtering
 * - Saved drafts section
 * - Search functionality
 * - Create new organization button
 * - View/edit actions
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Trash2
} from 'lucide-react';
import { OrganizationService } from '@/services/organization/OrganizationService';
import type { Organization, DraftSummary } from '@/types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Organization List Page Component
 *
 * Displays organizations and drafts with filtering and search.
 */
export const OrganizationListPage: React.FC = () => {
  const navigate = useNavigate();
  const organizationService = new OrganizationService();

  // State
  const [searchTerm, setSearchTerm] = useState('');
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [organizations] = useState<Organization[]>([]); // TODO: Fetch from API

  useEffect(() => {
    log.debug('OrganizationListPage mounting');
    loadDrafts();
  }, []);

  /**
   * Load saved drafts
   */
  const loadDrafts = () => {
    const draftSummaries = organizationService.getDraftSummaries();
    setDrafts(draftSummaries);
  };

  /**
   * Handle draft deletion
   */
  const handleDeleteDraft = (draftId: string) => {
    if (confirm('Are you sure you want to delete this draft?')) {
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
      minute: '2-digit'
    });
  };

  /**
   * Filter drafts by search term
   */
  const filteredDrafts = drafts.filter(
    (draft) =>
      draft.organizationName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      draft.subdomain.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Organization Management
          </h1>
          <p className="text-gray-600 mt-1">
            Manage organizations and their configurations
          </p>
        </div>
        <Button
          className="flex items-center gap-2"
          onClick={() => navigate('/organizations/create')}
        >
          <Plus size={20} />
          Create Organization
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
          placeholder="Search organizations or drafts..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 max-w-md"
        />
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
                className="transition-all duration-300 cursor-pointer group"
                onClick={() => handleEditDraft(draft.draftId)}
                style={{
                  background: 'rgba(255, 255, 255, 0.7)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = `
                    0 0 0 1px rgba(255, 255, 255, 0.25) inset,
                    0 0 20px rgba(251, 191, 36, 0.15) inset,
                    0 12px 24px rgba(0, 0, 0, 0.08)
                  `.trim();
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.05)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="p-2 rounded-full transition-all duration-300 group-hover:scale-110"
                        style={{
                          background:
                            'linear-gradient(135deg, rgba(251, 191, 36, 0.15) 0%, rgba(251, 191, 36, 0.25) 100%)',
                          border: '1px solid rgba(251, 191, 36, 0.2)'
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
                    style={{
                      borderTop: '1px solid rgba(0, 0, 0, 0.05)'
                    }}
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
                        backdropFilter: 'blur(10px)'
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
                        backdropFilter: 'blur(10px)'
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
        <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Building size={20} />
          Organizations ({organizations.length})
        </h2>

        {/* Organizations Grid (Empty for now) */}
        {organizations.length === 0 && !searchTerm && drafts.length === 0 && (
          <div className="text-center py-16">
            <Building className="w-20 h-20 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-medium text-gray-900 mb-2">
              No Organizations Yet
            </h3>
            <p className="text-gray-500 mb-6 max-w-md mx-auto">
              Get started by creating your first organization. The bootstrap
              workflow will guide you through setting up DNS, users, and
              configuration.
            </p>
            <Button
              size="lg"
              onClick={() => navigate('/organizations/create')}
            >
              <Plus size={20} className="mr-2" />
              Create Your First Organization
            </Button>
          </div>
        )}

        {/* TODO: Add organizations grid when API integration complete */}
        {organizations.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {organizations.map((org) => (
              <Card
                key={org.id}
                className="transition-all duration-300 cursor-pointer"
                onClick={() => navigate(`/organizations/${org.id}/dashboard`)}
                style={{
                  background: 'rgba(255, 255, 255, 0.7)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
                }}
              >
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div
                      className="p-2 rounded-full"
                      style={{
                        background:
                          'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.25) 100%)',
                        border: '1px solid rgba(59, 130, 246, 0.2)'
                      }}
                    >
                      <Building className="w-5 h-5 text-blue-600" />
                    </div>
                    <CardTitle className="text-base">{org.name}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-600 mb-3 font-mono">
                    {org.subdomain}.a4c.app
                  </p>

                  <div
                    className="pt-3 flex gap-2"
                    style={{
                      borderTop: '1px solid rgba(0, 0, 0, 0.05)'
                    }}
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/organizations/${org.id}/dashboard`);
                      }}
                    >
                      <Eye size={14} className="mr-1" />
                      View
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/organizations/${org.id}/edit`);
                      }}
                    >
                      <Edit size={14} className="mr-1" />
                      Edit
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
