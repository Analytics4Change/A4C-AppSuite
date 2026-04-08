import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { makeAutoObservable, runInAction } from 'mobx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search, User, Calendar, Shield, Loader2 } from 'lucide-react';
import { getClientService } from '@/services/clients';
import type { IClientService } from '@/services/clients';
import type { ClientListItem, ClientStatus } from '@/types/client.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

// ---------------------------------------------------------------------------
// Lightweight ViewModel (page-local, not worth a separate file)
// ---------------------------------------------------------------------------

class ClientListViewModel {
  clients: ClientListItem[] = [];
  isLoading = false;
  error: string | null = null;

  constructor(private service: IClientService) {
    makeAutoObservable(this);
  }

  async loadClients(status?: string, searchTerm?: string) {
    this.isLoading = true;
    this.error = null;
    try {
      const result = await this.service.listClients(status, searchTerm);
      runInAction(() => {
        this.clients = result;
      });
    } catch (e) {
      log.error('Failed to load clients', { error: e });
      runInAction(() => {
        this.error = 'Failed to load clients';
      });
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Status filter tabs
// ---------------------------------------------------------------------------

type StatusFilter = 'all' | ClientStatus;

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'discharged', label: 'Discharged' },
  { value: 'inactive', label: 'Inactive' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

function clientDisplayName(c: ClientListItem): string {
  if (c.preferred_name) return `${c.preferred_name} (${c.first_name}) ${c.last_name}`;
  return `${c.first_name} ${c.last_name}`;
}

function statusBadge(status: ClientStatus) {
  const styles: Record<ClientStatus, string> = {
    active: 'bg-green-100 text-green-800',
    discharged: 'bg-amber-100 text-amber-800',
    inactive: 'bg-gray-100 text-gray-600',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}
      data-testid="client-status-badge"
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export const ClientListPage: React.FC = observer(() => {
  const navigate = useNavigate();
  const vm = useMemo(() => new ClientListViewModel(getClientService()), []);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const searchTermRef = React.useRef(searchTerm);
  searchTermRef.current = searchTerm;

  // Load clients on mount and when filter changes
  useEffect(() => {
    const status = statusFilter === 'all' ? undefined : statusFilter;
    vm.loadClients(status, searchTermRef.current || undefined);
  }, [vm, statusFilter]);

  // Debounced search
  const searchTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchTerm(value);
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = setTimeout(() => {
        const status = statusFilter === 'all' ? undefined : statusFilter;
        vm.loadClients(status, value || undefined);
      }, 300);
    },
    [vm, statusFilter]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => clearTimeout(searchTimeoutRef.current);
  }, []);

  const handleClientClick = (clientId: string) => {
    navigate(`/clients/${clientId}`);
  };

  return (
    <div>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Clients</h1>
          <p className="text-gray-600 mt-1">Manage client records and intake</p>
        </div>
        <Button
          className="flex items-center gap-2"
          onClick={() => navigate('/clients/register')}
          data-testid="register-client-btn"
        >
          <Plus size={20} />
          Register New Client
        </Button>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex gap-1 mb-4" role="tablist" aria-label="Client status filter">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            role="tab"
            aria-selected={statusFilter === tab.value}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              statusFilter === tab.value
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
            onClick={() => setStatusFilter(tab.value)}
            data-testid={`status-tab-${tab.value}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search Bar */}
      <div className="relative mb-6">
        <Search
          className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
          size={20}
        />
        <Input
          type="search"
          placeholder="Search by name, MRN, or external ID..."
          value={searchTerm}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-10 max-w-md"
          data-testid="client-search-input"
          aria-label="Search clients"
        />
      </div>

      {/* Loading State */}
      {vm.isLoading && (
        <div className="flex items-center justify-center py-12" data-testid="client-list-loading">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500 mr-2" />
          <span className="text-gray-500">Loading clients...</span>
        </div>
      )}

      {/* Error State */}
      {vm.error && !vm.isLoading && (
        <div
          className="text-center py-12 text-red-600"
          role="alert"
          data-testid="client-list-error"
        >
          <p>{vm.error}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => {
              const status = statusFilter === 'all' ? undefined : statusFilter;
              vm.loadClients(status, searchTerm || undefined);
            }}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Client Grid */}
      {!vm.isLoading && !vm.error && (
        <>
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            data-testid="client-grid"
          >
            {vm.clients.map((client) => (
              <Card
                key={client.id}
                className="glass-card hover:glass-card-hover transition-all duration-300 cursor-pointer group"
                onClick={() => handleClientClick(client.id)}
                data-testid={`client-card-${client.id}`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleClientClick(client.id);
                  }
                }}
                aria-label={`View client ${client.first_name} ${client.last_name}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-blue-50 group-hover:bg-blue-100 transition-colors">
                        <User className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{clientDisplayName(client)}</CardTitle>
                        {client.mrn && (
                          <p className="text-xs text-gray-500 mt-0.5">MRN: {client.mrn}</p>
                        )}
                      </div>
                    </div>
                    {statusBadge(client.status)}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex items-center gap-2 text-gray-600">
                      <Calendar size={14} />
                      <span>DOB: {formatDate(client.date_of_birth)}</span>
                    </div>
                    {client.admission_date && (
                      <div className="flex items-center gap-2 text-gray-600">
                        <Calendar size={14} />
                        <span>Admitted: {formatDate(client.admission_date)}</span>
                      </div>
                    )}
                    {client.initial_risk_level && (
                      <div className="flex items-center gap-2 text-gray-600">
                        <Shield size={14} />
                        <span className="capitalize">
                          Risk: {client.initial_risk_level.replace(/_/g, ' ')}
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {vm.clients.length === 0 && (
            <div className="text-center py-12" data-testid="client-list-empty">
              <User className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 mb-2">No clients found</p>
              <p className="text-sm text-gray-400">
                {searchTerm
                  ? 'Try adjusting your search terms.'
                  : 'Register a new client to get started.'}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
});
