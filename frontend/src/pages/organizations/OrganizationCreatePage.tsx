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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 p-8">
      <div className="max-w-6xl mx-auto">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Page Header */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">
              Create New Organization
            </h1>
            <p className="text-gray-600">
              Complete all sections to onboard a new {isProvider ? 'provider' : 'partner'} organization
            </p>
          </div>

          {/* Section 1: General Information */}
          <Card
            className="transition-all duration-200"
            style={{
              background: 'rgba(255, 255, 255, 0.75)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid',
              borderImage: 'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1',
              boxShadow: `
                0 0 0 1px rgba(255, 255, 255, 0.18) inset,
                0 2px 4px rgba(0, 0, 0, 0.04),
                0 4px 8px rgba(0, 0, 0, 0.04),
                0 8px 16px rgba(0, 0, 0, 0.04),
                0 0 24px rgba(59, 130, 246, 0.03)
              `.trim()
            }}
          >
            <CardHeader
              className="border-b border-gray-200/50 cursor-pointer"
              onClick={() => setGeneralCollapsed(!generalCollapsed)}
            >
              <div className="flex items-center justify-between">
                <CardTitle className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                  <span>1. General Information</span>
                  <span className="text-sm font-normal text-gray-600">
                    (Organization Details + Headquarters)
                  </span>
                </CardTitle>
                {generalCollapsed ? (
                  <ChevronDown className="w-6 h-6 text-gray-700" />
                ) : (
                  <ChevronUp className="w-6 h-6 text-gray-700" />
                )}
              </div>
            </CardHeader>
            {!generalCollapsed && (
              <CardContent className="p-6">
                {/* Three-card layout: Organization | Address | Phone */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Card 1: Organization Details */}
                  <div
                    className="p-4 rounded-lg transition-all duration-200"
                    style={{
                      background: 'rgba(255, 255, 255, 0.7)',
                      backdropFilter: 'blur(20px)',
                      WebkitBackdropFilter: 'blur(20px)',
                      border: '1px solid rgba(255, 255, 255, 0.3)',
                      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = `
                        0 0 0 1px rgba(255, 255, 255, 0.25) inset,
                        0 0 20px rgba(59, 130, 246, 0.15) inset,
                        0 12px 24px rgba(0, 0, 0, 0.08)
                      `.trim();
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.05)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    <div className="space-y-4">
                      {/* Organization Type */}
                      <div>
                        <Label className="text-gray-900 mb-2">
                          Organization Type <span className="text-red-600">*</span>
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
                          <Label className="text-gray-900 mb-2">
                            Partner Type <span className="text-red-600">*</span>
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

                      {/* Organization Name */}
                      <div>
                        <Label className="text-gray-900 mb-2">
                          Organization Name <span className="text-red-600">*</span>
                        </Label>
                        <Input
                          value={formData.name}
                          onChange={(e) => viewModel.updateField('name', e.target.value)}
                          placeholder="e.g., Sunshine Recovery Center"
                          className="bg-white/70 border-white/30 text-gray-900 placeholder:text-gray-500"
                          style={{
                            backdropFilter: 'blur(10px)',
                            WebkitBackdropFilter: 'blur(10px)'
                          }}
                        />
                        {viewModel.getFieldError('name') && (
                          <p className="text-red-600 text-sm mt-1">
                            {viewModel.getFieldError('name')}
                          </p>
                        )}
                      </div>

                      {/* Display Name */}
                      <div>
                        <Label className="text-gray-900 mb-2">
                          Display Name <span className="text-red-600">*</span>
                        </Label>
                        <Input
                          value={formData.displayName}
                          onChange={(e) => viewModel.updateField('displayName', e.target.value)}
                          placeholder="e.g., Sunshine Recovery"
                          className="bg-white/70 border-white/30 text-gray-900 placeholder:text-gray-500"
                          style={{
                            backdropFilter: 'blur(10px)',
                            WebkitBackdropFilter: 'blur(10px)'
                          }}
                        />
                        {viewModel.getFieldError('displayName') && (
                          <p className="text-red-600 text-sm mt-1">
                            {viewModel.getFieldError('displayName')}
                          </p>
                        )}
                      </div>

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
                        <Label className="text-gray-900 mb-2">
                          Time Zone <span className="text-red-600">*</span>
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

                      {/* Referring Partner (conditional - only for providers) */}
                      {isProvider && (
                        <div>
                          <Label className="text-gray-900 mb-2">
                            Referring Partner (Optional)
                          </Label>
                          <ReferringPartnerDropdown
                            value={formData.referringPartnerId}
                            onChange={(value) => viewModel.updateField('referringPartnerId', value)}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Card 2: Headquarters Address */}
                  <div
                    className="p-4 rounded-lg transition-all duration-200"
                    style={{
                      background: 'rgba(255, 255, 255, 0.7)',
                      backdropFilter: 'blur(20px)',
                      WebkitBackdropFilter: 'blur(20px)',
                      border: '1px solid rgba(255, 255, 255, 0.3)',
                      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = `
                        0 0 0 1px rgba(255, 255, 255, 0.25) inset,
                        0 0 20px rgba(59, 130, 246, 0.15) inset,
                        0 12px 24px rgba(0, 0, 0, 0.08)
                      `.trim();
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.05)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">
                      Headquarters Address
                    </h3>
                    <AddressInput
                      value={formData.generalAddress}
                      onChange={(address) => viewModel.updateField('generalAddress', address)}
                    />
                  </div>

                  {/* Card 3: Main Office Phone */}
                  <div
                    className="p-4 rounded-lg transition-all duration-200"
                    style={{
                      background: 'rgba(255, 255, 255, 0.7)',
                      backdropFilter: 'blur(20px)',
                      WebkitBackdropFilter: 'blur(20px)',
                      border: '1px solid rgba(255, 255, 255, 0.3)',
                      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = `
                        0 0 0 1px rgba(255, 255, 255, 0.25) inset,
                        0 0 20px rgba(59, 130, 246, 0.15) inset,
                        0 12px 24px rgba(0, 0, 0, 0.08)
                      `.trim();
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.05)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">
                      Main Office Phone
                    </h3>
                    <PhoneInputEnhanced
                      value={formData.generalPhone}
                      onChange={(phone) => viewModel.updateField('generalPhone', phone)}
                    />
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Section 2: Billing Information (conditional for providers) */}
          {isProvider && (
            <Card
              className="transition-all duration-200"
              style={{
                background: 'rgba(255, 255, 255, 0.75)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid',
                borderImage: 'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1',
                boxShadow: `
                  0 0 0 1px rgba(255, 255, 255, 0.18) inset,
                  0 2px 4px rgba(0, 0, 0, 0.04),
                  0 4px 8px rgba(0, 0, 0, 0.04),
                  0 8px 16px rgba(0, 0, 0, 0.04),
                  0 0 24px rgba(59, 130, 246, 0.03)
                `.trim()
              }}
            >
              <CardHeader
                className="border-b border-gray-200/50 cursor-pointer"
                onClick={() => setBillingCollapsed(!billingCollapsed)}
              >
                <div className="flex items-center justify-between">
                  <CardTitle className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <span>2. Billing Information</span>
                    <span className="text-sm font-normal text-gray-600">
                      (Contact + Address + Phone)
                    </span>
                  </CardTitle>
                  {billingCollapsed ? (
                    <ChevronDown className="w-6 h-6 text-gray-700" />
                  ) : (
                    <ChevronUp className="w-6 h-6 text-gray-700" />
                  )}
                </div>
              </CardHeader>
              {!billingCollapsed && (
                <CardContent className="p-6">
                  {/* Three-card layout: Contact | Address | Phone */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Billing Contact Card */}
                    <div
                      className="p-4 rounded-lg transition-all duration-200"
                      style={{
                        background: 'rgba(255, 255, 255, 0.7)',
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                        border: '1px solid rgba(255, 255, 255, 0.3)',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.boxShadow = `
                          0 0 0 1px rgba(255, 255, 255, 0.25) inset,
                          0 0 20px rgba(59, 130, 246, 0.15) inset,
                          0 12px 24px rgba(0, 0, 0, 0.08)
                        `.trim();
                        e.currentTarget.style.transform = 'translateY(-2px)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.05)';
                        e.currentTarget.style.transform = 'translateY(0)';
                      }}
                    >
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">
                        Billing Contact
                      </h3>
                      <ContactInput
                        value={formData.billingContact}
                        onChange={(contact) => viewModel.updateField('billingContact', contact)}
                      />
                    </div>

                    {/* Billing Address Card */}
                    <div
                      className="p-4 rounded-lg transition-all duration-200"
                      style={{
                        background: 'rgba(255, 255, 255, 0.7)',
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                        border: '1px solid rgba(255, 255, 255, 0.3)',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.boxShadow = `
                          0 0 0 1px rgba(255, 255, 255, 0.25) inset,
                          0 0 20px rgba(59, 130, 246, 0.15) inset,
                          0 12px 24px rgba(0, 0, 0, 0.08)
                        `.trim();
                        e.currentTarget.style.transform = 'translateY(-2px)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.05)';
                        e.currentTarget.style.transform = 'translateY(0)';
                      }}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-gray-900">
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
                          <Label htmlFor="use-billing-general-address" className="text-gray-900 cursor-pointer text-sm">
                            Use General
                          </Label>
                        </div>
                      </div>
                      <AddressInput
                        value={formData.billingAddress}
                        onChange={(address) => viewModel.updateField('billingAddress', address)}
                        disabled={formData.useBillingGeneralAddress}
                      />
                    </div>

                    {/* Billing Phone Card */}
                    <div
                      className="p-4 rounded-lg transition-all duration-200"
                      style={{
                        background: 'rgba(255, 255, 255, 0.7)',
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                        border: '1px solid rgba(255, 255, 255, 0.3)',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.boxShadow = `
                          0 0 0 1px rgba(255, 255, 255, 0.25) inset,
                          0 0 20px rgba(59, 130, 246, 0.15) inset,
                          0 12px 24px rgba(0, 0, 0, 0.08)
                        `.trim();
                        e.currentTarget.style.transform = 'translateY(-2px)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.05)';
                        e.currentTarget.style.transform = 'translateY(0)';
                      }}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-gray-900">
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
                          <Label htmlFor="use-billing-general-phone" className="text-gray-900 cursor-pointer text-sm">
                            Use General
                          </Label>
                        </div>
                      </div>
                      <PhoneInputEnhanced
                        value={formData.billingPhone}
                        onChange={(phone) => viewModel.updateField('billingPhone', phone)}
                        disabled={formData.useBillingGeneralPhone}
                      />
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          )}

          {/* Section 3: Provider Admin Information (always visible) */}
          <Card
            className="transition-all duration-200"
            style={{
              background: 'rgba(255, 255, 255, 0.75)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid',
              borderImage: 'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1',
              boxShadow: `
                0 0 0 1px rgba(255, 255, 255, 0.18) inset,
                0 2px 4px rgba(0, 0, 0, 0.04),
                0 4px 8px rgba(0, 0, 0, 0.04),
                0 8px 16px rgba(0, 0, 0, 0.04),
                0 0 24px rgba(59, 130, 246, 0.03)
              `.trim()
            }}
          >
            <CardHeader
              className="border-b border-gray-200/50 cursor-pointer"
              onClick={() => setAdminCollapsed(!adminCollapsed)}
            >
              <div className="flex items-center justify-between">
                <CardTitle className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                  <span>{isProvider ? '3' : '2'}. Provider Admin Information</span>
                  <span className="text-sm font-normal text-gray-600">
                    (Contact + Address + Phone)
                  </span>
                </CardTitle>
                {adminCollapsed ? (
                  <ChevronDown className="w-6 h-6 text-gray-700" />
                ) : (
                  <ChevronUp className="w-6 h-6 text-gray-700" />
                )}
              </div>
            </CardHeader>
            {!adminCollapsed && (
              <CardContent className="p-6">
                {/* Three-card layout: Contact | Address | Phone */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Provider Admin Contact Card */}
                  <div
                    className="p-4 rounded-lg transition-all duration-200"
                    style={{
                      background: 'rgba(255, 255, 255, 0.7)',
                      backdropFilter: 'blur(20px)',
                      WebkitBackdropFilter: 'blur(20px)',
                      border: '1px solid rgba(255, 255, 255, 0.3)',
                      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = `
                        0 0 0 1px rgba(255, 255, 255, 0.25) inset,
                        0 0 20px rgba(59, 130, 246, 0.15) inset,
                        0 12px 24px rgba(0, 0, 0, 0.08)
                      `.trim();
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.05)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">
                      Provider Admin Contact
                    </h3>
                    <ContactInput
                      value={formData.providerAdminContact}
                      onChange={(contact) => viewModel.updateField('providerAdminContact', contact)}
                    />
                  </div>

                  {/* Provider Admin Address Card */}
                  <div
                    className="p-4 rounded-lg transition-all duration-200"
                    style={{
                      background: 'rgba(255, 255, 255, 0.7)',
                      backdropFilter: 'blur(20px)',
                      WebkitBackdropFilter: 'blur(20px)',
                      border: '1px solid rgba(255, 255, 255, 0.3)',
                      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = `
                        0 0 0 1px rgba(255, 255, 255, 0.25) inset,
                        0 0 20px rgba(59, 130, 246, 0.15) inset,
                        0 12px 24px rgba(0, 0, 0, 0.08)
                      `.trim();
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.05)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">
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
                        <Label htmlFor="use-admin-general-address" className="text-gray-900 cursor-pointer text-sm">
                          Use General
                        </Label>
                      </div>
                    </div>
                    <AddressInput
                      value={formData.providerAdminAddress}
                      onChange={(address) => viewModel.updateField('providerAdminAddress', address)}
                      disabled={formData.useProviderAdminGeneralAddress}
                    />
                  </div>

                  {/* Provider Admin Phone Card */}
                  <div
                    className="p-4 rounded-lg transition-all duration-200"
                    style={{
                      background: 'rgba(255, 255, 255, 0.7)',
                      backdropFilter: 'blur(20px)',
                      WebkitBackdropFilter: 'blur(20px)',
                      border: '1px solid rgba(255, 255, 255, 0.3)',
                      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = `
                        0 0 0 1px rgba(255, 255, 255, 0.25) inset,
                        0 0 20px rgba(59, 130, 246, 0.15) inset,
                        0 12px 24px rgba(0, 0, 0, 0.08)
                      `.trim();
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.05)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">
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
                        <Label htmlFor="use-admin-general-phone" className="text-gray-900 cursor-pointer text-sm">
                          Use General
                        </Label>
                      </div>
                    </div>
                    <PhoneInputEnhanced
                      value={formData.providerAdminPhone}
                      onChange={(phone) => viewModel.updateField('providerAdminPhone', phone)}
                      disabled={formData.useProviderAdminGeneralPhone}
                    />
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Form Actions */}
          <div className="flex items-center justify-between pt-6">
            <div className="flex items-center gap-4">
              {viewModel.lastSavedAt && (
                <span className="text-sm text-gray-600">
                  Last saved: {viewModel.lastSavedAt.toLocaleTimeString()}
                </span>
              )}
              {viewModel.isAutoSaving && (
                <span className="text-sm text-amber-600">Saving...</span>
              )}
            </div>

            <div className="flex items-center gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => viewModel.saveDraft()}
                className="bg-white/70 border-gray-300 text-gray-900 hover:bg-white/90"
                style={{
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)'
                }}
              >
                <Save className="w-4 h-4 mr-2" />
                Save Draft
              </Button>

              <Button
                type="submit"
                disabled={!viewModel.canSubmit || isSubmitting}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold hover:from-blue-700 hover:to-indigo-700"
              >
                <Send className="w-4 h-4 mr-2" />
                {isSubmitting ? 'Submitting...' : 'Submit Organization'}
              </Button>
            </div>
          </div>

          {/* Validation Errors Summary */}
          {viewModel.validationErrors.length > 0 && (
            <div
              className="mt-6 p-4 rounded-lg"
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)'
              }}
            >
              <h4 className="text-red-700 font-semibold mb-2">
                Please fix the following errors:
              </h4>
              <ul className="list-disc list-inside space-y-1">
                {viewModel.validationErrors.map((error, index) => (
                  <li key={index} className="text-red-600 text-sm">
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
