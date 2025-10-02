import React, { useEffect, useState } from 'react';
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
  DollarSign,
  Edit,
  Eye,
  MoreVertical
} from 'lucide-react';
import { ProviderListViewModel } from '@/viewModels/providers/ProviderListViewModel';
import { Provider } from '@/types/provider.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

export const ProviderListPage: React.FC = observer(() => {
  const navigate = useNavigate();
  const [viewModel] = useState(() => new ProviderListViewModel());
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    log.debug('ProviderListPage mounting');
    return () => {
      viewModel.dispose();
    };
  }, [viewModel]);

  const handleSearch = (value: string) => {
    setSearchTerm(value);
    viewModel.setSearchTerm(value);
  };

  const handleProviderClick = (providerId: string) => {
    navigate(`/providers/${providerId}/view`);
  };

  const handleEditProvider = (e: React.MouseEvent, providerId: string) => {
    e.stopPropagation();
    navigate(`/providers/${providerId}/edit`);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'text-green-600 bg-green-100';
      case 'pending':
        return 'text-yellow-600 bg-yellow-100';
      case 'suspended':
        return 'text-orange-600 bg-orange-100';
      case 'inactive':
        return 'text-gray-600 bg-gray-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const formatDate = (date: Date | string) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString();
  };

  return (
    <div>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Provider Management</h1>
          <p className="text-gray-600 mt-1">Manage tenant organizations and their settings</p>
        </div>
        <Button
          className="flex items-center gap-2"
          onClick={() => navigate('/providers/create')}
        >
          <Plus size={20} />
          Add New Provider
        </Button>
      </div>

      {/* Status Filters */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {['all', 'active', 'pending', 'suspended', 'inactive'].map(status => (
          <button
            key={status}
            onClick={() => viewModel.setStatusFilter(status)}
            className={`px-4 py-2 rounded-lg transition-all ${
              viewModel.selectedStatus === status
                ? 'bg-blue-500 text-white'
                : 'bg-white/70 backdrop-blur-md hover:bg-white/90'
            }`}
            style={{
              border: '1px solid rgba(255, 255, 255, 0.3)',
              boxShadow: viewModel.selectedStatus === status
                ? '0 4px 12px rgba(59, 130, 246, 0.3)'
                : '0 2px 4px rgba(0, 0, 0, 0.05)'
            }}
          >
            <span className="capitalize">{status}</span>
            <span className="ml-2">({viewModel.providerCountByStatus[status] || 0})</span>
          </button>
        ))}
      </div>

      {/* Search Bar */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
        <Input
          type="search"
          placeholder="Search by name or email..."
          value={searchTerm}
          onChange={(e) => handleSearch(e.target.value)}
          className="pl-10 max-w-md"
        />
      </div>

      {/* Error Display */}
      {viewModel.error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {viewModel.error}
        </div>
      )}

      {/* Loading State */}
      {viewModel.isLoading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      ) : (
        /* Provider Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {viewModel.filteredProviders.map((provider: Provider) => (
            <Card
              key={provider.id}
              className="glass-card hover:glass-card-hover transition-all duration-300 cursor-pointer group"
              onClick={() => handleProviderClick(provider.id)}
              style={{
                background: 'rgba(255, 255, 255, 0.7)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid',
                borderImage: 'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1',
                boxShadow: `
                  0 0 0 1px rgba(255, 255, 255, 0.18) inset,
                  0 2px 4px rgba(0, 0, 0, 0.04),
                  0 4px 8px rgba(0, 0, 0, 0.04),
                  0 8px 16px rgba(0, 0, 0, 0.04)
                `.trim(),
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = `
                  0 0 0 1px rgba(255, 255, 255, 0.25) inset,
                  0 0 20px rgba(59, 130, 246, 0.15) inset,
                  0 2px 4px rgba(0, 0, 0, 0.05),
                  0 4px 8px rgba(0, 0, 0, 0.05),
                  0 12px 24px rgba(0, 0, 0, 0.08),
                  0 24px 48px rgba(59, 130, 246, 0.1)
                `.trim();
                e.currentTarget.style.borderImage = 'linear-gradient(135deg, rgba(255,255,255,0.7) 0%, rgba(59,130,246,0.3) 50%, rgba(255,255,255,0.7) 100%) 1';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = `
                  0 0 0 1px rgba(255, 255, 255, 0.18) inset,
                  0 2px 4px rgba(0, 0, 0, 0.04),
                  0 4px 8px rgba(0, 0, 0, 0.04),
                  0 8px 16px rgba(0, 0, 0, 0.04)
                `.trim();
                e.currentTarget.style.borderImage = 'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="p-2 rounded-full transition-all duration-300 group-hover:scale-110"
                      style={{
                        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.25) 100%)',
                        backdropFilter: 'blur(10px)',
                        WebkitBackdropFilter: 'blur(10px)',
                        border: '1px solid rgba(59, 130, 246, 0.2)',
                        boxShadow: '0 0 15px rgba(59, 130, 246, 0.15) inset'
                      }}
                    >
                      <Building className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-lg">{provider.name}</CardTitle>
                      <p className="text-sm text-gray-500 capitalize">{provider.type}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(provider.status)}`}>
                      {provider.status}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Add dropdown menu here
                      }}
                    >
                      <MoreVertical size={16} />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Calendar size={16} />
                    <span>Created: {formatDate(provider.createdAt)}</span>
                  </div>
                  {provider.primaryContactEmail && (
                    <div className="text-gray-600 truncate">
                      Contact: {provider.primaryContactEmail}
                    </div>
                  )}
                  {provider.subscriptionTierId && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <DollarSign size={16} />
                      <span>Subscription Active</span>
                    </div>
                  )}
                </div>

                <div
                  className="mt-4 pt-4 flex gap-2"
                  style={{
                    borderTop: '1px solid',
                    borderImage: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%) 1'
                  }}
                >
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 transition-all duration-300 hover:shadow-md"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/providers/${provider.id}/view`);
                    }}
                    style={{
                      background: 'rgba(255, 255, 255, 0.5)',
                      backdropFilter: 'blur(10px)',
                      WebkitBackdropFilter: 'blur(10px)',
                    }}
                  >
                    <Eye size={16} className="mr-1" />
                    View
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 transition-all duration-300 hover:shadow-md"
                    onClick={(e) => handleEditProvider(e, provider.id)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.5)',
                      backdropFilter: 'blur(10px)',
                      WebkitBackdropFilter: 'blur(10px)',
                    }}
                  >
                    <Edit size={16} className="mr-1" />
                    Edit
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!viewModel.isLoading && viewModel.filteredProviders.length === 0 && (
        <div className="text-center py-12">
          <Building className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No providers found</h3>
          <p className="text-gray-500 mb-4">
            {searchTerm ? 'Try adjusting your search or filters' : 'Get started by creating your first provider'}
          </p>
          {!searchTerm && (
            <Button onClick={() => navigate('/providers/create')}>
              <Plus size={20} className="mr-2" />
              Create Provider
            </Button>
          )}
        </div>
      )}
    </div>
  );
});