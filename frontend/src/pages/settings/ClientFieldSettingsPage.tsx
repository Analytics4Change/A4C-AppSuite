/**
 * Client Field Settings Page
 *
 * Settings page at /settings/client-fields for configuring which fields
 * appear on the client intake form and customizing their behavior per org.
 *
 * Access: Requires organization.update permission (enforced by RequirePermission in App.tsx).
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Settings,
  Save,
  RotateCcw,
  CheckCircle,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ClientFieldSettingsViewModel } from '@/viewModels/settings/ClientFieldSettingsViewModel';
import { ClientFieldTabBar } from './client-fields/ClientFieldTabBar';
import { FieldDefinitionTab } from './client-fields/FieldDefinitionTab';
import { CustomFieldsTab } from './client-fields/CustomFieldsTab';
import { CategoriesTab } from './client-fields/CategoriesTab';

const glassCardStyle = {
  background: 'rgba(255, 255, 255, 0.7)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
};

export const ClientFieldSettingsPage: React.FC = observer(() => {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [viewModel] = useState(() => new ClientFieldSettingsViewModel());

  const orgId = session?.claims.org_id;

  useEffect(() => {
    if (orgId) {
      viewModel.loadData(orgId);
    }
  }, [orgId, viewModel]);

  const handleSave = async () => {
    if (orgId) await viewModel.saveChanges(orgId);
  };

  // Loading state
  if (viewModel.isLoading) {
    return (
      <div className="max-w-4xl mx-auto flex items-center justify-center py-20">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-600">Loading field configuration...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (viewModel.loadError) {
    return (
      <div className="max-w-4xl mx-auto">
        <Card style={glassCardStyle}>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Failed to Load Configuration
              </h2>
              <p className="text-gray-600 mb-4">{viewModel.loadError}</p>
              <div className="flex justify-center gap-3">
                <Button variant="outline" onClick={() => navigate('/settings')}>
                  <ArrowLeft size={16} className="mr-2" />
                  Back to Settings
                </Button>
                {orgId && <Button onClick={() => viewModel.loadData(orgId)}>Try Again</Button>}
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
      <div className="max-w-4xl mx-auto">
        <Card style={glassCardStyle}>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <Settings className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">No Organization Context</h2>
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

  const activeTab = viewModel.activeTab;
  const fields = viewModel.fieldsByCategory.get(activeTab) ?? [];

  return (
    <div className="max-w-4xl mx-auto">
      {/* Page Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/settings')}
            data-testid="back-to-settings-btn"
          >
            <ArrowLeft size={16} className="mr-2" />
            Settings
          </Button>
        </div>
        <h1 className="text-3xl font-bold text-gray-900">Client Field Configuration</h1>
        <p className="text-gray-600 mt-1">
          Configure which fields appear on the client intake form and customize labels for your
          organization.
        </p>
      </div>

      {/* Tab Bar */}
      <ClientFieldTabBar
        tabs={viewModel.tabList}
        activeTab={activeTab}
        onTabChange={(slug) => viewModel.setActiveTab(slug)}
      />

      {/* Tab Content */}
      {activeTab === 'custom_fields' ? (
        <CustomFieldsTab
          viewModel={viewModel}
          fields={viewModel.fieldDefinitions}
          categories={viewModel.categories}
          orgId={orgId}
        />
      ) : activeTab === 'categories' ? (
        <CategoriesTab viewModel={viewModel} categories={viewModel.categories} orgId={orgId} />
      ) : (
        <FieldDefinitionTab
          categoryName={viewModel.categories.find((c) => c.slug === activeTab)?.name ?? activeTab}
          categorySlug={activeTab}
          fields={fields}
          isSaving={viewModel.isSaving}
          onToggleVisible={(id) => viewModel.toggleVisible(id)}
          onToggleRequired={(id) => viewModel.toggleRequired(id)}
          onSetLabel={(id, label) => viewModel.setLabel(id, label)}
        />
      )}

      {/* Save/Reset Actions — shown when there are pending toggle/label changes */}
      {viewModel.hasChanges && (
        <Card style={glassCardStyle} className="mt-4">
          <CardContent className="pt-4 space-y-4">
            {/* Reason Input */}
            <div className="space-y-2">
              <Label htmlFor="change-reason" className="text-base font-medium">
                Reason for Change
                <span className="text-red-500 ml-1" aria-hidden="true">
                  *
                </span>
              </Label>
              <textarea
                id="change-reason"
                value={viewModel.reason}
                onChange={(e) => viewModel.setReason(e.target.value)}
                placeholder="Describe why you are changing these settings (min. 10 characters)"
                aria-describedby="change-reason-hint"
                aria-required="true"
                aria-invalid={viewModel.reason.length > 0 && !viewModel.isReasonValid}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                rows={2}
                disabled={viewModel.isSaving}
                data-testid="change-reason-input"
              />
              <p id="change-reason-hint" className="text-xs text-gray-400">
                Required for audit trail. Minimum 10 characters.
                {viewModel.changedFields.length > 0 && (
                  <span className="ml-2">
                    {viewModel.changedFields.length} field
                    {viewModel.changedFields.length !== 1 ? 's' : ''} changed.
                  </span>
                )}
              </p>
              {viewModel.reason.length > 0 && !viewModel.isReasonValid && (
                <p role="alert" className="text-xs text-red-500">
                  Reason must be at least 10 characters ({viewModel.reason.trim().length}/10)
                </p>
              )}
            </div>

            {/* Save Error */}
            {viewModel.saveError && (
              <div
                role="alert"
                className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm"
              >
                <AlertCircle size={16} className="shrink-0" />
                <span>{viewModel.saveError}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              <Button
                onClick={handleSave}
                disabled={!viewModel.canSave}
                aria-disabled={!viewModel.canSave}
                data-testid="save-changes-btn"
              >
                {viewModel.isSaving ? (
                  <Loader2 size={16} className="mr-2 animate-spin" />
                ) : (
                  <Save size={16} className="mr-2" />
                )}
                Save Changes
              </Button>
              <Button
                variant="outline"
                onClick={() => viewModel.resetChanges()}
                disabled={viewModel.isSaving}
                data-testid="reset-changes-btn"
              >
                <RotateCcw size={16} className="mr-2" />
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Save Success */}
      {viewModel.saveSuccess && (
        <div
          role="status"
          className="mt-4 flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm"
          data-testid="save-success-msg"
        >
          <CheckCircle size={16} className="shrink-0" />
          <span>Configuration saved successfully.</span>
        </div>
      )}
    </div>
  );
});
