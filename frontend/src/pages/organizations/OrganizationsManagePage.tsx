/**
 * Organizations Management Page
 *
 * Single-page interface for managing organizations with split view layout.
 * Left panel: Filterable organization list with selection
 * Right panel: Form for editing org details, contacts, addresses, phones
 *
 * Features:
 * - Split view layout (list 1/3 + form 2/3)
 * - Select org -> shows editable form with entity sections
 * - Create mode: platform owner can create new orgs via embedded form
 * - Role-based editability (platform owner edits name + lifecycle; provider admin edits details)
 * - DangerZone for platform owner (deactivate/reactivate/delete)
 * - Unsaved changes warning
 *
 * Route: /organizations
 * Permission: organization.update
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DangerZone } from '@/components/ui/DangerZone';
import { OrganizationCreateForm } from '@/pages/organizations/OrganizationCreateForm';
import { OrganizationManageListViewModel } from '@/viewModels/organization/OrganizationManageListViewModel';
import { OrganizationManageFormViewModel } from '@/viewModels/organization/OrganizationManageFormViewModel';
import type {
  OrganizationContact,
  OrganizationAddress,
  OrganizationPhone,
  ContactData,
  AddressData,
  PhoneData,
} from '@/types/organization.types';

import {
  ArrowLeft,
  Building,
  AlertTriangle,
  X,
  XCircle,
  CheckCircle,
  Save,
  Plus,
  Trash2,
  MapPin,
  Phone,
  User,
  Edit2,
} from 'lucide-react';
import { Logger } from '@/utils/logger';
import { cn } from '@/components/ui/utils';

const log = Logger.getLogger('component');

/** Panel mode: empty (no selection), edit (org selected), or create (new org form) */
type PanelMode = 'empty' | 'edit' | 'create';

/** Discriminated union for dialog state */
type DialogState =
  | { type: 'none' }
  | { type: 'discard' }
  | { type: 'deactivate'; isLoading: boolean }
  | { type: 'reactivate'; isLoading: boolean }
  | { type: 'delete'; isLoading: boolean }
  | { type: 'activeWarning' }
  | { type: 'addContact' }
  | { type: 'editContact'; contact: OrganizationContact }
  | { type: 'deleteContact'; contactId: string; contactName: string }
  | { type: 'addAddress' }
  | { type: 'editAddress'; address: OrganizationAddress }
  | { type: 'deleteAddress'; addressId: string; addressLabel: string }
  | { type: 'addPhone' }
  | { type: 'editPhone'; phone: OrganizationPhone }
  | { type: 'deletePhone'; phoneId: string; phoneLabel: string };

// ============================================================================
// Inline entity form state types
// ============================================================================

interface ContactFormState {
  label: string;
  type: string;
  first_name: string;
  last_name: string;
  email: string;
  title: string;
  department: string;
}

interface AddressFormState {
  label: string;
  type: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  zip_code: string;
}

interface PhoneFormState {
  label: string;
  type: string;
  number: string;
  extension: string;
}

const EMPTY_CONTACT: ContactFormState = {
  label: '',
  type: 'administrative',
  first_name: '',
  last_name: '',
  email: '',
  title: '',
  department: '',
};

const EMPTY_ADDRESS: AddressFormState = {
  label: '',
  type: 'physical',
  street1: '',
  street2: '',
  city: '',
  state: '',
  zip_code: '',
};

const EMPTY_PHONE: PhoneFormState = {
  label: '',
  type: 'office',
  number: '',
  extension: '',
};

// ============================================================================
// Sub-components
// ============================================================================

/** Form field row */
const FormField: React.FC<{
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string | null;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
}> = ({ label, id, value, onChange, onBlur, error, disabled, required, placeholder }) => (
  <div>
    <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
      {label}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <input
      id={id}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      disabled={disabled}
      placeholder={placeholder}
      className={cn(
        'w-full px-3 py-2 text-sm rounded-md border',
        'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
        'disabled:bg-gray-50 disabled:text-gray-500',
        error ? 'border-red-300' : 'border-gray-300'
      )}
      aria-required={required}
      aria-invalid={!!error}
      aria-describedby={error ? `${id}-error` : undefined}
    />
    {error && (
      <p id={`${id}-error`} className="mt-1 text-xs text-red-600" role="alert">
        {error}
      </p>
    )}
  </div>
);

// ============================================================================
// Main Page Component
// ============================================================================

