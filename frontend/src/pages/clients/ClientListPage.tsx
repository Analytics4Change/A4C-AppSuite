import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search, User, Calendar, Pill } from 'lucide-react';
import { mockClients } from '@/mocks/data/clients.mock';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

export const ClientListPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');

  log.debug('ClientListPage rendering', { 
    clientCount: mockClients.length,
    searchTerm 
  });

  const filteredClients = mockClients.filter(client => {
    const fullName = `${client.firstName} ${client.lastName}`;
    return fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      client.id.includes(searchTerm);
  });

  const handleClientClick = (clientId: string) => {
    navigate(`/clients/${clientId}`);
  };

  const handleAddMedication = (e: React.MouseEvent, clientId: string) => {
    e.stopPropagation();
    navigate(`/clients/${clientId}/medications/add`);
  };

  return (
    <div>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Clients</h1>
          <p className="text-gray-600 mt-1">Manage client information and medications</p>
        </div>
        <Button className="flex items-center gap-2">
          <Plus size={20} />
          Add New Client
        </Button>
      </div>

      {/* Search Bar */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
        <Input
          type="search"
          placeholder="Search by name or ID..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 max-w-md"
        />
      </div>

      {/* Client Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredClients.map(client => (
          <Card
            key={client.id}
            className="glass-card hover:glass-card-hover transition-all duration-300 cursor-pointer group"
            onClick={() => handleClientClick(client.id)}
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
                  <div className="p-2 rounded-full transition-all duration-300 group-hover:scale-110"
                    style={{
                      background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.25) 100%)',
                      backdropFilter: 'blur(10px)',
                      WebkitBackdropFilter: 'blur(10px)',
                      border: '1px solid rgba(59, 130, 246, 0.2)',
                      boxShadow: '0 0 15px rgba(59, 130, 246, 0.15) inset'
                    }}>
                    <User className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{`${client.firstName} ${client.lastName}`}</CardTitle>
                    <p className="text-sm text-gray-500">ID: {client.id}</p>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-gray-600">
                  <Calendar size={16} />
                  <span>DOB: {new Date(client.dateOfBirth).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <Pill size={16} />
                  <span>Active Medications: {client.medications?.length || 0}</span>
                </div>
              </div>
              
              <div className="mt-4 pt-4" style={{
                borderTop: '1px solid',
                borderImage: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%) 1'
              }}>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full transition-all duration-300 hover:shadow-md"
                  onClick={(e) => handleAddMedication(e, client.id)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.5)',
                    backdropFilter: 'blur(10px)',
                    WebkitBackdropFilter: 'blur(10px)',
                    border: '1px solid rgba(255, 255, 255, 0.3)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)';
                    e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.5)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                  }}
                >
                  <Plus size={16} className="mr-2" />
                  Add Medication
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredClients.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500">No clients found matching your search.</p>
        </div>
      )}
    </div>
  );
};