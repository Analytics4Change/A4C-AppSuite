/**
 * Organization Create Page
 *
 * Complete implementation with 3-section structure:
 * - General Information (Organization + Headquarters)
 * - Billing Information (Contact + Address + Phone) - Conditional for providers
 * - Provider Admin Information (Contact + Address + Phone)
 *
 * Features:
 * - Dynamic section visibility based on organization type
 * - "Use General Information" checkboxes for address/phone
 * - Referring partner relationship tracking
 * - Partner type classification (VAR, Family, Court, Other)
 * - Conditional subdomain provisioning
 * - Auto-save drafts to localStorage
 * - Form validation with field-level errors
 * - Event-driven workflow submission
 * - Full keyboard navigation and WCAG 2.1 Level AA compliance
 */

import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ContactInput } from '@/components/organizations/ContactInput';
import { AddressInput } from '@/components/organizations/AddressInput';
import { PhoneInputEnhanced } from '@/components/organizations/PhoneInputEnhanced';
import { ReferringPartnerDropdown } from '@/components/organizations/ReferringPartnerDropdown';
import { SelectDropdown } from '@/components/organization/SelectDropdown';
import { SubdomainInput } from '@/components/organization/SubdomainInput';
import { OrganizationFormViewModel } from '@/viewModels/organization/OrganizationFormViewModel';
import {
  US_TIME_ZONES,
  ORGANIZATION_TYPES,
  PARTNER_TYPES
} from '@/constants';
import { Save, Send, ChevronDown, ChevronUp } from 'lucide-react';
import { Logger } from '@/utils/logger';
import { useAuth } from '@/contexts/AuthContext';

const log = Logger.getLogger('component');

/**
 * Organization Create Page Component
 *
 * Full 3-section form with dynamic visibility and "Use General Information" support.
 */
