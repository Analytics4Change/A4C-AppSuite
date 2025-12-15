/**
 * Organization Dashboard Page
 *
 * Displays organization details with edit capability.
 * Uses OrganizationDashboardViewModel for state management.
 *
 * Features:
 * - Organization basic information (name, type, domain, status)
 * - Timezone display
 * - Edit mode for updating name, display_name, timezone
 * - Loading and error states
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Building,
  Globe,
  Clock,
  Calendar,
  Edit,
  ArrowLeft,
  Save,
  X,
  Loader2,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { OrganizationDashboardViewModel } from '@/viewModels/organization/OrganizationDashboardViewModel';

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
 * Status badge component
 */
const StatusBadge: React.FC<{ isActive: boolean }> = ({ isActive }) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm font-medium ${
      isActive
        ? 'bg-green-100 text-green-800'
        : 'bg-red-100 text-red-800'
    }`}
  >
    {isActive ? (
      <CheckCircle size={14} />
    ) : (
      <AlertCircle size={14} />
    )}
    {isActive ? 'Active' : 'Inactive'}
  </span>
);

/**
 * Organization Dashboard Component
 */
export const OrganizationDashboard: React.FC = observer(() => {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const [viewModel] = useState(() => new OrganizationDashboardViewModel());

  // Load organization on mount
  useEffect(() => {
    if (orgId) {
      viewModel.loadOrganization(orgId);
    }
  }, [orgId, viewModel]);

  // Loading state
  if (viewModel.isLoading) {
    return (
      <div className="max-w-5xl mx-auto flex items-center justify-center py-20">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-600">Loading organization...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (viewModel.loadError) {
    return (
      <div className="max-w-5xl mx-auto">
        <Card style={glassCardStyle}>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Failed to Load Organization
              </h2>
              <p className="text-gray-600 mb-4">{viewModel.loadError}</p>
              <div className="flex justify-center gap-3">
                <Button variant="outline" onClick={() => navigate('/organizations')}>
                  <ArrowLeft size={16} className="mr-2" />
                  Back to Organizations
                </Button>
                <Button onClick={() => viewModel.refresh()}>
                  Try Again
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No organization found
  if (!viewModel.organization) {
    return (
      <div className="max-w-5xl mx-auto">
        <Card style={glassCardStyle}>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <Building className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Organization Not Found
              </h2>
              <p className="text-gray-600 mb-4">
                The organization you're looking for doesn't exist or you don't have access.
              </p>
              <Button onClick={() => navigate('/organizations')}>
                <ArrowLeft size={16} className="mr-2" />
                Back to Organizations
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const org = viewModel.organization;

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
            {viewModel.isEditMode ? viewModel.editData.name : org.name}
          </h1>
          <p className="text-gray-600 mt-1">
            Organization dashboard and configuration
          </p>
        </div>
        {!viewModel.isEditMode ? (
          <Button onClick={() => viewModel.enterEditMode()}>
            <Edit size={20} className="mr-2" />
            Edit Organization
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => viewModel.cancelEdit()}
              disabled={viewModel.isSaving}
            >
              <X size={20} className="mr-2" />
              Cancel
            </Button>
            <Button
              onClick={() => viewModel.saveChanges()}
              disabled={viewModel.isSaving || !viewModel.hasChanges}
            >
              {viewModel.isSaving ? (
                <Loader2 size={20} className="mr-2 animate-spin" />
              ) : (
                <Save size={20} className="mr-2" />
              )}
              Save Changes
            </Button>
          </div>
        )}
      </div>

      {/* Save Error */}
      {viewModel.saveError && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-800">
          <AlertCircle size={20} />
          <span>{viewModel.saveError}</span>
        </div>
      )}

      {/* Organization Information Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Basic Information */}
        <Card style={glassCardStyle}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building size={20} />
              Basic Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {viewModel.isEditMode ? (
              <>
                <div>
                  <Label htmlFor="name">Organization Name</Label>
                  <Input
                    id="name"
                    value={viewModel.editData.name}
                    onChange={(e) => viewModel.updateField('name', e.target.value)}
                    className={viewModel.validationErrors.name ? 'border-red-500' : ''}
                  />
                  {viewModel.validationErrors.name && (
                    <p className="text-sm text-red-500 mt-1">{viewModel.validationErrors.name}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="display_name">Display Name</Label>
                  <Input
                    id="display_name"
                    value={viewModel.editData.display_name}
                    onChange={(e) => viewModel.updateField('display_name', e.target.value)}
                    placeholder="Optional shorter name"
                    className={viewModel.validationErrors.display_name ? 'border-red-500' : ''}
                  />
                  {viewModel.validationErrors.display_name && (
                    <p className="text-sm text-red-500 mt-1">{viewModel.validationErrors.display_name}</p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className="text-sm text-gray-500">Organization Name</p>
                  <p className="font-medium">{org.name}</p>
                </div>
                {org.display_name && (
                  <div>
                    <p className="text-sm text-gray-500">Display Name</p>
                    <p className="font-medium">{org.display_name}</p>
                  </div>
                )}
              </>
            )}
            <div>
              <p className="text-sm text-gray-500">Type</p>
              <p className="font-medium">{viewModel.typeDisplayName}</p>
            </div>
          </CardContent>
        </Card>

        {/* Domain & Status */}
        <Card style={glassCardStyle}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe size={20} />
              Domain & Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-gray-500">Subdomain</p>
              <p className="font-medium font-mono">
                {org.subdomain}.firstovertheline.com
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Status</p>
              <div className="mt-1">
                <StatusBadge isActive={org.is_active} />
              </div>
            </div>
            <div>
              <p className="text-sm text-gray-500">Path</p>
              <p className="font-medium font-mono text-sm">{org.path}</p>
            </div>
          </CardContent>
        </Card>

        {/* Timezone */}
        <Card style={glassCardStyle}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock size={20} />
              Timezone
            </CardTitle>
          </CardHeader>
          <CardContent>
            {viewModel.isEditMode ? (
              <div>
                <Label htmlFor="timezone">Timezone</Label>
                <Input
                  id="timezone"
                  value={viewModel.editData.timezone}
                  onChange={(e) => viewModel.updateField('timezone', e.target.value)}
                  placeholder="e.g., America/New_York"
                  className={viewModel.validationErrors.timezone ? 'border-red-500' : ''}
                />
                {viewModel.validationErrors.timezone && (
                  <p className="text-sm text-red-500 mt-1">{viewModel.validationErrors.timezone}</p>
                )}
              </div>
            ) : (
              <p className="font-medium">{org.time_zone}</p>
            )}
          </CardContent>
        </Card>

        {/* Timestamps */}
        <Card style={glassCardStyle}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar size={20} />
              Timestamps
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm text-gray-500">Created</p>
              <p className="font-medium">
                {org.created_at.toLocaleDateString()} {org.created_at.toLocaleTimeString()}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Last Updated</p>
              <p className="font-medium">
                {org.updated_at.toLocaleDateString()} {org.updated_at.toLocaleTimeString()}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Future Features Placeholder */}
      <Card
        style={{
          background: 'rgba(239, 246, 255, 0.7)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(59, 130, 246, 0.2)',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
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
});
