import React from 'react';
import { observer } from 'mobx-react-lite';
import { User, Calendar, Phone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useViewModel } from '@/hooks/useViewModel';
import { ClientSelectionViewModel } from '@/viewModels/client/ClientSelectionViewModel';

interface ClientSelectorProps {
  onClientSelect: (clientId: string) => void;
}

export const ClientSelector = observer(({ onClientSelect }: ClientSelectorProps) => {
  const vm = useViewModel(ClientSelectionViewModel);

  const handleClientClick = (client: any) => {
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
            <div className="text-center py-8" data-testid="client-loading">Loading clients...</div>
          ) : vm.error ? (
            <div className="text-center py-8 text-red-600" data-testid="client-error" role="alert">{vm.error}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="clients-grid">
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
                  aria-label={`Select client ${client.firstName} ${client.lastName}`}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="p-3 bg-blue-100 rounded-full">
                        <User className="h-6 w-6 text-blue-600" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg">
                          {vm.getClientFullName(client)}
                        </h3>
                        <div className="mt-2 space-y-1 text-sm text-gray-600">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4" />
                            <span>Age: {vm.getClientAge(client)}</span>
                          </div>
                          {client.contactInfo?.phone && (
                            <div className="flex items-center gap-2">
                              <Phone className="h-4 w-4" />
                              <span>{client.contactInfo.phone}</span>
                            </div>
                          )}
                        </div>
                        {client.medicalConditions && client.medicalConditions.length > 0 && (
                          <div className="mt-3">
                            <div className="text-xs text-gray-500 mb-1">Conditions:</div>
                            <div className="flex flex-wrap gap-1">
                              {client.medicalConditions.slice(0, 2).map((condition, idx) => (
                                <span
                                  key={idx}
                                  className="px-2 py-1 bg-gray-100 text-xs rounded"
                                >
                                  {condition}
                                </span>
                              ))}
                              {client.medicalConditions.length > 2 && (
                                <span className="px-2 py-1 bg-gray-100 text-xs rounded">
                                  +{client.medicalConditions.length - 2} more
                                </span>
                              )}
                            </div>
                          </div>
                        )}
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