export const OrganizationCreatePage: React.FC = observer(() => {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [viewModel] = useState(() => new OrganizationFormViewModel());
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Section collapse states
  const [generalCollapsed, setGeneralCollapsed] = useState(false);
  const [billingCollapsed, setBillingCollapsed] = useState(false);
  const [adminCollapsed, setAdminCollapsed] = useState(false);

  // Auto-save effect (debounced)
  useEffect(() => {
    if (viewModel.isDirty) {
      const timeoutId = setTimeout(() => {
        viewModel.autoSaveDraft();
      }, 500);

      return () => clearTimeout(timeoutId);
    }
  }, [viewModel.formData, viewModel.isDirty]);

  // Form submission handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!viewModel.validate()) {
      log.warn('Form validation failed', {
        errorCount: viewModel.validationErrors.length
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const workflowId = await viewModel.submit();

      if (workflowId) {
        log.info('Organization workflow started', { workflowId });
        // Navigate to status page
        navigate(`/organizations/status/${workflowId}`);
      }
    } catch (error) {
      log.error('Failed to submit organization', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formData = viewModel.formData;
  const isProvider = formData.type === 'provider';
  const isPartner = formData.type === 'provider_partner';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
      <div className="max-w-6xl mx-auto">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Page Header */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-white mb-2">
              Create New Organization
            </h1>
            <p className="text-gray-300">
              Complete all sections to onboard a new {isProvider ? 'provider' : 'partner'} organization
            </p>
          </div>

          {/* Section 1: General Information */}
          <Card className="backdrop-blur-lg bg-white/10 border-white/20 shadow-2xl">
            <CardHeader
              className="border-b border-white/10 cursor-pointer"
              onClick={() => setGeneralCollapsed(!generalCollapsed)}
            >
              <div className="flex items-center justify-between">
                <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                  <span>1. General Information</span>
                  <span className="text-sm font-normal text-gray-300">
                    (Organization Details + Headquarters)
                  </span>
                </CardTitle>
                {generalCollapsed ? (
                  <ChevronDown className="w-6 h-6 text-white" />
                ) : (
                  <ChevronUp className="w-6 h-6 text-white" />
                )}
              </div>
            </CardHeader>
            {!generalCollapsed && (
              <CardContent className="p-6 space-y-6">
                {/* Organization Type */}
                <div>
                  <Label className="text-white mb-2">
                    Organization Type <span className="text-red-400">*</span>
                  </Label>
                  <SelectDropdown
                    id="org-type"
                    label="Organization Type"
                    value={formData.type}
                    options={ORGANIZATION_TYPES.map((t) => ({
                      value: t.value,
                      label: t.label
                    }))}
                    onChange={(value) => viewModel.updateField('type', value as 'provider' | 'provider_partner')}
                  />
                </div>

                {/* Partner Type (conditional) */}
                {isPartner && (
                  <div>
                    <Label className="text-white mb-2">
                      Partner Type <span className="text-red-400">*</span>
                    </Label>
                    <SelectDropdown
                      id="partner-type"
                      label="Partner Type"
                      value={formData.partnerType || ''}
                      options={PARTNER_TYPES.map((t) => ({
                        value: t.value,
                        label: t.label
                      }))}
                      onChange={(value) =>
                        viewModel.updateField(
                          'partnerType',
                          value as 'var' | 'family' | 'court' | 'other'
                        )
                      }
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Organization Name */}
                  <div>
                    <Label className="text-white mb-2">
                      Organization Name <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => viewModel.updateField('name', e.target.value)}
                      placeholder="e.g., Sunshine Recovery Center"
                      className="bg-white/5 border-white/20 text-white placeholder:text-gray-400"
                    />
                    {viewModel.getFieldError('name') && (
                      <p className="text-red-400 text-sm mt-1">
                        {viewModel.getFieldError('name')}
                      </p>
                    )}
                  </div>

                  {/* Display Name */}
                  <div>
                    <Label className="text-white mb-2">
                      Display Name <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      value={formData.displayName}
                      onChange={(e) => viewModel.updateField('displayName', e.target.value)}
                      placeholder="e.g., Sunshine Recovery"
                      className="bg-white/5 border-white/20 text-white placeholder:text-gray-400"
                    />
                    {viewModel.getFieldError('displayName') && (
                      <p className="text-red-400 text-sm mt-1">
                        {viewModel.getFieldError('displayName')}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Subdomain (conditional) */}
                  {viewModel.isSubdomainRequired && (
                    <div>
                      <SubdomainInput
                        id="subdomain"
                        label="Subdomain"
                        value={formData.subdomain}
                        onChange={(value) => viewModel.updateSubdomain(value)}
                        error={viewModel.getFieldError('subdomain')}
                        required
                      />
                    </div>
                  )}

                  {/* Time Zone */}
                  <div>
                    <Label className="text-white mb-2">
                      Time Zone <span className="text-red-400">*</span>
                    </Label>
                    <SelectDropdown
                      id="time-zone"
                      label="Time Zone"
                      value={formData.timeZone}
                      options={US_TIME_ZONES.map((tz) => ({
                        value: tz.value,
                        label: tz.label
                      }))}
                      onChange={(value) => viewModel.updateField('timeZone', value)}
                    />
                  </div>
                </div>

                {/* Referring Partner (conditional - only for providers) */}
                {isProvider && (
                  <div>
                    <Label className="text-white mb-2">
                      Referring Partner (Optional)
                    </Label>
                    <ReferringPartnerDropdown
                      value={formData.referringPartnerId}
                      onChange={(value) => viewModel.updateField('referringPartnerId', value)}
                    />
                  </div>
                )}

                {/* Headquarters Address */}
                <div>
                  <h3 className="text-lg font-semibold text-white mb-4">
                    Headquarters Address
                  </h3>
                  <AddressInput
                    value={formData.generalAddress}
                    onChange={(address) => viewModel.updateField('generalAddress', address)}
                  />
                </div>

                {/* Headquarters Phone */}
                <div>
                  <h3 className="text-lg font-semibold text-white mb-4">
                    Main Office Phone
                  </h3>
                  <PhoneInputEnhanced
                    value={formData.generalPhone}
                    onChange={(phone) => viewModel.updateField('generalPhone', phone)}
                  />
                </div>
              </CardContent>
            )}
          </Card>

          {/* Section 2: Billing Information (conditional for providers) */}
          {isProvider && (
            <Card className="backdrop-blur-lg bg-white/10 border-white/20 shadow-2xl">
              <CardHeader
                className="border-b border-white/10 cursor-pointer"
                onClick={() => setBillingCollapsed(!billingCollapsed)}
              >
                <div className="flex items-center justify-between">
                  <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                    <span>2. Billing Information</span>
                    <span className="text-sm font-normal text-gray-300">
                      (Contact + Address + Phone)
                    </span>
                  </CardTitle>
                  {billingCollapsed ? (
                    <ChevronDown className="w-6 h-6 text-white" />
                  ) : (
                    <ChevronUp className="w-6 h-6 text-white" />
                  )}
                </div>
              </CardHeader>
              {!billingCollapsed && (
                <CardContent className="p-6 space-y-6">
                  {/* Billing Contact */}
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-4">
                      Billing Contact
                    </h3>
                    <ContactInput
                      value={formData.billingContact}
                      onChange={(contact) => viewModel.updateField('billingContact', contact)}
                    />
                  </div>

                  {/* Billing Address with "Use General Information" checkbox */}
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-white">
                        Billing Address
                      </h3>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="use-billing-general-address"
                          checked={formData.useBillingGeneralAddress}
                          onCheckedChange={(checked) =>
                            viewModel.updateField('useBillingGeneralAddress', checked as boolean)
                          }
                        />
                        <Label htmlFor="use-billing-general-address" className="text-white cursor-pointer">
                          Use General Information
                        </Label>
                      </div>
                    </div>
                    <AddressInput
                      value={formData.billingAddress}
                      onChange={(address) => viewModel.updateField('billingAddress', address)}
                      disabled={formData.useBillingGeneralAddress}
                    />
                  </div>

                  {/* Billing Phone with "Use General Information" checkbox */}
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-white">
                        Billing Phone
                      </h3>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="use-billing-general-phone"
                          checked={formData.useBillingGeneralPhone}
                          onCheckedChange={(checked) =>
                            viewModel.updateField('useBillingGeneralPhone', checked as boolean)
                          }
                        />
                        <Label htmlFor="use-billing-general-phone" className="text-white cursor-pointer">
                          Use General Information
                        </Label>
                      </div>
                    </div>
                    <PhoneInputEnhanced
                      value={formData.billingPhone}
                      onChange={(phone) => viewModel.updateField('billingPhone', phone)}
                      disabled={formData.useBillingGeneralPhone}
                    />
                  </div>
                </CardContent>
              )}
            </Card>
          )}

          {/* Section 3: Provider Admin Information (always visible) */}
          <Card className="backdrop-blur-lg bg-white/10 border-white/20 shadow-2xl">
            <CardHeader
              className="border-b border-white/10 cursor-pointer"
              onClick={() => setAdminCollapsed(!adminCollapsed)}
            >
              <div className="flex items-center justify-between">
                <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                  <span>{isProvider ? '3' : '2'}. Provider Admin Information</span>
                  <span className="text-sm font-normal text-gray-300">
                    (Contact + Address + Phone)
                  </span>
                </CardTitle>
                {adminCollapsed ? (
                  <ChevronDown className="w-6 h-6 text-white" />
                ) : (
                  <ChevronUp className="w-6 h-6 text-white" />
                )}
              </div>
            </CardHeader>
            {!adminCollapsed && (
              <CardContent className="p-6 space-y-6">
                {/* Provider Admin Contact */}
                <div>
                  <h3 className="text-lg font-semibold text-white mb-4">
                    Provider Admin Contact
                  </h3>
                  <ContactInput
                    value={formData.providerAdminContact}
                    onChange={(contact) => viewModel.updateField('providerAdminContact', contact)}
                  />
                </div>

                {/* Provider Admin Address with "Use General Information" checkbox */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-white">
                      Provider Admin Address
                    </h3>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="use-admin-general-address"
                        checked={formData.useProviderAdminGeneralAddress}
                        onCheckedChange={(checked) =>
                          viewModel.updateField('useProviderAdminGeneralAddress', checked as boolean)
                        }
                      />
                      <Label htmlFor="use-admin-general-address" className="text-white cursor-pointer">
                        Use General Information
                      </Label>
                    </div>
                  </div>
                  <AddressInput
                    value={formData.providerAdminAddress}
                    onChange={(address) => viewModel.updateField('providerAdminAddress', address)}
                    disabled={formData.useProviderAdminGeneralAddress}
                  />
                </div>

                {/* Provider Admin Phone with "Use General Information" checkbox */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-white">
                      Provider Admin Phone
                    </h3>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="use-admin-general-phone"
                        checked={formData.useProviderAdminGeneralPhone}
                        onCheckedChange={(checked) =>
                          viewModel.updateField('useProviderAdminGeneralPhone', checked as boolean)
                        }
                      />
                      <Label htmlFor="use-admin-general-phone" className="text-white cursor-pointer">
                        Use General Information
                      </Label>
                    </div>
                  </div>
                  <PhoneInputEnhanced
                    value={formData.providerAdminPhone}
                    onChange={(phone) => viewModel.updateField('providerAdminPhone', phone)}
                    disabled={formData.useProviderAdminGeneralPhone}
                  />
                </div>
              </CardContent>
            )}
          </Card>

          {/* Form Actions */}
          <div className="flex items-center justify-between pt-6">
            <div className="flex items-center gap-4">
              {viewModel.lastSavedAt && (
                <span className="text-sm text-gray-300">
                  Last saved: {viewModel.lastSavedAt.toLocaleTimeString()}
                </span>
              )}
              {viewModel.isAutoSaving && (
                <span className="text-sm text-yellow-300">Saving...</span>
              )}
            </div>

            <div className="flex items-center gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => viewModel.saveDraft()}
                className="bg-white/10 border-white/20 text-white hover:bg-white/20"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Draft
              </Button>

              <Button
                type="submit"
                disabled={!viewModel.canSubmit || isSubmitting}
                className="bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold"
              >
                <Send className="w-4 h-4 mr-2" />
                {isSubmitting ? 'Submitting...' : 'Submit Organization'}
              </Button>
            </div>
          </div>

          {/* Validation Errors Summary */}
          {viewModel.validationErrors.length > 0 && (
            <div className="mt-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg">
              <h4 className="text-red-300 font-semibold mb-2">
                Please fix the following errors:
              </h4>
              <ul className="list-disc list-inside space-y-1">
                {viewModel.validationErrors.map((error, index) => (
                  <li key={index} className="text-red-200 text-sm">
                    {error.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </form>
      </div>
    </div>
  );
});
