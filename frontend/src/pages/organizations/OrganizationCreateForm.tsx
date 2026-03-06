/**
 * Organization Create Form
 *
 * Extracted from OrganizationCreatePage for embedding in the manage page's right panel.
 * Card-based layout matching edit mode structure:
 * - Organization Details card (create-only fields + shared fields)
 * - Headquarters card (address + phone)
 * - Billing Information card (conditional for providers)
 * - Provider Admin Information card
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ContactInput } from '@/components/organizations/ContactInput';
import { AddressInput } from '@/components/organizations/AddressInput';
import { PhoneInputEnhanced } from '@/components/organizations/PhoneInputEnhanced';
import { ReferringPartnerDropdown } from '@/components/organizations/ReferringPartnerDropdown';
import { SubdomainInput } from '@/components/organization/SubdomainInput';
import { OrganizationFormViewModel } from '@/viewModels/organization/OrganizationFormViewModel';
import { US_TIME_ZONES, ORGANIZATION_TYPES, PARTNER_TYPES } from '@/constants';
import { Save, Send, ChevronDown, AlertTriangle, X, User, MapPin, Phone } from 'lucide-react';
import * as Select from '@radix-ui/react-select';
import { Logger } from '@/utils/logger';
import { useAuth } from '@/contexts/AuthContext';

const log = Logger.getLogger('component');

// =============================================================================
// Props Interface
// =============================================================================

export interface OrganizationCreateFormProps {
  onSubmitSuccess: (organizationId: string) => void;
  onCancel: () => void;
}

// =============================================================================
// Reusable Select Field
// =============================================================================

interface SelectFieldProps {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly { readonly value: string; readonly label: string }[];
  required?: boolean;
  ariaLabel: string;
  testId: string;
  maxHeight?: string;
}

const SelectField: React.FC<SelectFieldProps> = ({
  label,
  value,
  onValueChange,
  options,
  required,
  ariaLabel,
  testId,
  maxHeight,
}) => (
  <div className="flex flex-col gap-1">
    <label className="block text-sm font-medium text-gray-700">
      {label}
      {required && <span className="text-red-500">*</span>}
    </label>
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger
        className="w-full px-3 py-2 rounded-md border border-gray-300 shadow-sm bg-white flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
        aria-label={ariaLabel}
        aria-required={required ? 'true' : undefined}
        data-testid={testId}
      >
        <Select.Value />
        <Select.Icon>
          <ChevronDown className="h-4 w-4" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className={`bg-white rounded-md shadow-lg border border-gray-200 overflow-hidden z-50${maxHeight ? ` ${maxHeight}` : ''}`}
        >
          <Select.Viewport className="p-1">
            {options.map((opt) => (
              <Select.Item
                key={opt.value}
                value={opt.value}
                className="px-3 py-2 cursor-pointer hover:bg-gray-100 rounded outline-none data-[highlighted]:bg-gray-100"
              >
                <Select.ItemText>{opt.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  </div>
);

// =============================================================================
// Reusable Text Field
// =============================================================================

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  ariaLabel: string;
  testId: string;
  error?: string | null;
}

const TextField: React.FC<TextFieldProps> = ({
  label,
  value,
  onChange,
  required,
  ariaLabel,
  testId,
  error,
}) => (
  <div className="flex flex-col gap-1">
    <label className="block text-sm font-medium text-gray-700">
      {label}
      {required && <span className="text-red-500">*</span>}
    </label>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
      aria-label={ariaLabel}
      aria-required={required ? 'true' : undefined}
      aria-invalid={!!error}
      data-testid={testId}
    />
    {error && <p className="text-red-600 text-sm mt-1">{error}</p>}
  </div>
);

// =============================================================================
// "Use General" Checkbox Header
// =============================================================================

interface UseGeneralHeaderProps {
  title: string;
  checkboxId: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  testId: string;
}

const UseGeneralHeader: React.FC<UseGeneralHeaderProps> = ({
  title,
  checkboxId,
  checked,
  onCheckedChange,
  testId,
}) => (
  <div className="flex items-center justify-between mb-3">
    <h4 className="text-sm font-semibold text-gray-700">{title}</h4>
    <div className="flex items-center gap-2">
      <Checkbox
        id={checkboxId}
        checked={checked}
        onCheckedChange={(c) => onCheckedChange(c as boolean)}
        data-testid={testId}
      />
      <Label htmlFor={checkboxId} className="text-gray-900 cursor-pointer text-sm">
        Use General
      </Label>
    </div>
  </div>
);

// =============================================================================
// Organization Create Form Component
// =============================================================================

export const OrganizationCreateForm: React.FC<OrganizationCreateFormProps> = observer(
  ({ onSubmitSuccess, onCancel }) => {
    useAuth();
    const [viewModel] = useState(() => new OrganizationFormViewModel());
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Auto-save effect (debounced)
    useEffect(() => {
      if (viewModel.isDirty) {
        const timeoutId = setTimeout(() => {
          viewModel.autoSaveDraft();
        }, 500);

        return () => clearTimeout(timeoutId);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- viewModel is a stable MobX store created in useMemo
    }, [viewModel.formData, viewModel.isDirty]);

    // Form submission handler
    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();

      if (!viewModel.validate()) {
        log.warn('Form validation failed', {
          errorCount: viewModel.validationErrors.length,
        });
        return;
      }

      setIsSubmitting(true);

      try {
        const organizationId = await viewModel.submit();

        if (organizationId) {
          log.info('Organization workflow started', { organizationId });
          onSubmitSuccess(organizationId);
        } else {
          log.warn('Organization submission returned null - staying on form');
        }
      } catch (error) {
        log.error('Failed to submit organization', error);
      } finally {
        setIsSubmitting(false);
      }
    };

    /**
     * Prevent Enter key from submitting form when in text inputs.
     * Complex multi-field forms should require explicit Submit button click.
     */
    const handleFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
      if (e.key === 'Enter') {
        const target = e.target as HTMLElement;
        const tagName = target.tagName.toLowerCase();

        if (tagName === 'input') {
          const inputType = (target as HTMLInputElement).type?.toLowerCase();
          const textTypes = ['text', 'email', 'tel', 'password', 'search', 'url'];
          if (!inputType || textTypes.includes(inputType)) {
            e.preventDefault();
          }
        }
      }
    };

    const formData = viewModel.formData;
    const isProvider = formData.type === 'provider';
    const isPartner = formData.type === 'provider_partner';

    return (
      <div data-testid="org-create-form">
        <form onSubmit={handleSubmit} onKeyDown={handleFormKeyDown} className="space-y-4">
          {/* Submission Error Banner */}
          {viewModel.submissionError && (
            <div
              className="p-4 rounded-lg border border-red-300 bg-red-50"
              role="alert"
              aria-live="assertive"
              data-testid="org-create-submit-error"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-red-800 font-semibold">Organization Submission Failed</h3>
                  <p className="text-red-700 text-sm mt-1">{viewModel.submissionError}</p>
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
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Organization Details Card */}
          <Card className="shadow-lg" data-testid="org-create-section-general">
            <CardHeader className="border-b border-gray-200">
              <CardTitle className="text-xl font-semibold text-gray-900">
                Organization Details
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SelectField
                  label="Organization Type"
                  value={formData.type}
                  onValueChange={(v) =>
                    viewModel.updateField('type', v as 'provider' | 'provider_partner')
                  }
                  options={ORGANIZATION_TYPES}
                  required
                  ariaLabel="Organization Type"
                  testId="org-create-type-select"
                />

                {isPartner && (
                  <SelectField
                    label="Partner Type"
                    value={formData.partnerType || ''}
                    onValueChange={(v) =>
                      viewModel.updateField(
                        'partnerType',
                        v as 'var' | 'family' | 'court' | 'other'
                      )
                    }
                    options={PARTNER_TYPES}
                    required
                    ariaLabel="Partner Type"
                    testId="org-create-partner-type-select"
                  />
                )}

                <TextField
                  label="Organization Name"
                  value={formData.name}
                  onChange={(v) => viewModel.updateField('name', v)}
                  required
                  ariaLabel="Organization Name"
                  testId="org-create-name-input"
                  error={viewModel.getFieldError('name')}
                />

                <TextField
                  label="Display Name"
                  value={formData.displayName}
                  onChange={(v) => viewModel.updateField('displayName', v)}
                  required
                  ariaLabel="Display Name"
                  testId="org-create-display-name-input"
                  error={viewModel.getFieldError('displayName')}
                />

                {viewModel.isSubdomainRequired && (
                  <SubdomainInput
                    id="subdomain"
                    label="Subdomain"
                    value={formData.subdomain}
                    onChange={(value) => viewModel.updateSubdomain(value)}
                    error={viewModel.getFieldError('subdomain')}
                    required
                    data-testid="org-create-subdomain-input"
                  />
                )}

                <SelectField
                  label="Time Zone"
                  value={formData.timeZone}
                  onValueChange={(v) => viewModel.updateField('timeZone', v)}
                  options={US_TIME_ZONES}
                  required
                  ariaLabel="Time Zone"
                  testId="org-create-timezone-select"
                  maxHeight="max-h-[300px]"
                />

                {isProvider && (
                  <ReferringPartnerDropdown
                    value={formData.referringPartnerId}
                    onChange={(value) => viewModel.updateField('referringPartnerId', value)}
                    data-testid="org-create-referring-partner"
                  />
                )}
              </div>
            </CardContent>
          </Card>

          {/* Headquarters Card */}
          <Card className="shadow-lg" data-testid="org-create-headquarters-card">
            <CardHeader className="border-b border-gray-200">
              <CardTitle className="text-xl font-semibold text-gray-900">Headquarters</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div data-testid="org-create-general-address">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">
                    <MapPin className="w-4 h-4 inline-block mr-1 text-blue-600" />
                    Address
                  </h4>
                  <AddressInput
                    value={formData.generalAddress}
                    onChange={(address) => viewModel.updateField('generalAddress', address)}
                  />
                </div>
                <div data-testid="org-create-general-phone">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">
                    <Phone className="w-4 h-4 inline-block mr-1 text-blue-600" />
                    Main Office Phone
                  </h4>
                  <PhoneInputEnhanced
                    value={formData.generalPhone}
                    onChange={(phone) => viewModel.updateField('generalPhone', phone)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Billing Information Card (conditional for providers) */}
          {isProvider && (
            <Card className="shadow-lg" data-testid="org-create-section-billing">
              <CardHeader className="border-b border-gray-200">
                <CardTitle className="text-xl font-semibold text-gray-900">
                  Billing Information
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                {/* Billing Contact */}
                <div data-testid="org-create-billing-contact">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">
                    <User className="w-4 h-4 inline-block mr-1 text-blue-600" />
                    Billing Contact
                  </h4>
                  <ContactInput
                    value={formData.billingContact}
                    onChange={(contact) => viewModel.updateField('billingContact', contact)}
                  />
                </div>

                <hr className="border-gray-200" />

                {/* Billing Address */}
                <div data-testid="org-create-billing-address">
                  <UseGeneralHeader
                    title="Billing Address"
                    checkboxId="use-billing-general-address"
                    checked={formData.useBillingGeneralAddress}
                    onCheckedChange={(c) => viewModel.updateField('useBillingGeneralAddress', c)}
                    testId="org-create-use-billing-general-address"
                  />
                  <AddressInput
                    value={formData.billingAddress}
                    onChange={(address) => viewModel.updateField('billingAddress', address)}
                    disabled={formData.useBillingGeneralAddress}
                  />
                </div>

                <hr className="border-gray-200" />

                {/* Billing Phone */}
                <div data-testid="org-create-billing-phone">
                  <UseGeneralHeader
                    title="Billing Phone"
                    checkboxId="use-billing-general-phone"
                    checked={formData.useBillingGeneralPhone}
                    onCheckedChange={(c) => viewModel.updateField('useBillingGeneralPhone', c)}
                    testId="org-create-use-billing-general-phone"
                  />
                  <PhoneInputEnhanced
                    value={formData.billingPhone}
                    onChange={(phone) => viewModel.updateField('billingPhone', phone)}
                    disabled={formData.useBillingGeneralPhone}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Provider Admin Information Card */}
          <Card className="shadow-lg" data-testid="org-create-section-provider-admin">
            <CardHeader className="border-b border-gray-200">
              <CardTitle className="text-xl font-semibold text-gray-900">
                Provider Admin Information
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              {/* Admin Contact */}
              <div data-testid="org-create-admin-contact">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">
                  <User className="w-4 h-4 inline-block mr-1 text-blue-600" />
                  Provider Admin Contact
                </h4>
                <ContactInput
                  value={formData.providerAdminContact}
                  onChange={(contact) => viewModel.updateField('providerAdminContact', contact)}
                  showEmailConfirmation={true}
                />
              </div>

              <hr className="border-gray-200" />

              {/* Admin Address */}
              <div data-testid="org-create-admin-address">
                <UseGeneralHeader
                  title="Provider Admin Address"
                  checkboxId="use-admin-general-address"
                  checked={formData.useProviderAdminGeneralAddress}
                  onCheckedChange={(c) =>
                    viewModel.updateField('useProviderAdminGeneralAddress', c)
                  }
                  testId="org-create-use-admin-general-address"
                />
                <AddressInput
                  value={formData.providerAdminAddress}
                  onChange={(address) => viewModel.updateField('providerAdminAddress', address)}
                  disabled={formData.useProviderAdminGeneralAddress}
                />
              </div>

              <hr className="border-gray-200" />

              {/* Admin Phone */}
              <div data-testid="org-create-admin-phone">
                <UseGeneralHeader
                  title="Provider Admin Phone"
                  checkboxId="use-admin-general-phone"
                  checked={formData.useProviderAdminGeneralPhone}
                  onCheckedChange={(c) => viewModel.updateField('useProviderAdminGeneralPhone', c)}
                  testId="org-create-use-admin-general-phone"
                />
                <PhoneInputEnhanced
                  value={formData.providerAdminPhone}
                  onChange={(phone) => viewModel.updateField('providerAdminPhone', phone)}
                  disabled={formData.useProviderAdminGeneralPhone}
                />
              </div>
            </CardContent>
          </Card>

          {/* Form Actions */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-4">
              {viewModel.lastSavedAt && (
                <span className="text-sm text-gray-600" data-testid="org-create-last-saved">
                  Last saved: {viewModel.lastSavedAt.toLocaleTimeString()}
                </span>
              )}
              {viewModel.isAutoSaving && <span className="text-sm text-amber-600">Saving...</span>}
            </div>

            <div className="flex items-center gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                className="text-gray-700"
                data-testid="org-create-cancel-btn"
              >
                Cancel
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => viewModel.saveDraft()}
                data-testid="org-create-save-draft-btn"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Draft
              </Button>

              <Button
                type="submit"
                disabled={!viewModel.canSubmit || isSubmitting}
                className="bg-blue-600 hover:bg-blue-700 text-white"
                data-testid="org-create-submit-btn"
              >
                <Send className="w-4 h-4 mr-2" />
                {isSubmitting ? 'Submitting...' : 'Submit Organization'}
              </Button>
            </div>
          </div>

          {/* Validation Errors Summary */}
          {viewModel.validationErrors.length > 0 && (
            <div
              className="p-4 rounded-lg border border-red-300 bg-red-50"
              data-testid="org-create-validation-errors"
            >
              <h4 className="text-red-700 font-semibold mb-2">Please fix the following errors:</h4>
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
    );
  }
);
