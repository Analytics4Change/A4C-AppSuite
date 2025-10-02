import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Edit, Users, Building2 } from 'lucide-react';

export const ProviderDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  return (
    <div className="max-w-6xl mx-auto">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/providers')}
            className="hover:bg-white/50"
          >
            <ArrowLeft size={20} className="mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Provider Details</h1>
            <p className="text-gray-600 mt-1">Provider ID: {id}</p>
          </div>
        </div>
        <Button onClick={() => navigate(`/providers/${id}/edit`)}>
          <Edit size={20} className="mr-2" />
          Edit Provider
        </Button>
      </div>

      {/* Provider Information Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card
          style={{
            background: 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid',
            borderImage: 'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1',
          }}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 size={20} />
              Provider Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">Provider details will be loaded here</p>
          </CardContent>
        </Card>

        <Card
          style={{
            background: 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid',
            borderImage: 'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1',
          }}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users size={20} />
              Sub-Providers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">Sub-provider hierarchy will be displayed here</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};