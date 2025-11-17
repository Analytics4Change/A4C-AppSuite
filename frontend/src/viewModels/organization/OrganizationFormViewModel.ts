/**
 * Organization Form ViewModel
 *
 * Manages state and business logic for organization creation form.
 * Uses MobX for reactive state management and dependency injection for services.
 *
 * Enhanced for Part B Phase 2 (Provider Onboarding Enhancement):
 * - 3-section structure (General Information, Billing, Provider Admin)
 * - "Use General Information" checkbox support (junction links to shared entities)
 * - Dynamic section visibility based on organization type
 * - Referring partner relationship tracking
 *
 * Features:
 * - Form state management with MobX observables
 * - Auto-save drafts to localStorage
 * - Form validation
 * - Workflow submission with arrays (contacts, addresses, phones)
 * - Constructor injection for testability
 *
 * Dependencies:
 * - IWorkflowClient: Workflow operations (MockWorkflowClient | TemporalWorkflowClient)
 * - OrganizationService: Draft management
 *
 * Usage:
 * ```typescript
 * const viewModel = new OrganizationFormViewModel();
 * // Or with mocked dependencies for testing:
 * const viewModel = new OrganizationFormViewModel(mockWorkflowClient, mockOrgService);
 * ```
 */

import { makeAutoObservable, runInAction, reaction } from 'mobx';
import type { IWorkflowClient } from '@/services/workflow/IWorkflowClient';
import { WorkflowClientFactory } from '@/services/workflow/WorkflowClientFactory';
import { OrganizationService } from '@/services/organization/OrganizationService';
import type {
  OrganizationFormData,
  OrganizationBootstrapParams,
  ContactFormData,
  AddressFormData,
  PhoneFormData,
  ContactInfo,
  AddressInfo,
  PhoneInfo
} from '@/types';
import {
  validateOrganizationForm,
  formatPhone,
  formatSubdomain,
  type ValidationError
} from '@/utils/organization-validation';
import { DEFAULT_ORGANIZATION_FORM } from '@/constants';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('viewmodel');

/**
 * Organization Form ViewModel
 *
 * MVVM pattern with constructor injection for dependency inversion.
 * All external dependencies injected via constructor with factory defaults.
 *
 * Part B Enhanced Features:
 * - 3-section form state (General, Billing, Provider Admin)
 * - MobX reactions for "Use General Information" auto-sync
 * - Dynamic section visibility computed properties
 * - Transform methods for workflow parameter array building
 */
export class OrganizationFormViewModel {
  // Form Data (Observable)
  formData: OrganizationFormData = { ...DEFAULT_ORGANIZATION_FORM };

  // Draft Management
  currentDraftId: string | null = null;
  isAutoSaving = false;
  lastSavedAt: Date | null = null;

  // Validation
  validationErrors: ValidationError[] = [];
  touchedFields = new Set<string>();

  // Workflow Submission
  isSubmitting = false;
  submissionError: string | null = null;

  /**
   * Constructor with dependency injection
   *
   * @param workflowClient - Workflow operations (defaults to factory-created instance)
   * @param organizationService - Draft management (defaults to new instance)
   */
  constructor(
    private workflowClient: IWorkflowClient = WorkflowClientFactory.create(),
    private organizationService: OrganizationService = new OrganizationService()
  ) {
    makeAutoObservable(this);

    // MobX reactions for "Use General Information" auto-sync
    this.setupCheckboxReactions();

    log.debug('OrganizationFormViewModel initialized with 3-section structure');
  }

  /**
   * Setup MobX reactions for "Use General Information" checkboxes
   *
   * When checkbox is true, automatically sync address/phone from General Information section.
   * This creates junction links to EXISTING records (shared entities, not duplication).
   */
  private setupCheckboxReactions(): void {
    // Billing Address: Auto-sync from General Information
    reaction(
      () => this.formData.useBillingGeneralAddress,
      (useGeneral) => {
        if (useGeneral) {
          runInAction(() => {
            // Copy values from generalAddress to billingAddress
            this.formData.billingAddress = {
              ...this.formData.generalAddress,
              label: 'Billing Address (from General Info)',
              type: 'billing' // Override type to 'billing'
            };
          });
          log.debug('Billing address synced from General Information');
        }
      }
    );

    // Billing Phone: Auto-sync from General Information
    reaction(
      () => this.formData.useBillingGeneralPhone,
      (useGeneral) => {
        if (useGeneral) {
          runInAction(() => {
            // Copy values from generalPhone to billingPhone
            this.formData.billingPhone = {
              ...this.formData.generalPhone,
              label: 'Billing Phone (from General Info)'
              // Keep type as 'office' from generalPhone
            };
          });
          log.debug('Billing phone synced from General Information');
        }
      }
    );

    // Provider Admin Address: Auto-sync from General Information
    reaction(
      () => this.formData.useProviderAdminGeneralAddress,
      (useGeneral) => {
        if (useGeneral) {
          runInAction(() => {
            // Copy values from generalAddress to providerAdminAddress
            this.formData.providerAdminAddress = {
              ...this.formData.generalAddress,
              label: 'Provider Admin Address (from General Info)',
              type: 'physical' // Keep type as 'physical'
            };
          });
          log.debug('Provider Admin address synced from General Information');
        }
      }
    );

    // Provider Admin Phone: Auto-sync from General Information
    reaction(
      () => this.formData.useProviderAdminGeneralPhone,
      (useGeneral) => {
        if (useGeneral) {
          runInAction(() => {
            // Copy values from generalPhone to providerAdminPhone
            this.formData.providerAdminPhone = {
              ...this.formData.generalPhone,
              label: 'Provider Admin Phone (from General Info)'
              // Keep type as 'office' from generalPhone
            };
          });
          log.debug('Provider Admin phone synced from General Information');
        }
      }
    );
  }

