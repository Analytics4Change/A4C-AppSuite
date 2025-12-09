/**
 * Organization Unit Create Page
 *
 * Form page for creating new organizational units.
 *
 * Features:
 * - Parent unit dropdown (defaults to selected unit from manage page)
 * - Name input with auto-generated display name
 * - Timezone dropdown with common US timezones
 * - Form validation with field-level errors
 * - Submit and cancel actions
 *
 * Route: /organization-units/create
 * Query params: ?parentId=<uuid> - pre-select parent unit
 * Permission: organization.create_ou
 */

import React, { useEffect, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  OrganizationUnitFormViewModel,
  COMMON_TIMEZONES,
} from '@/viewModels/organization/OrganizationUnitFormViewModel';
import { OrganizationUnitsViewModel } from '@/viewModels/organization/OrganizationUnitsViewModel';
import { ArrowLeft, Save, X, Building2, ChevronDown } from 'lucide-react';
import { Logger } from '@/utils/logger';
import { cn } from '@/components/ui/utils';
import * as Select from '@radix-ui/react-select';

const log = Logger.getLogger('component');

/**
 * Organization Unit Create Page Component
 */
export const OrganizationUnitCreatePage: React.FC = observer(() => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedParentId = searchParams.get('parentId');

  // ViewModel for available parents
  const [unitsViewModel] = useState(() => new OrganizationUnitsViewModel());

  // Form ViewModel
  const [formViewModel] = useState(() => new OrganizationUnitFormViewModel());

  // Load available parent units
  useEffect(() => {
    log.debug('OrganizationUnitCreatePage mounted, loading units');
    unitsViewModel.loadUnits();
  }, [unitsViewModel]);

  // Set preselected parent from URL when units are loaded
  useEffect(() => {
    if (preselectedParentId && unitsViewModel.unitCount > 0) {
      // Verify the parent exists
      const parent = unitsViewModel.getUnitById(preselectedParentId);
      if (parent && parent.isActive) {
        formViewModel.setParent(preselectedParentId);
        log.debug('Preselected parent from URL', { parentId: preselectedParentId });
      }
    }
  }, [preselectedParentId, unitsViewModel.unitCount, unitsViewModel, formViewModel]);

  // Navigation handlers
  const handleCancel = useCallback(() => {
    navigate('/organization-units/manage');
  }, [navigate]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const result = await formViewModel.submit();

      if (result.success) {
        const parentId = formViewModel.formData.parentId;
        log.info('✅ Unit created successfully', {
          unitId: result.unit?.id,
          parentId,
          navigatingWithExpand: !!parentId
        });

        // Navigate back to manage page with parent ID to auto-expand
        if (parentId) {
          const url = `/organization-units/manage?expandParent=${parentId}`;
          log.debug('Navigating to manage page with expandParent', { url, parentId });
          navigate(url);
        } else {
          log.debug('Navigating to manage page without expandParent (no parent)');
          navigate('/organization-units/manage');
        }
      }
    },
    [formViewModel, navigate]
  );

  // Get available parents (all active units)
  const availableParents = unitsViewModel.getAvailableParents();
  const selectedParent = formViewModel.formData.parentId
    ? unitsViewModel.getUnitById(formViewModel.formData.parentId)
    : null;

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
                Create Organization Unit
              </h1>
              <p className="text-gray-600 mt-1">
                Add a new department, location, or campus to your organization
              </p>
            </div>
          </div>
        </div>

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
                        Failed to create unit
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

              {/* Parent Unit Dropdown */}
              <div>
                <Label htmlFor="parent-unit" className="block text-sm font-medium text-gray-700 mb-1">
                  Parent Unit
                </Label>
                <Select.Root
                  value={formViewModel.formData.parentId ?? 'root'}
                  onValueChange={(value) =>
                    formViewModel.setParent(value === 'root' ? null : value)
                  }
                >
                  <Select.Trigger
                    id="parent-unit"
                    className="w-full px-3 py-2 rounded-md border border-gray-300 shadow-sm bg-white flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                    aria-label="Parent Unit"
                  >
                    <Select.Value>
                      {selectedParent
                        ? selectedParent.displayName || selectedParent.name
                        : 'Root Organization (direct child)'}
                    </Select.Value>
                    <Select.Icon>
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    </Select.Icon>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Content className="bg-white rounded-md shadow-lg border border-gray-200 overflow-hidden z-50 max-h-[300px]">
                      <Select.Viewport className="p-1">
                        <Select.Item
                          value="root"
                          className="px-3 py-2 cursor-pointer hover:bg-gray-100 rounded outline-none data-[highlighted]:bg-gray-100"
                        >
                          <Select.ItemText>
                            Root Organization (direct child)
                          </Select.ItemText>
                        </Select.Item>
                        {availableParents.map((unit) => (
                          <Select.Item
                            key={unit.id}
                            value={unit.id}
                            className="px-3 py-2 cursor-pointer hover:bg-gray-100 rounded outline-none data-[highlighted]:bg-gray-100"
                          >
                            <Select.ItemText>
                              <span
                                className="inline-block"
                                style={{
                                  marginLeft: `${(unit.path.split('.').length - 3) * 12}px`,
                                }}
                              >
                                {unit.displayName || unit.name}
                              </span>
                            </Select.ItemText>
                          </Select.Item>
                        ))}
                      </Select.Viewport>
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>
                <p className="text-xs text-gray-500 mt-1">
                  Select where this unit will be placed in the hierarchy
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
                <p className="text-xs text-gray-500 mt-1">
                  Used for system identification. Letters, numbers, spaces, hyphens, underscores only.
                </p>
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
                <p className="text-xs text-gray-500 mt-1">
                  Human-readable name shown in the UI
                </p>
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

              {/* Form Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
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
                  {formViewModel.isSubmitting ? 'Creating...' : 'Create Unit'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
});

export default OrganizationUnitCreatePage;
