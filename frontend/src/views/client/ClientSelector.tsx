import React from 'react';
import { observer } from 'mobx-react-lite';
import { User, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useViewModel } from '@/hooks/useViewModel';
import { ClientSelectionViewModel } from '@/viewModels/client/ClientSelectionViewModel';
import type { ClientListItem } from '@/types/client.types';

interface ClientSelectorProps {
  onClientSelect: (clientId: string) => void;
}

export const ClientSelector = observer(({ onClientSelect }: ClientSelectorProps) => {
  const vm = useViewModel(ClientSelectionViewModel);

  const handleClientClick = (client: ClientListItem) => {
    vm.selectClient(client);
    onClientSelect(client.id);
  };

  return (
    <div className="max-w-6xl mx-auto p-6" data-testid="client-selector-container">
      <Card data-testid="client-selector-card">
        <CardHeader>
          <CardTitle className="text-2xl">Select a Client</CardTitle>
          <div className="mt-4">
            <Input
              type="text"
              placeholder="Search clients by name..."
              value={vm.searchQuery}
              onChange={(e) => vm.searchClients(e.target.value)}
              className="max-w-md"
              data-testid="client-search-input"
              aria-label="Search clients"
              id="client-search"
            />
          </div>
        </CardHeader>
        <CardContent>
          {vm.isLoading ? (
            <div className="text-center py-8" data-testid="client-loading">
              Loading clients...
            </div>
          ) : vm.error ? (
            <div className="text-center py-8 text-red-600" data-testid="client-error" role="alert">
              {vm.error}
            </div>
          ) : (
            <div
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
              data-testid="clients-grid"
            >
              {(vm.clients || []).map((client, index) => (
                <Card
                  key={client.id}
                  className="cursor-pointer hover:shadow-lg transition-shadow min-h-[44px]"
                  onClick={() => handleClientClick(client)}
                  data-testid={`client-card-${index}`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleClientClick(client);
                    }
                  }}
                  aria-label={`Select client ${client.first_name} ${client.last_name}`}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="p-3 bg-blue-100 rounded-full">
                        <User className="h-6 w-6 text-blue-600" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg">{vm.getClientFullName(client)}</h3>
                        <div className="mt-2 space-y-1 text-sm text-gray-600">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4" />
                            <span>Age: {vm.getClientAge(client)}</span>
                          </div>
                          {client.mrn && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400">MRN: {client.mrn}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
});