  /**
   * Load draft by ID
   */
  loadDraft(draftId: string): boolean {
    const draft = this.organizationService.loadDraft(draftId);

    if (!draft) {
      log.warn('Draft not found', { draftId });
      return false;
    }

    runInAction(() => {
      this.formData = { ...draft };
      this.currentDraftId = draftId;
      this.lastSavedAt = draft.updatedAt || null;
      log.info('Draft loaded', { draftId, orgName: draft.name });
    });

    return true;
  }

  /**
   * Save current form as draft
   */
  saveDraft(): void {
    try {
      this.isAutoSaving = true;

      const draftId = this.organizationService.saveDraft(
        this.formData,
        this.currentDraftId || undefined
      );

      runInAction(() => {
        this.currentDraftId = draftId;
        this.lastSavedAt = new Date();
        this.isAutoSaving = false;
        log.debug('Draft saved', { draftId });
      });
    } catch (error) {
      runInAction(() => {
        this.isAutoSaving = false;
      });
      log.error('Failed to save draft', error);
    }
  }

  /**
   * Auto-save draft (debounced, called from UI)
   */
  autoSaveDraft(): void {
    // UI should debounce this call (500ms recommended)
    this.saveDraft();
  }

  /**
   * Delete current draft
   */
  deleteDraft(): boolean {
    if (!this.currentDraftId) {
      return false;
    }

    const deleted = this.organizationService.deleteDraft(this.currentDraftId);

    if (deleted) {
      runInAction(() => {
        this.currentDraftId = null;
        this.resetForm();
        log.info('Draft deleted');
      });
    }

    return deleted;
  }

  /**
   * Reset form to default values
   */
  resetForm(): void {
    runInAction(() => {
      this.formData = { ...DEFAULT_ORGANIZATION_FORM };
      this.currentDraftId = null;
      this.validationErrors = [];
      this.touchedFields.clear();
      this.submissionError = null;
      log.debug('Form reset');
    });
  }

  /**
   * Update form field
   */
  updateField<K extends keyof OrganizationFormData>(
    field: K,
    value: OrganizationFormData[K]
  ): void {
    runInAction(() => {
      this.formData[field] = value;
      this.touchedFields.add(field as string);
    });
  }

  /**
   * Update nested field (e.g., generalAddress.street1)
   */
  updateNestedField(path: string, value: any): void {
    runInAction(() => {
      const parts = path.split('.');
      let obj: any = this.formData;

      for (let i = 0; i < parts.length - 1; i++) {
        obj = obj[parts[i]];
      }

      obj[parts[parts.length - 1]] = value;
      this.touchedFields.add(path);
    });
  }

  /**
   * Format and update subdomain
   */
  updateSubdomain(value: string): void {
    const formatted = formatSubdomain(value);
    this.updateField('subdomain', formatted);
  }

  /**
   * Validate form
   */
  validate(): boolean {
    const result = validateOrganizationForm(this.formData);

    runInAction(() => {
      this.validationErrors = result.errors;
    });

    return result.isValid;
  }

  /**
   * Transform ContactFormData to ContactInfo (for workflow)
   */
  private transformContact(contact: ContactFormData): ContactInfo {
    return {
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      title: contact.title || undefined,
      department: contact.department || undefined,
      type: contact.type,
      label: contact.label
    };
  }

  /**
   * Transform AddressFormData to AddressInfo (for workflow)
   */
  private transformAddress(address: AddressFormData): AddressInfo {
    return {
      street1: address.street1,
      street2: address.street2 || undefined,
      city: address.city,
      state: address.state,
      zipCode: address.zipCode,
      type: address.type,
      label: address.label
    };
  }

  /**
   * Transform PhoneFormData to PhoneInfo (for workflow)
   */
  private transformPhone(phone: PhoneFormData): PhoneInfo {
    return {
      number: phone.number,
      extension: phone.extension || undefined,
      type: phone.type,
      label: phone.label
    };
  }

