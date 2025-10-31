/**
 * Organization Create Page
 *
 * MVP implementation of organization creation form with inline fields.
 * Uses OrganizationFormViewModel for state management and auto-save to localStorage.
 *
 * MVP Scope:
 * - Single A4C Admin contact (inline)
 * - Single billing address (inline)
 * - Single billing phone (inline)
 * - Single program (inline)
 * - No modals, all inline editing
 *
 * Features:
 * - Auto-save drafts to localStorage
 * - Form validation with field-level errors
 * - Event-driven workflow submission
 * - Glassomorphic UI styling
 * - Full keyboard navigation
 */

import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneInput } from '@/components/organization/PhoneInput';
import { SubdomainInput } from '@/components/organization/SubdomainInput';
import { SelectDropdown } from '@/components/organization/SelectDropdown';
import { OrganizationFormViewModel } from '@/viewModels/organization/OrganizationFormViewModel';
import {
  US_TIME_ZONES,
  ORGANIZATION_TYPES,
  PROGRAM_TYPES,
  US_STATES
} from '@/constants';
import { Save, Send, ChevronDown, ChevronUp } from 'lucide-react';
import { Logger } from '@/utils/logger';
import { useAuth } from '@/contexts/AuthContext';

const log = Logger.getLogger('component');

/**
 * Organization Create Page Component
 *
 * Full-featured organization creation form with MVP inline fields.
 */
