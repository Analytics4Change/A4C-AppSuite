/**
 * Organization Unit Edit Page
 *
 * Form page for editing existing organizational units.
 *
 * Features:
 * - Load existing unit by ID from URL param
 * - Name and display name editing
 * - Timezone editing
 * - Active/inactive status toggle
 * - Form validation with field-level errors
 * - Submit and cancel actions
 * - Not found state handling
 *
 * Route: /organization-units/:unitId/edit
 * Permission: organization.create_ou
 */

import React, { useEffect, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  OrganizationUnitFormViewModel,
  COMMON_TIMEZONES,
} from '@/viewModels/organization/OrganizationUnitFormViewModel';
import { getOrganizationUnitService } from '@/services/organization/OrganizationUnitServiceFactory';
import {
  ArrowLeft,
  Save,
  X,
  Building2,
  ChevronDown,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { Logger } from '@/utils/logger';
import { cn } from '@/components/ui/utils';
import * as Select from '@radix-ui/react-select';
import type { OrganizationUnit } from '@/types/organization-unit.types';

const log = Logger.getLogger('component');

/**
 * Organization Unit Edit Page Component
 */
export const OrganizationUnitEditPage: React.FC = observer(() => {
  const navigate = useNavigate();
  const { unitId } = useParams<{ unitId: string }>();

  // Loading and error states
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unit, setUnit] = useState<OrganizationUnit | null>(null);

  // Form ViewModel (created after unit is loaded)
  const [formViewModel, setFormViewModel] = useState<OrganizationUnitFormViewModel | null>(
    null
  );

  // Load the unit
  useEffect(() => {
    const loadUnit = async () => {
      if (!unitId) {
        setLoadError('No unit ID provided');
        setIsLoading(false);
        return;
      }

      log.debug('Loading unit for editing', { unitId });
      setIsLoading(true);
      setLoadError(null);

      try {
        const service = getOrganizationUnitService();
        const loadedUnit = await service.getUnitById(unitId);

        if (!loadedUnit) {
          setLoadError('Unit not found');
          setIsLoading(false);
          return;
        }

        setUnit(loadedUnit);
        setFormViewModel(new OrganizationUnitFormViewModel(service, 'edit', loadedUnit));
        setIsLoading(false);
        log.debug('Unit loaded for editing', { unit: loadedUnit });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to load unit';
        setLoadError(errorMessage);
        setIsLoading(false);
        log.error('Failed to load unit', error);
      }
    };

    loadUnit();
  }, [unitId]);

  // Navigation handlers
  const handleCancel = useCallback(() => {
    navigate('/organization-units/manage');
  }, [navigate]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!formViewModel) return;

      const result = await formViewModel.submit();

      if (result.success) {
        log.info('Unit updated successfully', { unitId: result.unit?.id });
        navigate('/organization-units/manage');
      }
    },
    [formViewModel, navigate]
  );

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 p-8">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-gray-600">Loading unit...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (loadError || !unit || !formViewModel) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 p-8">
        <div className="max-w-2xl mx-auto">
          {/* Back Button */}
          <div className="mb-8">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              className="text-gray-600"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Manage
            </Button>
          </div>

          {/* Error Card */}
          <Card className="shadow-lg">
            <CardContent className="p-8">
              <div className="flex flex-col items-center text-center">
                <AlertTriangle className="w-12 h-12 text-orange-500 mb-4" />
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  {loadError === 'Unit not found'
                    ? 'Unit Not Found'
                    : 'Failed to Load Unit'}
                </h2>
                <p className="text-gray-600 mb-6">
                  {loadError === 'Unit not found'
                    ? 'The organizational unit you\'re looking for doesn\'t exist or has been removed.'
                    : loadError ?? 'An error occurred while loading the unit.'}
                </p>
                <Button onClick={handleCancel} className="bg-blue-600 hover:bg-blue-700">
                  Return to Management
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 p-8">
      <div className="max-w-2xl mx-auto">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              className="text-gray-600"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Manage
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <Building2 className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Edit Organization Unit
              </h1>
              <p className="text-gray-600 mt-1">
                Modify the details of "{unit.displayName || unit.name}"
              </p>
            </div>
          </div>
        </div>

        {/* Root Organization Warning */}
        {unit.isRootOrganization && (
          <div className="mb-6 p-4 rounded-lg border border-blue-300 bg-blue-50">
            <div className="flex items-start gap-3">
              <Building2 className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-blue-800 font-semibold">
                  Root Organization
                </h3>
                <p className="text-blue-700 text-sm mt-1">
                  This is your root organization. You can edit its name and display name,
                  but it cannot be deactivated.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Form Card */}
        <Card className="shadow-lg">
          <CardHeader className="border-b border-gray-200">
            <CardTitle className="text-xl font-semibold text-gray-900">
              Unit Details
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Submission Error */}
              {formViewModel.submissionError && (
                <div
                  className="p-4 rounded-lg border border-red-300 bg-red-50"
                  role="alert"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <h3 className="text-red-800 font-semibold">
                        Failed to update unit
                      </h3>
                      <p className="text-red-700 text-sm mt-1">
                        {formViewModel.submissionError}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => formViewModel.clearSubmissionError()}
                      className="text-red-600 hover:text-red-800"
                      aria-label="Dismiss error"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Path Display (read-only) */}
              <div>
                <Label className="block text-sm font-medium text-gray-700 mb-1">
                  Hierarchy Path
                </Label>
                <p className="text-sm text-gray-700 font-mono bg-gray-50 px-3 py-2 rounded-md border border-gray-200 break-all">
                  {unit.path}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  The position in the hierarchy cannot be changed after creation
                </p>
              </div>

              {/* Name Input */}
              <div>
                <Label htmlFor="unit-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Unit Name <span className="text-red-500">*</span>
                </Label>
                <input
                  type="text"
                  id="unit-name"
                  value={formViewModel.formData.name}
                  onChange={(e) => formViewModel.updateName(e.target.value)}
                  onBlur={() => formViewModel.touchField('name')}
                  className={cn(
                    'w-full px-3 py-2 rounded-md border shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors',
                    formViewModel.hasFieldError('name')
                      ? 'border-red-300 bg-red-50'
                      : 'border-gray-300 bg-white'
                  )}
                  placeholder="e.g., Main Campus, East Wing, Behavioral Health"
                  aria-required="true"
                  aria-invalid={formViewModel.hasFieldError('name')}
                  aria-describedby={
                    formViewModel.hasFieldError('name') ? 'name-error' : undefined
                  }
                />
                {formViewModel.hasFieldError('name') && (
                  <p id="name-error" className="text-red-600 text-sm mt-1">
                    {formViewModel.getFieldError('name')}
                  </p>
                )}
              </div>

              {/* Display Name Input */}
              <div>
                <Label
                  htmlFor="display-name"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Display Name <span className="text-red-500">*</span>
                </Label>
                <input
                  type="text"
                  id="display-name"
                  value={formViewModel.formData.displayName}
                  onChange={(e) => formViewModel.updateField('displayName', e.target.value)}
                  onBlur={() => formViewModel.touchField('displayName')}
                  className={cn(
                    'w-full px-3 py-2 rounded-md border shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors',
                    formViewModel.hasFieldError('displayName')
                      ? 'border-red-300 bg-red-50'
                      : 'border-gray-300 bg-white'
                  )}
                  placeholder="e.g., Main Campus - Building A"
                  aria-required="true"
                  aria-invalid={formViewModel.hasFieldError('displayName')}
                  aria-describedby={
                    formViewModel.hasFieldError('displayName')
                      ? 'displayName-error'
                      : undefined
                  }
                />
                {formViewModel.hasFieldError('displayName') && (
                  <p id="displayName-error" className="text-red-600 text-sm mt-1">
                    {formViewModel.getFieldError('displayName')}
                  </p>
                )}
              </div>

              {/* Timezone Dropdown */}
              <div>
                <Label htmlFor="timezone" className="block text-sm font-medium text-gray-700 mb-1">
                  Time Zone <span className="text-red-500">*</span>
                </Label>
                <Select.Root
                  value={formViewModel.formData.timeZone}
                  onValueChange={(value) => formViewModel.setTimeZone(value)}
                >
                  <Select.Trigger
                    id="timezone"
                    className={cn(
                      'w-full px-3 py-2 rounded-md border shadow-sm bg-white flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors',
                      formViewModel.hasFieldError('timeZone')
                        ? 'border-red-300 bg-red-50'
                        : 'border-gray-300'
                    )}
                    aria-label="Time Zone"
                    aria-required="true"
                    aria-invalid={formViewModel.hasFieldError('timeZone')}
                  >
                    <Select.Value>
                      {COMMON_TIMEZONES.find(
                        (tz) => tz.value === formViewModel.formData.timeZone
                      )?.label ?? formViewModel.formData.timeZone}
                    </Select.Value>
                    <Select.Icon>
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    </Select.Icon>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Content className="bg-white rounded-md shadow-lg border border-gray-200 overflow-hidden z-50">
                      <Select.Viewport className="p-1">
                        {COMMON_TIMEZONES.map((tz) => (
                          <Select.Item
                            key={tz.value}
                            value={tz.value}
                            className="px-3 py-2 cursor-pointer hover:bg-gray-100 rounded outline-none data-[highlighted]:bg-gray-100"
                          >
                            <Select.ItemText>{tz.label}</Select.ItemText>
                          </Select.Item>
                        ))}
                      </Select.Viewport>
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>
                {formViewModel.hasFieldError('timeZone') && (
                  <p className="text-red-600 text-sm mt-1">
                    {formViewModel.getFieldError('timeZone')}
                  </p>
                )}
              </div>

              {/* Active Status Toggle (not for root org) */}
              {!unit.isRootOrganization && (
                <div className="flex items-start gap-3 p-4 rounded-lg bg-gray-50 border border-gray-200">
                  <Checkbox
                    id="is-active"
                    checked={formViewModel.formData.isActive}
                    onCheckedChange={() => formViewModel.toggleActive()}
                    className="mt-0.5"
                  />
                  <div>
                    <Label
                      htmlFor="is-active"
                      className="text-sm font-medium text-gray-900 cursor-pointer"
                    >
                      Unit is Active
                    </Label>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Inactive units are hidden from most views but retain their data.
                      {unit.childCount > 0 && (
                        <span className="block text-orange-600 mt-1">
                          Note: This unit has {unit.childCount} child unit(s). Consider their status before deactivating.
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              )}

              {/* Form Actions */}
              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <div>
                  {formViewModel.isDirty && (
                    <span className="text-sm text-amber-600">
                      You have unsaved changes
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancel}
                    disabled={formViewModel.isSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={!formViewModel.canSubmit}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {formViewModel.isSubmitting ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
});

export default OrganizationUnitEditPage;