export const OrganizationsManagePage: React.FC = observer(() => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session: authSession } = useAuth();

  const isPlatformOwner = authSession?.claims.org_type === 'platform_owner';
  const userOrgId = authSession?.claims.org_id;

  // Read initial params from URL
  const initialStatus = searchParams.get('status') as 'all' | 'active' | 'inactive' | null;
  const initialOrgId = searchParams.get('orgId');
  const initialMode = searchParams.get('mode'); // 'create' or null

  // List ViewModel
  const [listVM] = useState(() => new OrganizationManageListViewModel());

  // Panel mode — ?mode=create takes precedence over ?orgId= (S7 collision guard)
  const [panelMode, setPanelMode] = useState<PanelMode>(
    initialMode === 'create' ? 'create' : 'empty'
  );

  // Form ViewModel (for edit mode)
  const [formVM, setFormVM] = useState<OrganizationManageFormViewModel | null>(null);

  // Dialog state
  const [dialogState, setDialogState] = useState<DialogState>({ type: 'none' });
  const pendingActionRef = useRef<{ type: 'select'; orgId: string } | null>(null);

  // Error state
  const [operationError, setOperationError] = useState<string | null>(null);

  // Entity form state (for inline add/edit dialogs)
  const [contactForm, setContactForm] = useState<ContactFormState>(EMPTY_CONTACT);
  const [addressForm, setAddressForm] = useState<AddressFormState>(EMPTY_ADDRESS);
  const [phoneForm, setPhoneForm] = useState<PhoneFormState>(EMPTY_PHONE);
  const [entitySubmitting, setEntitySubmitting] = useState(false);

  // Load orgs on mount
  useEffect(() => {
    log.debug('OrganizationsManagePage mounted, loading data');
    if (initialStatus && initialStatus !== 'all') {
      listVM.setStatusFilter(initialStatus);
    }
    listVM.loadOrganizations();
  }, [listVM, initialStatus]);

  // For provider admins, auto-select their org
  useEffect(() => {
    if (
      !isPlatformOwner &&
      userOrgId &&
      !listVM.isLoading &&
      listVM.organizations.length > 0 &&
      panelMode === 'empty'
    ) {
      log.debug('Provider admin: auto-selecting own org', { orgId: userOrgId });
      selectAndLoadOrg(userOrgId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only on load complete
  }, [isPlatformOwner, userOrgId, listVM.isLoading, listVM.organizations.length]);

  // Handle orgId from URL (platform owners) — skip if create mode (S7 collision guard)
  useEffect(() => {
    if (
      initialOrgId &&
      initialMode !== 'create' &&
      isPlatformOwner &&
      !listVM.isLoading &&
      listVM.organizations.length > 0 &&
      panelMode === 'empty'
    ) {
      log.debug('Loading org from URL param', { orgId: initialOrgId });
      selectAndLoadOrg(initialOrgId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [initialOrgId, initialMode, isPlatformOwner, listVM.isLoading, listVM.organizations.length]);

  // Select and load an organization for editing
  const selectAndLoadOrg = useCallback(
    async (orgId: string) => {
      setOperationError(null);
      const newFormVM = new OrganizationManageFormViewModel(orgId, isPlatformOwner);
      await newFormVM.loadDetails();

      if (newFormVM.details) {
        setFormVM(newFormVM);
        setPanelMode('edit');
        listVM.selectOrganization(orgId);
        log.debug('Org loaded for editing', { orgId, name: newFormVM.organization?.name });
      } else {
        setOperationError(newFormVM.submissionError || 'Organization could not be loaded.');
      }
    },
    [isPlatformOwner, listVM]
  );

  // Handle discard changes
  const handleDiscardChanges = useCallback(() => {
    const pending = pendingActionRef.current;
    setDialogState({ type: 'none' });
    pendingActionRef.current = null;

    if (pending?.type === 'select') {
      if (pending.orgId === '__create__') {
        listVM.selectOrganization('');
        setFormVM(null);
        setPanelMode('create');
        setSearchParams({ mode: 'create' }, { replace: true });
      } else if (pending.orgId) {
        selectAndLoadOrg(pending.orgId);
      }
    }
  }, [selectAndLoadOrg, listVM, setSearchParams]);

  // Handle create button click
  const handleCreateClick = useCallback(() => {
    if (formVM?.isDirty) {
      pendingActionRef.current = { type: 'select', orgId: '__create__' };
      setDialogState({ type: 'discard' });
    } else {
      listVM.selectOrganization('');
      setFormVM(null);
      setPanelMode('create');
      // Update URL to reflect create mode
      setSearchParams({ mode: 'create' }, { replace: true });
    }
  }, [formVM, listVM, setSearchParams]);

  // Handle create form success
  const handleCreateSuccess = useCallback(
    (organizationId: string) => {
      navigate(`/organizations/${organizationId}/bootstrap`);
    },
    [navigate]
  );

  // Handle create form cancel
  const handleCreateCancel = useCallback(() => {
    setPanelMode('empty');
  }, []);

  // Handle form submission (update org fields)
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!formVM) return;

      const result = await formVM.submit();

      if (result.success) {
        log.info('Organization updated successfully', { orgId: formVM.orgId });
        await listVM.refresh();
        await formVM.reload();
      } else {
        setOperationError(result.error || 'Failed to update organization');
      }
    },
    [formVM, listVM]
  );

  // Navigation
  const handleBackClick = () => navigate('/organizations');

  // ========================================================================
  // Lifecycle operations (platform owner only)
  // ========================================================================

  const handleDeactivateClick = useCallback(() => {
    if (formVM?.isActive) {
      setOperationError(null);
      setDialogState({ type: 'deactivate', isLoading: false });
    }
  }, [formVM]);

  const handleDeactivateConfirm = useCallback(async () => {
    if (!formVM) return;

    setDialogState({ type: 'deactivate', isLoading: true });
    setOperationError(null);

    const result = await listVM.deactivateOrganization(formVM.orgId, 'Administrative deactivation');

    if (result.success) {
      setDialogState({ type: 'none' });
      log.info('Organization deactivated', { orgId: formVM.orgId });
      await selectAndLoadOrg(formVM.orgId);
    } else {
      setDialogState({ type: 'none' });
      setOperationError(result.error || 'Failed to deactivate organization');
    }
  }, [formVM, listVM, selectAndLoadOrg]);

  const handleReactivateClick = useCallback(() => {
    if (formVM && !formVM.isActive) {
      setOperationError(null);
      setDialogState({ type: 'reactivate', isLoading: false });
    }
  }, [formVM]);

  const handleReactivateConfirm = useCallback(async () => {
    if (!formVM) return;

    setDialogState({ type: 'reactivate', isLoading: true });
    setOperationError(null);

    const result = await listVM.reactivateOrganization(formVM.orgId);

    if (result.success) {
      setDialogState({ type: 'none' });
      log.info('Organization reactivated', { orgId: formVM.orgId });
      await selectAndLoadOrg(formVM.orgId);
    } else {
      setDialogState({ type: 'none' });
      setOperationError(result.error || 'Failed to reactivate organization');
    }
  }, [formVM, listVM, selectAndLoadOrg]);

  const handleDeleteClick = useCallback(() => {
    if (!formVM) return;

    if (formVM.isActive) {
      setDialogState({ type: 'activeWarning' });
    } else {
      setOperationError(null);
      setDialogState({ type: 'delete', isLoading: false });
    }
  }, [formVM]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!formVM) return;

    setDialogState({ type: 'delete', isLoading: true });
    setOperationError(null);

    const result = await listVM.deleteOrganization(formVM.orgId, 'Administrative deletion');

    if (result.success) {
      setDialogState({ type: 'none' });
      log.info('Organization deleted', { orgId: formVM.orgId });
      setPanelMode('empty');
      setFormVM(null);
    } else {
      setDialogState({ type: 'none' });
      setOperationError(result.error || 'Failed to delete organization');
    }
  }, [formVM, listVM]);

  const handleDeactivateFirst = useCallback(() => {
    setDialogState({ type: 'deactivate', isLoading: false });
  }, []);

  // ========================================================================
  // Entity CRUD handlers (contacts, addresses, phones)
  // ========================================================================

  const handleEntityAdd = useCallback((entityType: 'contact' | 'address' | 'phone') => {
    if (entityType === 'contact') {
      setContactForm(EMPTY_CONTACT);
      setDialogState({ type: 'addContact' });
    } else if (entityType === 'address') {
      setAddressForm(EMPTY_ADDRESS);
      setDialogState({ type: 'addAddress' });
    } else {
      setPhoneForm(EMPTY_PHONE);
      setDialogState({ type: 'addPhone' });
    }
  }, []);

  const handleEntityEdit = useCallback(
    (
      entityType: 'contact' | 'address' | 'phone',
      entity: OrganizationContact | OrganizationAddress | OrganizationPhone
    ) => {
      if (entityType === 'contact') {
        const c = entity as OrganizationContact;
        setContactForm({
          label: c.label,
          type: c.type,
          first_name: c.first_name,
          last_name: c.last_name,
          email: c.email,
          title: c.title ?? '',
          department: c.department ?? '',
        });
        setDialogState({ type: 'editContact', contact: c });
      } else if (entityType === 'address') {
        const a = entity as OrganizationAddress;
        setAddressForm({
          label: a.label,
          type: a.type,
          street1: a.street1,
          street2: a.street2 ?? '',
          city: a.city,
          state: a.state,
          zip_code: a.zip_code,
        });
        setDialogState({ type: 'editAddress', address: a });
      } else {
        const p = entity as OrganizationPhone;
        setPhoneForm({
          label: p.label,
          type: p.type,
          number: p.number,
          extension: p.extension ?? '',
        });
        setDialogState({ type: 'editPhone', phone: p });
      }
    },
    []
  );

  const handleContactSave = useCallback(async () => {
    if (!formVM) return;
    setEntitySubmitting(true);

    const data: ContactData = {
      label: contactForm.label,
      type: contactForm.type,
      first_name: contactForm.first_name,
      last_name: contactForm.last_name,
      email: contactForm.email,
      title: contactForm.title || undefined,
      department: contactForm.department || undefined,
    };

    let result;
    if (dialogState.type === 'editContact') {
      result = await formVM.updateContact(dialogState.contact.id, data);
    } else {
      result = await formVM.createContact(data);
    }

    setEntitySubmitting(false);

    if (result.success) {
      setDialogState({ type: 'none' });
    } else {
      setOperationError(result.error || 'Failed to save contact');
    }
  }, [formVM, contactForm, dialogState]);

  const handleAddressSave = useCallback(async () => {
    if (!formVM) return;
    setEntitySubmitting(true);

    const data: AddressData = {
      label: addressForm.label,
      type: addressForm.type,
      street1: addressForm.street1,
      street2: addressForm.street2 || undefined,
      city: addressForm.city,
      state: addressForm.state,
      zip_code: addressForm.zip_code,
    };

    let result;
    if (dialogState.type === 'editAddress') {
      result = await formVM.updateAddress(dialogState.address.id, data);
    } else {
      result = await formVM.createAddress(data);
    }

    setEntitySubmitting(false);

    if (result.success) {
      setDialogState({ type: 'none' });
    } else {
      setOperationError(result.error || 'Failed to save address');
    }
  }, [formVM, addressForm, dialogState]);

  const handlePhoneSave = useCallback(async () => {
    if (!formVM) return;
    setEntitySubmitting(true);

    const data: PhoneData = {
      label: phoneForm.label,
      type: phoneForm.type,
      number: phoneForm.number,
      extension: phoneForm.extension || undefined,
    };

    let result;
    if (dialogState.type === 'editPhone') {
      result = await formVM.updatePhone(dialogState.phone.id, data);
    } else {
      result = await formVM.createPhone(data);
    }

    setEntitySubmitting(false);

    if (result.success) {
      setDialogState({ type: 'none' });
    } else {
      setOperationError(result.error || 'Failed to save phone');
    }
  }, [formVM, phoneForm, dialogState]);

  const handleEntityDelete = useCallback(
    async (entityType: 'contact' | 'address' | 'phone', id: string) => {
      if (!formVM) return;

      let result;
      if (entityType === 'contact') {
        result = await formVM.deleteContact(id, 'Removed by administrator');
      } else if (entityType === 'address') {
        result = await formVM.deleteAddress(id, 'Removed by administrator');
      } else {
        result = await formVM.deletePhone(id, 'Removed by administrator');
      }

      if (!result.success) {
        setOperationError(result.error || `Failed to delete ${entityType}`);
      }
    },
    [formVM]
  );

  // ========================================================================
  // Render helpers
  // ========================================================================

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 p-8"
      data-testid="org-manage-page"
    >
      <div className="max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBackClick}
              className="text-gray-600"
              data-testid="org-manage-back-btn"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              {isPlatformOwner ? 'Back to Organizations' : 'Back'}
            </Button>
            {isPlatformOwner && panelMode !== 'create' && (
              <Button
                className="flex items-center gap-2"
                onClick={handleCreateClick}
                data-testid="org-manage-create-btn"
              >
                <Plus className="w-4 h-4" />
                Create Organization
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Building className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900" data-testid="org-manage-heading">
                Organization Management
              </h1>
              <p className="text-gray-600 mt-1">
                {isPlatformOwner
                  ? 'Manage organizations, lifecycle, and details'
                  : 'Edit your organization details'}
              </p>
            </div>
          </div>
        </div>

        {/* Error Banner */}
        {(listVM.error || operationError) && (
          <div
            className="mb-6 p-4 rounded-lg border border-red-300 bg-red-50"
            role="alert"
            data-testid="org-manage-error-banner"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-red-800 font-semibold">Error</h3>
                <p className="text-red-700 text-sm mt-1">{listVM.error || operationError}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  listVM.clearError();
                  setOperationError(null);
                }}
                className="text-red-600 border-red-300"
                data-testid="org-manage-error-dismiss-btn"
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}

        {/* Form Panel (full-width — list is now on /organizations) */}
        <div>
          <div>
            {/* Empty State */}
            {panelMode === 'empty' && (
              <Card className="shadow-lg" data-testid="org-form-empty-state">
                <CardContent className="p-12 text-center">
                  <Building className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-xl font-medium text-gray-900 mb-2">
                    {isPlatformOwner ? 'No Organization Selected' : 'Loading...'}
                  </h3>
                  <p className="text-gray-500 max-w-md mx-auto">
                    {isPlatformOwner
                      ? 'Select an organization from the list page, or create a new one.'
                      : 'Loading your organization details...'}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Create Mode */}
            {panelMode === 'create' && (
              <OrganizationCreateForm
                onSubmitSuccess={handleCreateSuccess}
                onCancel={handleCreateCancel}
              />
            )}

            {/* Edit Mode */}
            {panelMode === 'edit' && formVM && (
              <div className="space-y-4">
                {/* Inactive Warning Banner */}
                {!formVM.isActive && (
                  <div
                    className="p-4 rounded-lg border border-amber-300 bg-amber-50"
                    data-testid="org-inactive-banner"
                  >
                    <div className="flex items-start gap-3">
                      <XCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h3 className="text-amber-800 font-semibold">
                          Inactive Organization - Editing Disabled
                        </h3>
                        <p className="text-amber-700 text-sm mt-1">
                          This organization is deactivated. The form is read-only until the
                          organization is reactivated.
                          {formVM.organization?.deactivation_reason && (
                            <span className="block mt-1 italic">
                              Reason: {formVM.organization.deactivation_reason}
                            </span>
                          )}
                        </p>
                      </div>
                      {isPlatformOwner && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleReactivateClick}
                          disabled={
                            formVM.isSubmitting ||
                            (dialogState.type === 'reactivate' && dialogState.isLoading)
                          }
                          className="bg-green-600 hover:bg-green-700 text-white flex-shrink-0"
                          data-testid="org-inactive-banner-reactivate-btn"
                        >
                          <CheckCircle className="w-4 h-4 mr-1" />
                          {dialogState.type === 'reactivate' && dialogState.isLoading
                            ? 'Reactivating...'
                            : 'Reactivate'}
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Organization Details Form */}
                <Card className="shadow-lg" data-testid="org-details-card">
                  <CardHeader className="border-b border-gray-200">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xl font-semibold text-gray-900">
                        Organization Details
                      </CardTitle>
                      <span
                        className={cn(
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          formVM.isActive
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-600'
                        )}
                        data-testid="org-details-status-badge"
                      >
                        {formVM.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="p-6">
                    {formVM.isLoading ? (
                      <div
                        className="text-center py-8 text-gray-500"
                        data-testid="org-details-loading"
                      >
                        Loading details...
                      </div>
                    ) : (
                      <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Submission Error */}
                        {formVM.submissionError && (
                          <div
                            className="p-4 rounded-lg border border-red-300 bg-red-50"
                            role="alert"
                            data-testid="org-details-submit-error"
                          >
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
                              <div className="flex-1">
                                <h4 className="text-red-800 font-semibold">
                                  Failed to update organization
                                </h4>
                                <p className="text-red-700 text-sm mt-1">
                                  {formVM.submissionError}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => formVM.clearSubmissionError()}
                                className="text-red-600 hover:text-red-800"
                                aria-label="Dismiss error"
                                data-testid="org-details-submit-error-dismiss-btn"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Org fields */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormField
                            label="Organization Name"
                            id="org-name"
                            value={formVM.formData.name}
                            onChange={(v) => formVM.updateField('name', v)}
                            onBlur={() => formVM.touchField('name')}
                            error={formVM.getFieldError('name')}
                            disabled={!formVM.canEditName}
                            required
                          />
                          <FormField
                            label="Display Name"
                            id="org-display-name"
                            value={formVM.formData.display_name}
                            onChange={(v) => formVM.updateField('display_name', v)}
                            onBlur={() => formVM.touchField('display_name')}
                            error={formVM.getFieldError('display_name')}
                            disabled={!formVM.canEditFields}
                            required
                          />
                          <FormField
                            label="Tax Number"
                            id="org-tax-number"
                            value={formVM.formData.tax_number}
                            onChange={(v) => formVM.updateField('tax_number', v)}
                            onBlur={() => formVM.touchField('tax_number')}
                            error={formVM.getFieldError('tax_number')}
                            disabled={!formVM.canEditFields}
                            placeholder="Optional"
                          />
                          <FormField
                            label="Phone Number"
                            id="org-phone-number"
                            value={formVM.formData.phone_number}
                            onChange={(v) => formVM.updateField('phone_number', v)}
                            onBlur={() => formVM.touchField('phone_number')}
                            error={formVM.getFieldError('phone_number')}
                            disabled={!formVM.canEditFields}
                            placeholder="Optional"
                          />
                          <FormField
                            label="Timezone"
                            id="org-timezone"
                            value={formVM.formData.timezone}
                            onChange={(v) => formVM.updateField('timezone', v)}
                            onBlur={() => formVM.touchField('timezone')}
                            error={formVM.getFieldError('timezone')}
                            disabled={!formVM.canEditFields}
                            required
                          />
                        </div>

                        {/* Read-only fields */}
                        {formVM.organization && (
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-gray-200">
                            <div>
                              <p className="text-xs font-medium text-gray-500 uppercase">Slug</p>
                              <p
                                className="text-sm text-gray-700 mt-0.5"
                                data-testid="org-field-slug-value"
                              >
                                {formVM.organization.slug}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-gray-500 uppercase">Type</p>
                              <p
                                className="text-sm text-gray-700 mt-0.5"
                                data-testid="org-field-type-value"
                              >
                                {formVM.organization.type}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-gray-500 uppercase">Path</p>
                              <p
                                className="text-sm text-gray-700 mt-0.5 font-mono text-xs"
                                data-testid="org-field-path-value"
                              >
                                {formVM.organization.path}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Form Actions */}
                        <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                          <div>
                            {formVM.isDirty && (
                              <span
                                className="text-sm text-amber-600"
                                data-testid="org-form-unsaved-indicator"
                              >
                                Unsaved changes
                              </span>
                            )}
                          </div>
                          <div className="flex gap-2">
                            {formVM.isDirty && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => formVM.reset()}
                                disabled={formVM.isSubmitting}
                                data-testid="org-form-reset-btn"
                              >
                                Reset
                              </Button>
                            )}
                            <Button
                              type="submit"
                              disabled={!formVM.canSubmit}
                              className="bg-blue-600 hover:bg-blue-700 text-white"
                              data-testid="org-form-save-btn"
                            >
                              <Save className="w-4 h-4 mr-1" />
                              {formVM.isSubmitting ? 'Saving...' : 'Save Changes'}
                            </Button>
                          </div>
                        </div>
                      </form>
                    )}
                  </CardContent>
                </Card>

                {/* Contacts Section */}
                <EntitySection
                  title="Contacts"
                  icon={<User className="w-5 h-5 text-blue-600" />}
                  canEdit={formVM.canEditFields}
                  onAdd={() => handleEntityAdd('contact')}
                  data-testid="org-contacts-section"
                >
                  {formVM.contacts.length === 0 ? (
                    <p
                      className="text-sm text-gray-500 py-4 text-center"
                      data-testid="org-contacts-empty"
                    >
                      No contacts yet
                    </p>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {formVM.contacts.map((c) => (
                        <div
                          key={c.id}
                          className="py-3 flex items-start justify-between"
                          data-testid={`org-contact-row-${c.id}`}
                        >
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {c.first_name} {c.last_name}
                              {c.is_primary && (
                                <span className="ml-2 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                                  Primary
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-gray-500">
                              {c.email} · {c.label} ({c.type})
                            </p>
                            {c.title && <p className="text-xs text-gray-400">{c.title}</p>}
                          </div>
                          {formVM.canEditFields && (
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => handleEntityEdit('contact', c)}
                                className="p-1 text-gray-400 hover:text-blue-600"
                                aria-label={`Edit contact ${c.first_name} ${c.last_name}`}
                                data-testid={`org-contact-edit-btn-${c.id}`}
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleEntityDelete('contact', c.id)}
                                className="p-1 text-gray-400 hover:text-red-600"
                                aria-label={`Delete contact ${c.first_name} ${c.last_name}`}
                                data-testid={`org-contact-delete-btn-${c.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </EntitySection>

                {/* Addresses Section */}
                <EntitySection
                  title="Addresses"
                  icon={<MapPin className="w-5 h-5 text-blue-600" />}
                  canEdit={formVM.canEditFields}
                  onAdd={() => handleEntityAdd('address')}
                  data-testid="org-addresses-section"
                >
                  {formVM.addresses.length === 0 ? (
                    <p
                      className="text-sm text-gray-500 py-4 text-center"
                      data-testid="org-addresses-empty"
                    >
                      No addresses yet
                    </p>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {formVM.addresses.map((a) => (
                        <div
                          key={a.id}
                          className="py-3 flex items-start justify-between"
                          data-testid={`org-address-row-${a.id}`}
                        >
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {a.label}
                              {a.is_primary && (
                                <span className="ml-2 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                                  Primary
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-gray-500">
                              {a.street1}
                              {a.street2 && `, ${a.street2}`}
                            </p>
                            <p className="text-xs text-gray-500">
                              {a.city}, {a.state} {a.zip_code}
                            </p>
                          </div>
                          {formVM.canEditFields && (
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => handleEntityEdit('address', a)}
                                className="p-1 text-gray-400 hover:text-blue-600"
                                aria-label={`Edit address ${a.label}`}
                                data-testid={`org-address-edit-btn-${a.id}`}
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleEntityDelete('address', a.id)}
                                className="p-1 text-gray-400 hover:text-red-600"
                                aria-label={`Delete address ${a.label}`}
                                data-testid={`org-address-delete-btn-${a.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </EntitySection>

                {/* Phones Section */}
                <EntitySection
                  title="Phones"
                  icon={<Phone className="w-5 h-5 text-blue-600" />}
                  canEdit={formVM.canEditFields}
                  onAdd={() => handleEntityAdd('phone')}
                  data-testid="org-phones-section"
                >
                  {formVM.phones.length === 0 ? (
                    <p
                      className="text-sm text-gray-500 py-4 text-center"
                      data-testid="org-phones-empty"
                    >
                      No phones yet
                    </p>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {formVM.phones.map((p) => (
                        <div
                          key={p.id}
                          className="py-3 flex items-start justify-between"
                          data-testid={`org-phone-row-${p.id}`}
                        >
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {p.label}
                              {p.is_primary && (
                                <span className="ml-2 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                                  Primary
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-gray-500">
                              {p.number}
                              {p.extension && ` ext. ${p.extension}`}
                              {' · '}
                              {p.type}
                            </p>
                          </div>
                          {formVM.canEditFields && (
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => handleEntityEdit('phone', p)}
                                className="p-1 text-gray-400 hover:text-blue-600"
                                aria-label={`Edit phone ${p.label}`}
                                data-testid={`org-phone-edit-btn-${p.id}`}
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleEntityDelete('phone', p.id)}
                                className="p-1 text-gray-400 hover:text-red-600"
                                aria-label={`Delete phone ${p.label}`}
                                data-testid={`org-phone-delete-btn-${p.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </EntitySection>

                {/* Danger Zone (platform owner only) */}
                {isPlatformOwner && (
                  <DangerZone
                    entityType="Organization"
                    isActive={formVM.isActive}
                    isSubmitting={formVM.isSubmitting}
                    canDeactivate={true}
                    onDeactivate={handleDeactivateClick}
                    isDeactivating={dialogState.type === 'deactivate' && dialogState.isLoading}
                    deactivateDescription="Deactivating blocks all users in this organization. They will see an access blocked page within ~1 hour (JWT refresh window)."
                    canReactivate={true}
                    onReactivate={handleReactivateClick}
                    isReactivating={dialogState.type === 'reactivate' && dialogState.isLoading}
                    reactivateDescription="Reactivating restores access for all users in this organization."
                    canDelete={true}
                    onDelete={handleDeleteClick}
                    isDeleting={dialogState.type === 'delete' && dialogState.isLoading}
                    deleteDescription="Permanently soft-delete this organization. A Temporal workflow will revoke invitations, remove DNS, and deactivate users."
                    activeDeleteConstraint="Must be deactivated before deletion."
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* Dialogs */}
      {/* ============================================================ */}

      {/* Unsaved Changes Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'discard'}
        title="Unsaved Changes"
        message="You have unsaved changes. Do you want to discard them?"
        confirmLabel="Discard Changes"
        cancelLabel="Stay Here"
        onConfirm={handleDiscardChanges}
        onCancel={() => {
          setDialogState({ type: 'none' });
          pendingActionRef.current = null;
        }}
        variant="warning"
      />

      {/* Deactivate Confirmation */}
      <ConfirmDialog
        isOpen={dialogState.type === 'deactivate'}
        title="Deactivate Organization"
        message={`Are you sure you want to deactivate "${formVM?.organization?.display_name || formVM?.organization?.name}"? All users will be blocked from accessing the system.`}
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        onConfirm={handleDeactivateConfirm}
        onCancel={() => setDialogState({ type: 'none' })}
        isLoading={dialogState.type === 'deactivate' && dialogState.isLoading}
        variant="warning"
      />

      {/* Reactivate Confirmation */}
      <ConfirmDialog
        isOpen={dialogState.type === 'reactivate'}
        title="Reactivate Organization"
        message={`Are you sure you want to reactivate "${formVM?.organization?.display_name || formVM?.organization?.name}"? User access will be restored.`}
        confirmLabel="Reactivate"
        cancelLabel="Cancel"
        onConfirm={handleReactivateConfirm}
        onCancel={() => setDialogState({ type: 'none' })}
        isLoading={dialogState.type === 'reactivate' && dialogState.isLoading}
        variant="success"
      />

      {/* Active Warning Dialog */}
      <ConfirmDialog
        isOpen={dialogState.type === 'activeWarning'}
        title="Cannot Delete Active Organization"
        message={`"${formVM?.organization?.display_name || formVM?.organization?.name}" must be deactivated before it can be deleted. Would you like to deactivate it now?`}
        confirmLabel="Deactivate First"
        cancelLabel="Cancel"
        onConfirm={handleDeactivateFirst}
        onCancel={() => setDialogState({ type: 'none' })}
        variant="warning"
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={dialogState.type === 'delete'}
        title="Delete Organization"
        message={`Are you sure you want to delete "${formVM?.organization?.display_name || formVM?.organization?.name}"? This will trigger a deletion workflow that revokes invitations, removes DNS, and deactivates all users.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDialogState({ type: 'none' })}
        isLoading={dialogState.type === 'delete' && dialogState.isLoading}
        variant="danger"
        requireConfirmText="DELETE"
      />

      {/* Contact Add/Edit Dialog */}
      {(dialogState.type === 'addContact' || dialogState.type === 'editContact') && (
        <EntityFormDialog
          title={dialogState.type === 'addContact' ? 'Add Contact' : 'Edit Contact'}
          onSave={handleContactSave}
          onCancel={() => setDialogState({ type: 'none' })}
          isSubmitting={entitySubmitting}
          data-testid="contact-dialog"
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                label="First Name"
                id="contact-first-name"
                value={contactForm.first_name}
                onChange={(v) => setContactForm((p) => ({ ...p, first_name: v }))}
                required
              />
              <FormField
                label="Last Name"
                id="contact-last-name"
                value={contactForm.last_name}
                onChange={(v) => setContactForm((p) => ({ ...p, last_name: v }))}
                required
              />
            </div>
            <FormField
              label="Email"
              id="contact-email"
              value={contactForm.email}
              onChange={(v) => setContactForm((p) => ({ ...p, email: v }))}
              required
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                label="Label"
                id="contact-label"
                value={contactForm.label}
                onChange={(v) => setContactForm((p) => ({ ...p, label: v }))}
                required
                placeholder="e.g., Billing Contact"
              />
              <div>
                <label
                  htmlFor="contact-type"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Type
                </label>
                <select
                  id="contact-type"
                  value={contactForm.type}
                  onChange={(e) => setContactForm((p) => ({ ...p, type: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="administrative">Administrative</option>
                  <option value="billing">Billing</option>
                  <option value="technical">Technical</option>
                  <option value="emergency">Emergency</option>
                  <option value="stakeholder">Stakeholder</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                label="Title"
                id="contact-title"
                value={contactForm.title}
                onChange={(v) => setContactForm((p) => ({ ...p, title: v }))}
                placeholder="Optional"
              />
              <FormField
                label="Department"
                id="contact-department"
                value={contactForm.department}
                onChange={(v) => setContactForm((p) => ({ ...p, department: v }))}
                placeholder="Optional"
              />
            </div>
          </div>
        </EntityFormDialog>
      )}

      {/* Address Add/Edit Dialog */}
      {(dialogState.type === 'addAddress' || dialogState.type === 'editAddress') && (
        <EntityFormDialog
          title={dialogState.type === 'addAddress' ? 'Add Address' : 'Edit Address'}
          onSave={handleAddressSave}
          onCancel={() => setDialogState({ type: 'none' })}
          isSubmitting={entitySubmitting}
          data-testid="address-dialog"
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                label="Label"
                id="address-label"
                value={addressForm.label}
                onChange={(v) => setAddressForm((p) => ({ ...p, label: v }))}
                required
                placeholder="e.g., Headquarters"
              />
              <div>
                <label
                  htmlFor="address-type"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Type
                </label>
                <select
                  id="address-type"
                  value={addressForm.type}
                  onChange={(e) => setAddressForm((p) => ({ ...p, type: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="physical">Physical</option>
                  <option value="mailing">Mailing</option>
                  <option value="billing">Billing</option>
                </select>
              </div>
            </div>
            <FormField
              label="Street 1"
              id="address-street1"
              value={addressForm.street1}
              onChange={(v) => setAddressForm((p) => ({ ...p, street1: v }))}
              required
            />
            <FormField
              label="Street 2"
              id="address-street2"
              value={addressForm.street2}
              onChange={(v) => setAddressForm((p) => ({ ...p, street2: v }))}
              placeholder="Optional"
            />
            <div className="grid grid-cols-3 gap-3">
              <FormField
                label="City"
                id="address-city"
                value={addressForm.city}
                onChange={(v) => setAddressForm((p) => ({ ...p, city: v }))}
                required
              />
              <FormField
                label="State"
                id="address-state"
                value={addressForm.state}
                onChange={(v) => setAddressForm((p) => ({ ...p, state: v }))}
                required
              />
              <FormField
                label="ZIP Code"
                id="address-zip"
                value={addressForm.zip_code}
                onChange={(v) => setAddressForm((p) => ({ ...p, zip_code: v }))}
                required
              />
            </div>
          </div>
        </EntityFormDialog>
      )}

      {/* Phone Add/Edit Dialog */}
      {(dialogState.type === 'addPhone' || dialogState.type === 'editPhone') && (
        <EntityFormDialog
          title={dialogState.type === 'addPhone' ? 'Add Phone' : 'Edit Phone'}
          onSave={handlePhoneSave}
          onCancel={() => setDialogState({ type: 'none' })}
          isSubmitting={entitySubmitting}
          data-testid="phone-dialog"
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                label="Label"
                id="phone-label"
                value={phoneForm.label}
                onChange={(v) => setPhoneForm((p) => ({ ...p, label: v }))}
                required
                placeholder="e.g., Main Office"
              />
              <div>
                <label
                  htmlFor="phone-type"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Type
                </label>
                <select
                  id="phone-type"
                  value={phoneForm.type}
                  onChange={(e) => setPhoneForm((p) => ({ ...p, type: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="office">Office</option>
                  <option value="mobile">Mobile</option>
                  <option value="fax">Fax</option>
                  <option value="emergency">Emergency</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                label="Number"
                id="phone-number"
                value={phoneForm.number}
                onChange={(v) => setPhoneForm((p) => ({ ...p, number: v }))}
                required
              />
              <FormField
                label="Extension"
                id="phone-extension"
                value={phoneForm.extension}
                onChange={(v) => setPhoneForm((p) => ({ ...p, extension: v }))}
                placeholder="Optional"
              />
            </div>
          </div>
        </EntityFormDialog>
      )}
    </div>
  );
});

// ============================================================================
// Shared sub-components
// ============================================================================

/** Entity section card (contacts, addresses, phones) */
const EntitySection: React.FC<{
  title: string;
  icon: React.ReactNode;
  canEdit: boolean;
  onAdd: () => void;
  children: React.ReactNode;
  'data-testid'?: string;
}> = ({ title, icon, canEdit, onAdd, children, 'data-testid': testId }) => (
  <Card className="shadow-lg" data-testid={testId}>
    <CardHeader className="border-b border-gray-200 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <CardTitle className="text-base font-semibold text-gray-900">{title}</CardTitle>
        </div>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            onClick={onAdd}
            className="text-blue-600 border-blue-300 hover:bg-blue-50"
            data-testid={testId ? `${testId.replace('-section', '')}-add-btn` : undefined}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Add
          </Button>
        )}
      </div>
    </CardHeader>
    <CardContent className="p-4">{children}</CardContent>
  </Card>
);

/** Entity form dialog (modal for add/edit contact/address/phone) */
const EntityFormDialog: React.FC<{
  title: string;
  onSave: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
  children: React.ReactNode;
  'data-testid'?: string;
}> = ({ title, onSave, onCancel, isSubmitting, children, 'data-testid': testId }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center"
    role="dialog"
    aria-modal="true"
    aria-labelledby="entity-dialog-title"
    data-testid={testId}
  >
    <div className="absolute inset-0 bg-black/50" onClick={onCancel} aria-hidden="true" />
    <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3
          id="entity-dialog-title"
          className="text-lg font-semibold text-gray-900"
          data-testid={testId ? `${testId}-title` : undefined}
        >
          {title}
        </h3>
        <button
          onClick={onCancel}
          className="text-gray-400 hover:text-gray-600"
          aria-label="Close"
          data-testid={testId ? `${testId}-close-btn` : undefined}
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      {children}
      <div className="mt-6 flex justify-end gap-3">
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
          data-testid={testId ? `${testId}-cancel-btn` : undefined}
        >
          Cancel
        </Button>
        <Button
          className="bg-blue-600 hover:bg-blue-700 text-white"
          onClick={onSave}
          disabled={isSubmitting}
          data-testid={testId ? `${testId}-save-btn` : undefined}
        >
          {isSubmitting ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  </div>
);

export default OrganizationsManagePage;
