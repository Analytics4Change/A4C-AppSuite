/**
 * Organization Dashboard Page
 *
 * MVP minimal dashboard showing organization details and basic statistics.
 * This is a placeholder for future enhancements.
 *
 * MVP Scope:
 * - Organization basic information
 * - Contact details
 * - Program information
 * - Placeholder for future features
 */

import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Building,
  MapPin,
  Phone,
  Mail,
  User,
  Calendar,
  Edit,
  ArrowLeft
} from 'lucide-react';

/**
 * Organization Dashboard Component
 *
 * Minimal MVP dashboard - will be enhanced in future iterations.
 */
export const OrganizationDashboard: React.FC = () => {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();

  // TODO: Fetch organization data from API
  const mockOrganization = {
    id: orgId,
    name: 'Acme Treatment Center',
    displayName: 'Acme TC',
    subdomain: 'acme-tc',
    type: 'provider',
    timeZone: 'America/New_York',
    createdAt: new Date(),
    adminContact: {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@acme-tc.com'
    },
    billingAddress: {
      street1: '123 Main Street',
      street2: 'Suite 100',
      city: 'New York',
      state: 'NY',
      zipCode: '10001'
    },
    billingPhone: '(555) 123-4567',
    program: {
      name: 'Main Treatment Program',
      type: 'Residential Treatment'
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/organizations')}
            >
              <ArrowLeft size={16} className="mr-2" />
              Back
            </Button>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">
            {mockOrganization.name}
          </h1>
          <p className="text-gray-600 mt-1">
            Organization dashboard and configuration
          </p>
        </div>
        <Button onClick={() => navigate(`/organizations/${orgId}/edit`)}>
          <Edit size={20} className="mr-2" />
          Edit Organization
        </Button>
      </div>

      {/* Organization Information Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Basic Information */}
        <Card
          style={{
            background: 'rgba(255, 255, 255, 0.7)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
          }}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building size={20} />
              Basic Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm text-gray-500">Display Name</p>
              <p className="font-medium">{mockOrganization.displayName}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Subdomain</p>
              <p className="font-medium font-mono">
                {mockOrganization.subdomain}.a4c.app
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Type</p>
              <p className="font-medium capitalize">{mockOrganization.type}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Time Zone</p>
              <p className="font-medium">{mockOrganization.timeZone}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500 flex items-center gap-1">
                <Calendar size={14} />
                Created
              </p>
              <p className="font-medium">
                {mockOrganization.createdAt.toLocaleDateString()}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Admin Contact */}
        <Card
          style={{
            background: 'rgba(255, 255, 255, 0.7)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
          }}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User size={20} />
              Admin Contact
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm text-gray-500">Name</p>
              <p className="font-medium">
                {mockOrganization.adminContact.firstName}{' '}
                {mockOrganization.adminContact.lastName}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500 flex items-center gap-1">
                <Mail size={14} />
                Email
              </p>
              <p className="font-medium">{mockOrganization.adminContact.email}</p>
            </div>
          </CardContent>
        </Card>

        {/* Billing Address */}
        <Card
          style={{
            background: 'rgba(255, 255, 255, 0.7)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
          }}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin size={20} />
              Billing Address
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="font-medium">{mockOrganization.billingAddress.street1}</p>
            {mockOrganization.billingAddress.street2 && (
              <p className="text-gray-600">
                {mockOrganization.billingAddress.street2}
              </p>
            )}
            <p className="text-gray-600">
              {mockOrganization.billingAddress.city},{' '}
              {mockOrganization.billingAddress.state}{' '}
              {mockOrganization.billingAddress.zipCode}
            </p>
          </CardContent>
        </Card>

        {/* Billing Phone */}
        <Card
          style={{
            background: 'rgba(255, 255, 255, 0.7)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
          }}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone size={20} />
              Billing Phone
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium font-mono">{mockOrganization.billingPhone}</p>
          </CardContent>
        </Card>
      </div>

      {/* Program Information */}
      <Card
        className="mb-6"
        style={{
          background: 'rgba(255, 255, 255, 0.7)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
        }}
      >
        <CardHeader>
          <CardTitle>Program Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Program Name</p>
              <p className="font-medium">{mockOrganization.program.name}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Program Type</p>
              <p className="font-medium">{mockOrganization.program.type}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Future Features Placeholder */}
      <Card
        style={{
          background: 'rgba(239, 246, 255, 0.7)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(59, 130, 246, 0.2)',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
        }}
      >
        <CardContent className="pt-6">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              More Features Coming Soon
            </h3>
            <p className="text-gray-600">
              Future enhancements will include user management, analytics,
              integrations, and more.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
