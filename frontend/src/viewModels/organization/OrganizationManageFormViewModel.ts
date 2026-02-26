/**
 * Organization Manage Form ViewModel
 *
 * Manages state and business logic for the organization edit form.
 * Handles organization fields, contacts, addresses, and phones.
 *
 * Features:
 * - Form state management for organization detail editing
 * - Role-based field editability (platform owner vs provider admin)
 * - Contact/address/phone CRUD via entity service
 * - Field validation with error messages
 * - Dirty tracking and form reset
 *
 * Dependencies:
 * - IOrganizationQueryService: Load organization details
 * - IOrganizationCommandService: Update organization
 * - IOrganizationEntityService: Contact/address/phone CRUD
 *
 * @see IOrganizationCommandService
 * @see IOrganizationEntityService
 * @see OrganizationManageListViewModel for list state
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { Logger } from '@/utils/logger';
import type { IOrganizationQueryService } from '@/services/organization/IOrganizationQueryService';
import type { IOrganizationCommandService } from '@/services/organization/IOrganizationCommandService';
import type { IOrganizationEntityService } from '@/services/organization/IOrganizationEntityService';
import { getOrganizationQueryService } from '@/services/organization/OrganizationQueryServiceFactory';
import { getOrganizationCommandService } from '@/services/organization/OrganizationCommandServiceFactory';
import { getOrganizationEntityService } from '@/services/organization/OrganizationEntityServiceFactory';
import type {
  OrganizationDetails,
  OrganizationDetailRecord,
  OrganizationContact,
  OrganizationAddress,
  OrganizationPhone,
  OrganizationUpdateData,
  OrganizationOperationResult,
  OrganizationEntityResult,
  ContactData,
  AddressData,
  PhoneData,
} from '@/types/organization.types';

const log = Logger.getLogger('viewmodel');

/**
 * Editable organization fields (subset of OrganizationDetailRecord)
 */
export interface OrganizationFormFields {
  name: string;
  display_name: string;
  tax_number: string;
  phone_number: string;
  timezone: string;
}

type FormFieldKey = keyof OrganizationFormFields;

/**
 * Organization Manage Form ViewModel
 *
 * MVVM pattern with constructor injection for dependency inversion.
 * Handles the edit form for organization details and child entities.
 */
export class OrganizationManageFormViewModel {
  // ============================================
  // Observable State
  // ============================================

  /** Full organization details (including child entities) */
  details: OrganizationDetails | null = null;

  /** Current form data */
  formData: OrganizationFormFields = {
    name: '',
    display_name: '',
    tax_number: '',
    phone_number: '',
    timezone: '',
  };

  /** Original form data (for dirty detection) */
  private originalData: OrganizationFormFields = { ...this.formData };

  /** Validation errors by field */
  errors: Map<FormFieldKey, string> = new Map();

  /** Fields that have been touched */
  touchedFields: Set<FormFieldKey> = new Set();

  /** Form submission in progress */
  isSubmitting = false;

  /** Loading state for initial data load */
  isLoading = false;

  /** Error message from last submission attempt */
  submissionError: string | null = null;

  /** Whether the current user is a platform owner */
  isPlatformOwner = false;

  /** Organization ID being edited */
  readonly orgId: string;

  // ============================================
  // Constructor
  // ============================================

  constructor(
    orgId: string,
    isPlatformOwner: boolean,
    private queryService: IOrganizationQueryService = getOrganizationQueryService(),
    private commandService: IOrganizationCommandService = getOrganizationCommandService(),
    private entityService: IOrganizationEntityService = getOrganizationEntityService()
  ) {
    this.orgId = orgId;
    this.isPlatformOwner = isPlatformOwner;

    makeAutoObservable(this);

    log.debug('OrganizationManageFormViewModel initialized', { orgId, isPlatformOwner });
  }

  // ============================================
  // Computed Properties
  // ============================================

  /** The organization record (from details) */
  get organization(): OrganizationDetailRecord | null {
    return this.details?.organization ?? null;
  }

  /** Contact entities */
  get contacts(): OrganizationContact[] {
    return this.details?.contacts ?? [];
  }

  /** Address entities */
  get addresses(): OrganizationAddress[] {
    return this.details?.addresses ?? [];
  }

  /** Phone entities */
  get phones(): OrganizationPhone[] {
    return this.details?.phones ?? [];
  }

  /** Whether the org is currently active */
  get isActive(): boolean {
    return this.organization?.is_active ?? false;
  }

  /** Whether the org has been soft-deleted */
  get isDeleted(): boolean {
    return this.organization?.deleted_at != null;
  }

  /** Whether the form has unsaved changes */
  get isDirty(): boolean {
    return (Object.keys(this.formData) as FormFieldKey[]).some(
      (key) => this.formData[key] !== this.originalData[key]
    );
  }

  /** Whether the form can be submitted */
  get canSubmit(): boolean {
    return this.isDirty && !this.isSubmitting && this.isActive && this.validateAll();
  }

