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
import * as Select from '@radix-ui/react-select';
import { Logger } from '@/utils/logger';
import { useAuth } from '@/contexts/AuthContext';

const log = Logger.getLogger('component');

// =============================================================================
// Glassmorphism Style Constants
// =============================================================================

/**
 * Glassmorphism styles for main section cards (3 sections)
 */
const GLASSMORPHISM_SECTION_STYLE: React.CSSProperties = {
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
};

/**
 * Glassmorphism styles for inner cards (9 sub-cards)
 */
const GLASSMORPHISM_CARD_STYLE: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.7)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
};

/**
 * Hover shadow for inner cards
 */
const CARD_HOVER_SHADOW = `
  0 0 0 1px rgba(255, 255, 255, 0.25) inset,
  0 0 20px rgba(59, 130, 246, 0.15) inset,
  0 12px 24px rgba(0, 0, 0, 0.08)
`.trim();

/**
 * Create hover handlers for glassmorphism cards
 */
const createCardHoverHandlers = () => ({
  onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.boxShadow = CARD_HOVER_SHADOW;
    e.currentTarget.style.transform = 'translateY(-2px)';
  },
  onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.05)';
    e.currentTarget.style.transform = 'translateY(0)';
  }
});

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
        navigate(`/organizations/bootstrap/${workflowId}`);
      } else {
        // Submission failed - error is already displayed in submissionError
        log.warn('Organization submission returned null - staying on form');
      }
    } catch (error) {
      log.error('Failed to submit organization', error);
      // Error is already handled in viewModel.submit() catch block
    } finally {
      setIsSubmitting(false);
    }
  };

  const formData = viewModel.formData;
  const isProvider = formData.type === 'provider';
  const isPartner = formData.type === 'provider_partner';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 p-8">
      <div className="max-w-[130rem] mx-auto">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Page Header */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">
              Create New Organization
            </h1>
          </div>

          {/* Submission Error Banner */}
          {viewModel.submissionError && (
            <div
              className="mb-6 p-4 rounded-lg border border-red-300"
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)'
              }}
              role="alert"
              aria-live="assertive"
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <svg
                    className="w-6 h-6 text-red-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-red-800 font-semibold mb-1">
                    Organization Submission Failed
                  </h3>
                  <p className="text-red-700 text-sm">
                    {viewModel.submissionError}
                  </p>
                  <p className="text-red-600 text-xs mt-2">
                    Please check the form and try again. If the problem persists, contact support.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => viewModel.clearSubmissionError()}
                  className="flex-shrink-0 text-red-600 hover:text-red-800"
                  aria-label="Dismiss error"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Section 1: General Information */}
          <Card
            className="transition-all duration-200"
            style={GLASSMORPHISM_SECTION_STYLE}
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
                    style={GLASSMORPHISM_CARD_STYLE}
                    {...createCardHoverHandlers()}
                  >
                    <div className="space-y-3">
                      {/* Organization Info */}
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">
                        Organization Info
                      </h3>

                      {/* Organization Type */}
                      <div className="grid grid-cols-[160px_1fr] items-center gap-4">
                        <label className="block text-sm font-medium text-gray-700">
                          Organization Type<span className="text-red-500">*</span>
                        </label>
                        <Select.Root
                          value={formData.type}
                          onValueChange={(value) => viewModel.updateField('type', value as 'provider' | 'provider_partner')}
                        >
                          <Select.Trigger
                            className="w-full px-3 py-2 rounded-md border border-gray-300 shadow-sm bg-white flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
                            aria-label="Organization Type"
                            aria-required="true"
                          >
                            <Select.Value />
                            <Select.Icon>
                              <ChevronDown className="h-4 w-4" />
                            </Select.Icon>
                          </Select.Trigger>
                          <Select.Portal>
                            <Select.Content className="bg-white rounded-md shadow-lg border border-gray-200 overflow-hidden z-50">
                              <Select.Viewport className="p-1">
                                {ORGANIZATION_TYPES.map((type) => (
                                  <Select.Item
                                    key={type.value}
                                    value={type.value}
                                    className="px-3 py-2 cursor-pointer hover:bg-gray-100 rounded outline-none data-[highlighted]:bg-gray-100"
                                  >
                                    <Select.ItemText>{type.label}</Select.ItemText>
                                  </Select.Item>
                                ))}
                              </Select.Viewport>
                            </Select.Content>
                          </Select.Portal>
                        </Select.Root>
                      </div>

                      {/* Partner Type (conditional) */}
                      {isPartner && (
                        <div className="grid grid-cols-[160px_1fr] items-center gap-4">
                          <label className="block text-sm font-medium text-gray-700">
                            Partner Type<span className="text-red-500">*</span>
                          </label>
                          <Select.Root
                            value={formData.partnerType || ''}
                            onValueChange={(value) =>
                              viewModel.updateField(
                                'partnerType',
                                value as 'var' | 'family' | 'court' | 'other'
                              )
                            }
                          >
                            <Select.Trigger
                              className="w-full px-3 py-2 rounded-md border border-gray-300 shadow-sm bg-white flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
                              aria-label="Partner Type"
                              aria-required="true"
                            >
                              <Select.Value />
                              <Select.Icon>
                                <ChevronDown className="h-4 w-4" />
                              </Select.Icon>
                            </Select.Trigger>
                            <Select.Portal>
                              <Select.Content className="bg-white rounded-md shadow-lg border border-gray-200 overflow-hidden z-50">
                                <Select.Viewport className="p-1">
                                  {PARTNER_TYPES.map((type) => (
                                    <Select.Item
                                      key={type.value}
                                      value={type.value}
                                      className="px-3 py-2 cursor-pointer hover:bg-gray-100 rounded outline-none data-[highlighted]:bg-gray-100"
                                    >
                                      <Select.ItemText>{type.label}</Select.ItemText>
                                    </Select.Item>
                                  ))}
                                </Select.Viewport>
                              </Select.Content>
                            </Select.Portal>
                          </Select.Root>
                        </div>
                      )}

                      {/* Organization Name */}
                      <div className="grid grid-cols-[160px_1fr] items-start gap-4">
                        <label className="block text-sm font-medium text-gray-700 pt-2">
                          Organization Name<span className="text-red-500">*</span>
                        </label>
                        <div>
                          <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => viewModel.updateField('name', e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                            aria-label="Organization Name"
                            aria-required="true"
                            aria-invalid={!!viewModel.getFieldError('name')}
                          />
                          {viewModel.getFieldError('name') && (
                            <p className="text-red-600 text-sm mt-1">
                              {viewModel.getFieldError('name')}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Display Name */}
                      <div className="grid grid-cols-[160px_1fr] items-start gap-4">
                        <label className="block text-sm font-medium text-gray-700 pt-2">
                          Display Name<span className="text-red-500">*</span>
                        </label>
                        <div>
                          <input
                            type="text"
                            value={formData.displayName}
                            onChange={(e) => viewModel.updateField('displayName', e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                            aria-label="Display Name"
                            aria-required="true"
                            aria-invalid={!!viewModel.getFieldError('displayName')}
                          />
                          {viewModel.getFieldError('displayName') && (
                            <p className="text-red-600 text-sm mt-1">
                              {viewModel.getFieldError('displayName')}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Subdomain (conditional) */}
                      {viewModel.isSubdomainRequired && (
                        <SubdomainInput
                          id="subdomain"
                          label="Subdomain"
                          value={formData.subdomain}
                          onChange={(value) => viewModel.updateSubdomain(value)}
                          error={viewModel.getFieldError('subdomain')}
                          required
                        />
                      )}

                      {/* Time Zone */}
                      <div className="grid grid-cols-[160px_1fr] items-center gap-4">
                        <label className="block text-sm font-medium text-gray-700">
                          Time Zone<span className="text-red-500">*</span>
                        </label>
                        <Select.Root
                          value={formData.timeZone}
                          onValueChange={(value) => viewModel.updateField('timeZone', value)}
                        >
                          <Select.Trigger
                            className="w-full px-3 py-2 rounded-md border border-gray-300 shadow-sm bg-white flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
                            aria-label="Time Zone"
                            aria-required="true"
                          >
                            <Select.Value />
                            <Select.Icon>
                              <ChevronDown className="h-4 w-4" />
                            </Select.Icon>
                          </Select.Trigger>
                          <Select.Portal>
                            <Select.Content className="bg-white rounded-md shadow-lg border border-gray-200 overflow-hidden z-50 max-h-[300px]">
                              <Select.Viewport className="p-1">
                                {US_TIME_ZONES.map((tz) => (
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
                      </div>

                      {/* Referring Partner (conditional - only for providers) */}
                      {isProvider && (
                        <ReferringPartnerDropdown
                          value={formData.referringPartnerId}
                          onChange={(value) => viewModel.updateField('referringPartnerId', value)}
                        />
                      )}
                    </div>
                  </div>

                  {/* Card 2: Headquarters Address */}
                  <div
                    className="p-4 rounded-lg transition-all duration-200"
                    style={GLASSMORPHISM_CARD_STYLE}
                    {...createCardHoverHandlers()}
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
                    style={GLASSMORPHISM_CARD_STYLE}
                    {...createCardHoverHandlers()}
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
              style={GLASSMORPHISM_SECTION_STYLE}
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
                      style={GLASSMORPHISM_CARD_STYLE}
                      {...createCardHoverHandlers()}
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
                      style={GLASSMORPHISM_CARD_STYLE}
                      {...createCardHoverHandlers()}
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
                      style={GLASSMORPHISM_CARD_STYLE}
                      {...createCardHoverHandlers()}
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
            style={GLASSMORPHISM_SECTION_STYLE}
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
                    style={GLASSMORPHISM_CARD_STYLE}
                    {...createCardHoverHandlers()}
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
                    style={GLASSMORPHISM_CARD_STYLE}
                    {...createCardHoverHandlers()}
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
                    style={GLASSMORPHISM_CARD_STYLE}
                    {...createCardHoverHandlers()}
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
