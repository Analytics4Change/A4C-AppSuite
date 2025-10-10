import React from 'react';
import { useParams, Outlet, NavLink, useNavigate } from 'react-router-dom';
import { mockClients } from '@/mocks/data/clients.mock';
import { Button } from '@/components/ui/button';
import { ArrowLeft, User, Calendar, FileText } from 'lucide-react';

export const ClientDetailLayout: React.FC = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  
  const client = mockClients.find(c => c.id === clientId);
  
  if (!client) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 mb-4">Client not found</p>
        <Button onClick={() => navigate('/clients')}>
          Back to Clients
        </Button>
      </div>
    );
  }

  const tabs = [
    { path: `/clients/${clientId}`, label: 'Overview', exact: true },
    { path: `/clients/${clientId}/medications`, label: 'Medications' },
    { path: `/clients/${clientId}/history`, label: 'History' },
    { path: `/clients/${clientId}/documents`, label: 'Documents' },
  ];

  return (
    <div>
      {/* Back Button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate('/clients')}
        className="mb-4"
      >
        <ArrowLeft size={16} className="mr-2" />
        Back to Clients
      </Button>

      {/* Client Header */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 rounded-full">
              <User className="w-8 h-8 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{`${client.firstName} ${client.lastName}`}</h1>
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                <span>ID: {client.id}</span>
                <span className="flex items-center gap-1">
                  <Calendar size={14} />
                  DOB: {new Date(client.dateOfBirth).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-8">
          {tabs.map(tab => (
            <NavLink
              key={tab.path}
              to={tab.path}
              end={tab.exact}
              className={({ isActive }) => `
                py-2 px-1 border-b-2 font-medium text-sm transition-colors
                ${isActive
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }
              `}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Content */}
      <Outlet context={{ client }} />
    </div>
  );
};