  /** Whether the form has validation errors */
  get hasErrors(): boolean {
    return this.errors.size > 0;
  }

  /** Whether the name field is editable (platform owners only) */
  get canEditName(): boolean {
    return this.isPlatformOwner && this.isActive;
  }

  /** Whether general fields are editable (active org, any admin) */
  get canEditFields(): boolean {
    return this.isActive;
  }

  // ============================================
  // Actions - Data Loading
  // ============================================

  /** Load organization details */
  async loadDetails(): Promise<void> {
    log.debug('Loading organization details', { orgId: this.orgId });

    runInAction(() => {
      this.isLoading = true;
      this.submissionError = null;
    });

    try {
      const details = await this.queryService.getOrganizationDetails(this.orgId);

      if (!details) {
        runInAction(() => {
          this.isLoading = false;
          this.submissionError = 'Organization not found';
        });
        return;
      }

      runInAction(() => {
        this.details = details;
        this.initializeFormFromDetails(details);
        this.isLoading = false;
        log.info('Loaded organization details', {
          orgId: this.orgId,
          contacts: details.contacts.length,
          addresses: details.addresses.length,
          phones: details.phones.length,
        });
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to load organization details';

      runInAction(() => {
        this.isLoading = false;
        this.submissionError = errorMessage;
      });

      log.error('Failed to load organization details', error);
    }
  }

  /** Initialize form fields from loaded details */
  private initializeFormFromDetails(details: OrganizationDetails): void {
    const org = details.organization;
    this.formData = {
      name: org.name,
      display_name: org.display_name,
      tax_number: org.tax_number ?? '',
      phone_number: org.phone_number ?? '',
      timezone: org.timezone,
    };
    this.originalData = { ...this.formData };
    this.errors.clear();
    this.touchedFields.clear();
    this.submissionError = null;
  }

  /** Reload details (e.g., after entity CRUD) */
  async reload(): Promise<void> {
    await this.loadDetails();
  }

  // ============================================
  // Actions - Field Updates
  // ============================================

  /** Update a form field value */
  updateField(field: FormFieldKey, value: string): void {
    runInAction(() => {
      this.formData[field] = value;
      this.touchedFields.add(field);
      this.submissionError = null;
      this.validateField(field);
    });
  }

  /** Mark a field as touched */
  touchField(field: FormFieldKey): void {
    runInAction(() => {
      this.touchedFields.add(field);
      this.validateField(field);
    });
  }

  /** Mark all fields as touched */
  touchAllFields(): void {
    runInAction(() => {
      (Object.keys(this.formData) as FormFieldKey[]).forEach((field) => {
        this.touchedFields.add(field);
      });
      this.validateAll();
    });
  }

  // ============================================
  // Actions - Validation
  // ============================================

  /** Validate a specific field */
  validateField(field: FormFieldKey): boolean {
    let error: string | null = null;

    switch (field) {
      case 'name':
        if (!this.formData.name.trim()) {
          error = 'Organization name is required';
        } else if (this.formData.name.trim().length < 2) {
          error = 'Name must be at least 2 characters';
        } else if (this.formData.name.trim().length > 100) {
          error = 'Name must be 100 characters or fewer';
        }
        break;

      case 'display_name':
        if (!this.formData.display_name.trim()) {
          error = 'Display name is required';
        } else if (this.formData.display_name.trim().length > 100) {
          error = 'Display name must be 100 characters or fewer';
        }
        break;

      case 'timezone':
        if (!this.formData.timezone.trim()) {
          error = 'Timezone is required';
        }
        break;

      case 'tax_number':
        // Optional field, no validation
        break;

      case 'phone_number':
        // Optional field, but validate format if provided
        if (
          this.formData.phone_number.trim() &&
          !/^[0-9()\-+ .ext]+$/i.test(this.formData.phone_number.trim())
        ) {
          error = 'Invalid phone number format';
        }
        break;
    }

    runInAction(() => {
      if (error) {
        this.errors.set(field, error);
      } else {
        this.errors.delete(field);
      }
    });

    return !error;
  }

  /** Validate all fields */
  validateAll(): boolean {
    const fields: FormFieldKey[] = [
      'name',
      'display_name',
      'timezone',
      'tax_number',
      'phone_number',
    ];
    let allValid = true;

    for (const field of fields) {
      if (!this.validateField(field)) {
        allValid = false;
      }
    }

    return allValid;
  }

  /** Get error message for a specific field */
  getFieldError(field: FormFieldKey): string | null {
    if (!this.touchedFields.has(field)) return null;
    return this.errors.get(field) ?? null;
  }

  /** Check if a field has an error (and has been touched) */
  hasFieldError(field: FormFieldKey): boolean {
    return this.touchedFields.has(field) && this.errors.has(field);
  }

  // ============================================
  // Actions - Submission
  // ============================================

  /** Submit organization field changes */
  async submit(): Promise<OrganizationOperationResult> {
    this.touchAllFields();

    if (!this.validateAll()) {
      log.warn('Form validation failed', { errors: Array.from(this.errors.entries()) });
      return { success: false, error: 'Please fix validation errors before submitting' };
    }

    runInAction(() => {
      this.isSubmitting = true;
      this.submissionError = null;
    });

    try {
      const updateData: OrganizationUpdateData = {
        display_name: this.formData.display_name.trim(),
        tax_number: this.formData.tax_number.trim() || undefined,
        phone_number: this.formData.phone_number.trim() || undefined,
        timezone: this.formData.timezone.trim(),
      };

      // Platform owners can also update the name
      if (this.isPlatformOwner) {
        updateData.name = this.formData.name.trim();
      }

      const result = await this.commandService.updateOrganization(this.orgId, updateData);

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          this.originalData = { ...this.formData };
          log.info('Organization updated successfully', { orgId: this.orgId });
        } else {
          this.submissionError = result.error ?? 'Failed to update organization';
          log.warn('Organization update failed', { error: result.error });
        }
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update organization';

      runInAction(() => {
        this.isSubmitting = false;
        this.submissionError = errorMessage;
      });

      log.error('Organization update error', error);
      return { success: false, error: errorMessage };
    }
  }

  // ============================================
  // Actions - Form Management
  // ============================================

  /** Reset form to original values */
  reset(): void {
    runInAction(() => {
      this.formData = { ...this.originalData };
      this.errors.clear();
      this.touchedFields.clear();
      this.submissionError = null;
      log.debug('Form reset');
    });
  }

  /** Clear submission error */
  clearSubmissionError(): void {
    runInAction(() => {
      this.submissionError = null;
    });
  }

  // ============================================
  // Actions - Contact CRUD
  // ============================================

  /** Create a new contact */
  async createContact(data: ContactData): Promise<OrganizationEntityResult> {
    return this.performEntityOperation('createContact', () =>
      this.entityService.createContact(this.orgId, data)
    );
  }

  /** Update an existing contact */
  async updateContact(
    contactId: string,
    data: Partial<ContactData>
  ): Promise<OrganizationEntityResult> {
    return this.performEntityOperation('updateContact', () =>
      this.entityService.updateContact(contactId, data)
    );
  }

  /** Delete a contact */
  async deleteContact(contactId: string, reason?: string): Promise<OrganizationEntityResult> {
    return this.performEntityOperation('deleteContact', () =>
      this.entityService.deleteContact(contactId, reason)
    );
  }

  // ============================================
  // Actions - Address CRUD
  // ============================================

  /** Create a new address */
  async createAddress(data: AddressData): Promise<OrganizationEntityResult> {
    return this.performEntityOperation('createAddress', () =>
      this.entityService.createAddress(this.orgId, data)
    );
  }

  /** Update an existing address */
  async updateAddress(
    addressId: string,
    data: Partial<AddressData>
  ): Promise<OrganizationEntityResult> {
    return this.performEntityOperation('updateAddress', () =>
      this.entityService.updateAddress(addressId, data)
    );
  }

  /** Delete an address */
  async deleteAddress(addressId: string, reason?: string): Promise<OrganizationEntityResult> {
    return this.performEntityOperation('deleteAddress', () =>
      this.entityService.deleteAddress(addressId, reason)
    );
  }

  // ============================================
  // Actions - Phone CRUD
  // ============================================

  /** Create a new phone */
  async createPhone(data: PhoneData): Promise<OrganizationEntityResult> {
    return this.performEntityOperation('createPhone', () =>
      this.entityService.createPhone(this.orgId, data)
    );
  }

  /** Update an existing phone */
  async updatePhone(phoneId: string, data: Partial<PhoneData>): Promise<OrganizationEntityResult> {
    return this.performEntityOperation('updatePhone', () =>
      this.entityService.updatePhone(phoneId, data)
    );
  }

  /** Delete a phone */
  async deletePhone(phoneId: string, reason?: string): Promise<OrganizationEntityResult> {
    return this.performEntityOperation('deletePhone', () =>
      this.entityService.deletePhone(phoneId, reason)
    );
  }

  // ============================================
  // Private Helpers
  // ============================================

  /** Shared helper for entity CRUD operations — executes, reloads on success */
  private async performEntityOperation(
    operationName: string,
    operation: () => Promise<OrganizationEntityResult>
  ): Promise<OrganizationEntityResult> {
    log.debug(`Entity operation: ${operationName}`, { orgId: this.orgId });

    try {
      const result = await operation();

      if (result.success) {
        await this.reload();
        log.info(`Entity operation succeeded: ${operationName}`, { orgId: this.orgId });
      } else {
        log.warn(`Entity operation failed: ${operationName}`, { error: result.error });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : `Failed to ${operationName}`;
      log.error(`Entity operation error: ${operationName}`, error);
      return { success: false, error: errorMessage };
    }
  }
}