export const OrganizationCreatePage: React.FC = observer(() => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [viewModel] = useState(() => new OrganizationFormViewModel());
  const [autoSaveTimer, setAutoSaveTimer] = useState<NodeJS.Timeout | null>(null);

  // Collapsible sections state
  const [sectionsExpanded, setSectionsExpanded] = useState({
    orgInfo: true,
    adminContact: true,
    billingAddress: true,
    billingPhone: true,
    program: true
  });

  useEffect(() => {
    log.debug('OrganizationCreatePage mounting');

    return () => {
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
      }
    };
  }, [autoSaveTimer]);

  /**
   * Permission verification - Redirect if user lacks organization.create_root
   */
  useEffect(() => {
    const verifyAccess = async () => {
      const allowed = await hasPermission('organization.create_root');
      if (!allowed) {
        log.error('[OrganizationCreatePage] Access denied: organization.create_root required');
        navigate('/clients', { replace: true });
      }
    };

    verifyAccess();
  }, [hasPermission, navigate]);

  /**
   * Debounced auto-save
   */
  const handleFieldChange = (field: string, value: any) => {
    viewModel.updateNestedField(field, value);

    // Debounce auto-save
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }

    const timer = setTimeout(() => {
      viewModel.autoSaveDraft();
    }, 500);

    setAutoSaveTimer(timer);
  };

  /**
   * Toggle section expansion
   */
  const toggleSection = (section: keyof typeof sectionsExpanded) => {
    setSectionsExpanded((prev) => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  /**
   * Handle form submission
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const workflowId = await viewModel.submit();

    if (workflowId) {
      log.info('Organization creation workflow started', { workflowId });
      navigate(`/organizations/bootstrap/${workflowId}`);
    }
  };

  /**
   * Save draft and return to list
   */
  const handleSaveDraft = () => {
    viewModel.saveDraft();
    navigate('/organizations');
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Page Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Create Organization</h1>
          <p className="text-gray-600 mt-1">
            Set up a new provider organization with billing and contact information
          </p>
        </div>
        {viewModel.lastSavedAt && (
          <span className="text-sm text-gray-500">
            Last saved: {viewModel.lastSavedAt.toLocaleTimeString()}
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        {/* Organization Information Section */}
        <Card
          className="mb-6 transition-all duration-300"
          style={{
            background: 'rgba(255, 255, 255, 0.7)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
          }}
        >
          <CardHeader
            className="cursor-pointer"
            onClick={() => toggleSection('orgInfo')}
          >
            <div className="flex items-center justify-between">
              <CardTitle>Organization Information</CardTitle>
              {sectionsExpanded.orgInfo ? (
                <ChevronUp size={20} />
              ) : (
                <ChevronDown size={20} />
              )}
            </div>
          </CardHeader>

          {sectionsExpanded.orgInfo && (
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Organization Type */}
                <SelectDropdown
                  id="org-type"
                  label="Organization Type"
                  value={viewModel.formData.type}
                  options={ORGANIZATION_TYPES}
                  onChange={(value) => handleFieldChange('type', value)}
                  error={viewModel.getFieldError('type')}
                  required
                  tabIndex={1}
                />

                {/* Time Zone */}
                <SelectDropdown
                  id="time-zone"
                  label="Time Zone"
                  value={viewModel.formData.timeZone}
                  options={US_TIME_ZONES}
                  onChange={(value) => handleFieldChange('timeZone', value)}
                  error={viewModel.getFieldError('timeZone')}
                  required
                  tabIndex={2}
                />
              </div>

              {/* Organization Name */}
              <div className="space-y-2">
                <Label htmlFor="org-name">
                  Organization Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="org-name"
                  value={viewModel.formData.name}
                  onChange={(e) => handleFieldChange('name', e.target.value)}
                  placeholder="Acme Treatment Center"
                  tabIndex={3}
                  aria-required="true"
                  aria-invalid={viewModel.hasFieldError('name')}
                />
                {viewModel.getFieldError('name') && (
                  <p className="text-sm text-red-500">
                    {viewModel.getFieldError('name')}
                  </p>
                )}
              </div>

              {/* Display Name */}
              <div className="space-y-2">
                <Label htmlFor="display-name">
                  Display Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="display-name"
                  value={viewModel.formData.displayName}
                  onChange={(e) => handleFieldChange('displayName', e.target.value)}
                  placeholder="Acme TC"
                  tabIndex={4}
                  aria-required="true"
                  aria-invalid={viewModel.hasFieldError('displayName')}
                />
                {viewModel.getFieldError('displayName') && (
                  <p className="text-sm text-red-500">
                    {viewModel.getFieldError('displayName')}
                  </p>
                )}
              </div>

              {/* Subdomain */}
              <SubdomainInput
                id="subdomain"
                label="Subdomain"
                value={viewModel.formData.subdomain}
                onChange={(value) => viewModel.updateSubdomain(value)}
                error={viewModel.getFieldError('subdomain')}
                required
                tabIndex={5}
              />
            </CardContent>
          )}
        </Card>

        {/* A4C Admin Contact Section */}
        <Card
          className="mb-6 transition-all duration-300"
          style={{
            background: 'rgba(255, 255, 255, 0.7)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
          }}
        >
          <CardHeader
            className="cursor-pointer"
            onClick={() => toggleSection('adminContact')}
          >
            <div className="flex items-center justify-between">
              <CardTitle>A4C Admin Contact</CardTitle>
              {sectionsExpanded.adminContact ? (
                <ChevronUp size={20} />
              ) : (
                <ChevronDown size={20} />
              )}
            </div>
          </CardHeader>

          {sectionsExpanded.adminContact && (
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* First Name */}
                <div className="space-y-2">
                  <Label htmlFor="admin-first-name">
                    First Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="admin-first-name"
                    value={viewModel.formData.adminContact.firstName}
                    onChange={(e) =>
                      handleFieldChange('adminContact.firstName', e.target.value)
                    }
                    tabIndex={6}
                    aria-required="true"
                  />
                  {viewModel.getFieldError('adminContact.firstName') && (
                    <p className="text-sm text-red-500">
                      {viewModel.getFieldError('adminContact.firstName')}
                    </p>
                  )}
                </div>

                {/* Last Name */}
                <div className="space-y-2">
                  <Label htmlFor="admin-last-name">
                    Last Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="admin-last-name"
                    value={viewModel.formData.adminContact.lastName}
                    onChange={(e) =>
                      handleFieldChange('adminContact.lastName', e.target.value)
                    }
                    tabIndex={7}
                    aria-required="true"
                  />
                  {viewModel.getFieldError('adminContact.lastName') && (
                    <p className="text-sm text-red-500">
                      {viewModel.getFieldError('adminContact.lastName')}
                    </p>
                  )}
                </div>
              </div>

              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="admin-email">
                  Email <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="admin-email"
                  type="email"
                  value={viewModel.formData.adminContact.email}
                  onChange={(e) =>
                    handleFieldChange('adminContact.email', e.target.value)
                  }
                  placeholder="admin@example.com"
                  tabIndex={8}
                  aria-required="true"
                />
                {viewModel.getFieldError('adminContact.email') && (
                  <p className="text-sm text-red-500">
                    {viewModel.getFieldError('adminContact.email')}
                  </p>
                )}
                <p className="text-sm text-gray-500">
                  This email will receive the invitation to set up the organization
                </p>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Billing Address Section */}
        <Card
          className="mb-6 transition-all duration-300"
          style={{
            background: 'rgba(255, 255, 255, 0.7)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
          }}
        >
          <CardHeader
            className="cursor-pointer"
            onClick={() => toggleSection('billingAddress')}
          >
            <div className="flex items-center justify-between">
              <CardTitle>Billing Address</CardTitle>
              {sectionsExpanded.billingAddress ? (
                <ChevronUp size={20} />
              ) : (
                <ChevronDown size={20} />
              )}
            </div>
          </CardHeader>

          {sectionsExpanded.billingAddress && (
            <CardContent className="space-y-4">
              {/* Street Address 1 */}
              <div className="space-y-2">
                <Label htmlFor="street1">
                  Street Address <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="street1"
                  value={viewModel.formData.billingAddress.street1}
                  onChange={(e) =>
                    handleFieldChange('billingAddress.street1', e.target.value)
                  }
                  placeholder="123 Main Street"
                  tabIndex={9}
                  aria-required="true"
                />
                {viewModel.getFieldError('billingAddress.street1') && (
                  <p className="text-sm text-red-500">
                    {viewModel.getFieldError('billingAddress.street1')}
                  </p>
                )}
              </div>

              {/* Street Address 2 */}
              <div className="space-y-2">
                <Label htmlFor="street2">Street Address 2 (Optional)</Label>
                <Input
                  id="street2"
                  value={viewModel.formData.billingAddress.street2}
                  onChange={(e) =>
                    handleFieldChange('billingAddress.street2', e.target.value)
                  }
                  placeholder="Suite 100"
                  tabIndex={10}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* City */}
                <div className="space-y-2">
                  <Label htmlFor="city">
                    City <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="city"
                    value={viewModel.formData.billingAddress.city}
                    onChange={(e) =>
                      handleFieldChange('billingAddress.city', e.target.value)
                    }
                    tabIndex={11}
                    aria-required="true"
                  />
                  {viewModel.getFieldError('billingAddress.city') && (
                    <p className="text-sm text-red-500">
                      {viewModel.getFieldError('billingAddress.city')}
                    </p>
                  )}
                </div>

                {/* State */}
                <SelectDropdown
                  id="state"
                  label="State"
                  value={viewModel.formData.billingAddress.state}
                  options={US_STATES}
                  onChange={(value) =>
                    handleFieldChange('billingAddress.state', value)
                  }
                  error={viewModel.getFieldError('billingAddress.state')}
                  required
                  tabIndex={12}
                />

                {/* Zip Code */}
                <div className="space-y-2">
                  <Label htmlFor="zipCode">
                    Zip Code <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="zipCode"
                    value={viewModel.formData.billingAddress.zipCode}
                    onChange={(e) =>
                      handleFieldChange('billingAddress.zipCode', e.target.value)
                    }
                    placeholder="12345"
                    maxLength={10}
                    tabIndex={13}
                    aria-required="true"
                  />
                  {viewModel.getFieldError('billingAddress.zipCode') && (
                    <p className="text-sm text-red-500">
                      {viewModel.getFieldError('billingAddress.zipCode')}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Billing Phone Section */}
        <Card
          className="mb-6 transition-all duration-300"
          style={{
            background: 'rgba(255, 255, 255, 0.7)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
          }}
        >
          <CardHeader
            className="cursor-pointer"
            onClick={() => toggleSection('billingPhone')}
          >
            <div className="flex items-center justify-between">
              <CardTitle>Billing Phone</CardTitle>
              {sectionsExpanded.billingPhone ? (
                <ChevronUp size={20} />
              ) : (
                <ChevronDown size={20} />
              )}
            </div>
          </CardHeader>

          {sectionsExpanded.billingPhone && (
            <CardContent>
              <PhoneInput
                id="billing-phone"
                label="Phone Number"
                value={viewModel.formData.billingPhone.number}
                onChange={(value) => viewModel.updatePhoneNumber(value)}
                error={viewModel.getFieldError('billingPhone.number')}
                required
                tabIndex={14}
              />
            </CardContent>
          )}
        </Card>

        {/* Program Section */}
        <Card
          className="mb-6 transition-all duration-300"
          style={{
            background: 'rgba(255, 255, 255, 0.7)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
          }}
        >
          <CardHeader
            className="cursor-pointer"
            onClick={() => toggleSection('program')}
          >
            <div className="flex items-center justify-between">
              <CardTitle>Program Information</CardTitle>
              {sectionsExpanded.program ? (
                <ChevronUp size={20} />
              ) : (
                <ChevronDown size={20} />
              )}
            </div>
          </CardHeader>

          {sectionsExpanded.program && (
            <CardContent className="space-y-4">
              {/* Program Name */}
              <div className="space-y-2">
                <Label htmlFor="program-name">
                  Program Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="program-name"
                  value={viewModel.formData.program.name}
                  onChange={(e) =>
                    handleFieldChange('program.name', e.target.value)
                  }
                  placeholder="Main Treatment Program"
                  tabIndex={15}
                  aria-required="true"
                />
                {viewModel.getFieldError('program.name') && (
                  <p className="text-sm text-red-500">
                    {viewModel.getFieldError('program.name')}
                  </p>
                )}
              </div>

              {/* Program Type */}
              <SelectDropdown
                id="program-type"
                label="Program Type"
                value={viewModel.formData.program.type}
                options={PROGRAM_TYPES}
                onChange={(value) => handleFieldChange('program.type', value)}
                error={viewModel.getFieldError('program.type')}
                required
                tabIndex={16}
                placeholder="Select program type"
              />
            </CardContent>
          )}
        </Card>

        {/* Submission Error */}
        {viewModel.submissionError && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {viewModel.submissionError}
          </div>
        )}

        {/* Form Actions */}
        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={handleSaveDraft}
            disabled={viewModel.isSubmitting}
            tabIndex={17}
          >
            <Save size={20} className="mr-2" />
            Save Draft
          </Button>
          <Button
            type="submit"
            disabled={!viewModel.canSubmit || viewModel.isSubmitting}
            tabIndex={18}
          >
            {viewModel.isSubmitting ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" />
                Submitting...
              </>
            ) : (
              <>
                <Send size={20} className="mr-2" />
                Create Organization
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
});
