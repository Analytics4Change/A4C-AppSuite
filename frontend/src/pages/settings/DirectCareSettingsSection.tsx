/**
 * Direct Care Settings Section
 *
 * Glass card section with toggle switches for direct care feature flags.
 * Includes reason input for audit trail and save/reset controls.
 *
 * Accessibility:
 * - Each Switch has an associated <label> via htmlFor/id
 * - aria-describedby links switches to their description paragraphs
 * - Error messages use role="alert"
 * - Success messages use role="status"
 */

import React from 'react';
import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, Save, RotateCcw, CheckCircle, AlertCircle } from 'lucide-react';
import type { DirectCareSettingsViewModel } from '@/viewModels/settings/DirectCareSettingsViewModel';

const glassCardStyle = {
  background: 'rgba(255, 255, 255, 0.7)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
};

interface DirectCareSettingsSectionProps {
  viewModel: DirectCareSettingsViewModel;
}

export const DirectCareSettingsSection: React.FC<DirectCareSettingsSectionProps> = observer(
  ({ viewModel }) => {
    const handleSave = async () => {
      await viewModel.saveSettings();
    };

    return (
      <Card style={glassCardStyle}>
        <CardHeader>
          <CardTitle>Direct Care Settings</CardTitle>
          <p className="text-sm text-gray-600 mt-1">
            Configure how medication alerts and time-sensitive notifications are routed to staff members.
            These settings control Temporal workflow routing and do not affect data access policies.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Staff-Client Mapping Toggle */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="staff-client-mapping" className="text-base font-medium">
                Staff-Client Mapping
              </Label>
              <p
                id="staff-client-mapping-desc"
                className="text-sm text-gray-500"
              >
                When enabled, notifications route only to staff assigned to specific clients.
                When disabled, all staff at the organization unit receive notifications.
              </p>
            </div>
            <Switch
              id="staff-client-mapping"
              checked={viewModel.settings?.enable_staff_client_mapping ?? false}
              onCheckedChange={() => viewModel.toggleStaffClientMapping()}
              disabled={viewModel.isSaving}
              aria-describedby="staff-client-mapping-desc"
            />
          </div>

          {/* Schedule Enforcement Toggle */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="schedule-enforcement" className="text-base font-medium">
                Schedule Enforcement
              </Label>
              <p
                id="schedule-enforcement-desc"
                className="text-sm text-gray-500"
              >
                When enabled, only staff currently on schedule receive notifications.
                When disabled, any staff member can receive notifications regardless of schedule.
              </p>
            </div>
            <Switch
              id="schedule-enforcement"
              checked={viewModel.settings?.enable_schedule_enforcement ?? false}
              onCheckedChange={() => viewModel.toggleScheduleEnforcement()}
              disabled={viewModel.isSaving}
              aria-describedby="schedule-enforcement-desc"
            />
          </div>

          {/* Reason Input */}
          {viewModel.hasChanges && (
            <div className="space-y-2 border-t pt-4">
              <Label htmlFor="change-reason" className="text-base font-medium">
                Reason for Change
                <span className="text-red-500 ml-1" aria-hidden="true">*</span>
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
              />
              <p id="change-reason-hint" className="text-xs text-gray-400">
                Required for audit trail. Minimum 10 characters.
              </p>
              {viewModel.reason.length > 0 && !viewModel.isReasonValid && (
                <p role="alert" className="text-xs text-red-500">
                  Reason must be at least 10 characters ({viewModel.reason.trim().length}/10)
                </p>
              )}
            </div>
          )}

          {/* Save Error */}
          {viewModel.saveError && (
            <div role="alert" className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
              <AlertCircle size={16} className="shrink-0" />
              <span>{viewModel.saveError}</span>
            </div>
          )}

          {/* Save Success */}
          {viewModel.saveSuccess && (
            <div role="status" className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
              <CheckCircle size={16} className="shrink-0" />
              <span>Settings saved successfully.</span>
            </div>
          )}

          {/* Action Buttons */}
          {viewModel.hasChanges && (
            <div className="flex items-center gap-3 border-t pt-4">
              <Button
                onClick={handleSave}
                disabled={!viewModel.canSave}
                aria-disabled={!viewModel.canSave}
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
              >
                <RotateCcw size={16} className="mr-2" />
                Reset
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }
);
