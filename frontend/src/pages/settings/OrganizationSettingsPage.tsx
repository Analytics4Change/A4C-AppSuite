/**
 * Organization Settings Page
 *
 * Dedicated settings page at /settings/organization for provider tenant admins.
 * Loads and displays direct care settings for the current organization.
 *
 * Access: Requires organization.update permission (enforced by RequirePermission in App.tsx).
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, AlertCircle, Settings } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { DirectCareSettingsViewModel } from '@/viewModels/settings/DirectCareSettingsViewModel';
import { DirectCareSettingsSection } from './DirectCareSettingsSection';

const glassCardStyle = {
  background: 'rgba(255, 255, 255, 0.7)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
};

export const OrganizationSettingsPage: React.FC = observer(() => {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [viewModel] = useState(() => new DirectCareSettingsViewModel());

  const orgId = session?.claims.org_id;

  useEffect(() => {
    if (orgId) {
      viewModel.loadSettings(orgId);
    }
  }, [orgId, viewModel]);

  // Loading state
  if (viewModel.isLoading) {
    return (
      <div className="max-w-3xl mx-auto flex items-center justify-center py-20">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-600">Loading organization settings...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (viewModel.loadError) {
    return (
      <div className="max-w-3xl mx-auto">
        <Card style={glassCardStyle}>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Failed to Load Settings
              </h2>
              <p className="text-gray-600 mb-4">{viewModel.loadError}</p>
              <div className="flex justify-center gap-3">
                <Button variant="outline" onClick={() => navigate('/settings')}>
                  <ArrowLeft size={16} className="mr-2" />
                  Back to Settings
                </Button>
                {orgId && (
                  <Button onClick={() => viewModel.loadSettings(orgId)}>
                    Try Again
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No org context
  if (!orgId) {
    return (
      <div className="max-w-3xl mx-auto">
        <Card style={glassCardStyle}>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <Settings className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                No Organization Context
              </h2>
              <p className="text-gray-600 mb-4">
                Unable to determine your organization. Please log in again.
              </p>
              <Button variant="outline" onClick={() => navigate('/settings')}>
                <ArrowLeft size={16} className="mr-2" />
                Back to Settings
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Page Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/settings')}
          >
            <ArrowLeft size={16} className="mr-2" />
            Settings
          </Button>
        </div>
        <h1 className="text-3xl font-bold text-gray-900">
          Organization Settings
        </h1>
        <p className="text-gray-600 mt-1">
          Configure organization-level settings and feature flags.
        </p>
      </div>

      {/* Direct Care Settings */}
      <DirectCareSettingsSection viewModel={viewModel} />
    </div>
  );
});