  /**
   * Transform form data to workflow parameters
   *
   * Builds arrays for contacts, addresses, phones based on organization type:
   * - Provider: All 3 sections (General, Billing, Provider Admin)
   * - Partner: 2 sections only (General, Provider Admin - no Billing)
   *
   * @returns Workflow parameters ready for Temporal
   */
  private transformToWorkflowParams(): OrganizationBootstrapParams {
    const isProvider = this.formData.type === 'provider';

    // Build contacts array (Billing + Provider Admin)
    const contacts: ContactInfo[] = [];
    if (isProvider) {
      contacts.push(this.transformContact(this.formData.billingContact));
    }
    contacts.push(this.transformContact(this.formData.providerAdminContact));

    // Build addresses array (General + Billing + Provider Admin)
    const addresses: AddressInfo[] = [
      this.transformAddress(this.formData.generalAddress)
    ];
    if (isProvider) {
      addresses.push(this.transformAddress(this.formData.billingAddress));
    }
    addresses.push(this.transformAddress(this.formData.providerAdminAddress));

    // Build phones array (General + Billing + Provider Admin)
    const phones: PhoneInfo[] = [
      this.transformPhone(this.formData.generalPhone)
    ];
    if (isProvider) {
      phones.push(this.transformPhone(this.formData.billingPhone));
    }
    phones.push(this.transformPhone(this.formData.providerAdminPhone));

    return {
      orgData: {
        name: this.formData.name,
        displayName: this.formData.displayName,
        type: this.formData.type,
        timeZone: this.formData.timeZone,
        referringPartnerId: this.formData.referringPartnerId,
        partnerType: this.formData.partnerType
      },
      subdomain: this.formData.subdomain || undefined, // Optional for stakeholder partners
      contacts,
      addresses,
      phones
    };
  }

  /**
   * Submit form and start workflow
   *
   * Flow:
   * 1. Validate form
   * 2. Transform to workflow parameters (arrays)
   * 3. Call workflow client (Mock or Temporal)
   * 4. Workflow emits domain events
   * 5. PostgreSQL triggers update projections
   * 6. Return workflow ID for status tracking
   *
   * @returns Workflow ID or null if validation failed
   */
  async submit(): Promise<string | null> {
    // Validate first
    if (!this.validate()) {
      log.warn('Form validation failed', {
        errorCount: this.validationErrors.length
      });
      return null;
    }

    try {
      runInAction(() => {
        this.isSubmitting = true;
        this.submissionError = null;
      });

      // Transform form data to workflow parameters
      const params = this.transformToWorkflowParams();

      log.info('Starting organization bootstrap workflow', {
        orgName: params.orgData.name,
        subdomain: params.subdomain,
        contactCount: params.contacts.length,
        addressCount: params.addresses.length,
        phoneCount: params.phones.length
      });

      // Start workflow (emits events, does NOT write to DB directly)
      const workflowId = await this.workflowClient.startBootstrapWorkflow(params);

      runInAction(() => {
        this.formData.workflowId = workflowId;
        this.formData.status = 'running';
        this.isSubmitting = false;
      });

      // Delete draft after successful submission
      if (this.currentDraftId) {
        this.organizationService.deleteDraft(this.currentDraftId);
        this.currentDraftId = null;
      }

      log.info('Workflow started successfully', { workflowId });

      return workflowId;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to submit organization';

      runInAction(() => {
        this.isSubmitting = false;
        this.submissionError = errorMessage;
      });

      log.error('Failed to submit organization', error);

      return null;
    }
  }

  /**
   * Get error for specific field
   */
  getFieldError(field: string): string | null {
    if (!this.touchedFields.has(field)) {
      return null;
    }

    const error = this.validationErrors.find((e) => e.field === field);
    return error ? error.message : null;
  }

  /**
   * Check if field has error
   */
  hasFieldError(field: string): boolean {
    return (
      this.touchedFields.has(field) &&
      this.validationErrors.some((e) => e.field === field)
    );
  }

  /**
   * Computed: Is subdomain required based on org type and partner type
   *
   * Rules:
   * - Providers: subdomain REQUIRED
   * - VAR partners: subdomain REQUIRED (portal access)
   * - Stakeholder partners (family/court/other): subdomain NOT required
   */
  get isSubdomainRequired(): boolean {
    if (this.formData.type === 'provider') {
      return true;
    }

    if (this.formData.type === 'provider_partner') {
      return this.formData.partnerType === 'var';
    }

    return false;
  }

  /**
   * Computed: Is Billing section visible
   *
   * Only providers have billing relationships with A4C.
   * Partners don't need Billing section (they refer business, don't bill).
   */
  get isBillingSectionVisible(): boolean {
    return this.formData.type === 'provider';
  }

  /**
   * Computed: Is form valid
   */
  get isValid(): boolean {
    return this.validationErrors.length === 0;
  }

  /**
   * Computed: Is form dirty (has changes)
   */
  get isDirty(): boolean {
    return this.touchedFields.size > 0;
  }

  /**
   * Computed: Can submit
   */
  get canSubmit(): boolean {
    return this.isDirty && !this.isSubmitting;
  }
}
