/**
 * Organization Form ViewModel
 *
 * Manages state and business logic for organization creation form.
 * Uses MobX for reactive state management and dependency injection for services.
 *
 * Features:
 * - Form state management with MobX observables
 * - Auto-save drafts to localStorage
 * - Form validation
 * - Workflow submission
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

import { makeAutoObservable, runInAction } from 'mobx';
import type { IWorkflowClient } from '@/services/workflow/IWorkflowClient';
import { WorkflowClientFactory } from '@/services/workflow/WorkflowClientFactory';
import { OrganizationService } from '@/services/organization/OrganizationService';
import type { OrganizationFormData, OrganizationBootstrapParams } from '@/types';
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
    log.debug('OrganizationFormViewModel initialized');
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
   * Update nested field (e.g., adminContact.email)
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
   * Format and update phone number
   */
  updatePhoneNumber(value: string): void {
    const formatted = formatPhone(value);
    this.updateNestedField('billingPhone.number', formatted);
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
   * Submit form and start workflow
   *
   * Flow:
   * 1. Validate form
   * 2. Transform to workflow parameters
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
      const params: OrganizationBootstrapParams = {
        orgData: {
          name: this.formData.name,
          type: this.formData.type,
          contactEmail: this.formData.adminContact.email
        },
        subdomain: this.formData.subdomain,
        users: [
          {
            email: this.formData.adminContact.email,
            firstName: this.formData.adminContact.firstName,
            lastName: this.formData.adminContact.lastName,
            role: 'provider_admin'
          }
        ]
      };

      log.info('Starting organization bootstrap workflow', {
        orgName: params.orgData.name,
        subdomain: params.subdomain
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
