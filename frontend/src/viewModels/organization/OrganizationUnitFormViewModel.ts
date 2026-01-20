/**
 * Organization Unit Form ViewModel
 *
 * Manages state and business logic for organizational unit create/edit forms.
 * Uses MobX for reactive state management and dependency injection for services.
 *
 * Features:
 * - Form state management for create and edit modes
 * - Field validation with error messages
 * - Submit handling with async operations
 * - Dirty tracking and form reset
 *
 * Dependencies:
 * - IOrganizationUnitService: CRUD operations (MockOrganizationUnitService | SupabaseOrganizationUnitService)
 *
 * Usage:
 * ```typescript
 * // Create mode
 * const viewModel = new OrganizationUnitFormViewModel(service, 'create');
 *
 * // Edit mode with existing unit
 * const viewModel = new OrganizationUnitFormViewModel(service, 'edit', existingUnit);
 * ```
 *
 * @see IOrganizationUnitService
 * @see OrganizationUnitsViewModel for tree state
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { Logger } from '@/utils/logger';
import type { IOrganizationUnitService } from '@/services/organization/IOrganizationUnitService';
import { getOrganizationUnitService } from '@/services/organization/OrganizationUnitServiceFactory';
import type {
  OrganizationUnit,
  CreateOrganizationUnitRequest,
  UpdateOrganizationUnitRequest,
  OrganizationUnitOperationResult,
} from '@/types/organization-unit.types';

const log = Logger.getLogger('viewmodel');

/**
 * Form mode: create new unit or edit existing
 */
export type FormMode = 'create' | 'edit';

/**
 * Form data structure for organizational unit
 */
export interface OrganizationUnitFormData {
  /** Unit name (required, used for path generation) */
  name: string;

  /** Human-readable display name (required) */
  displayName: string;

  /** Parent unit ID (null = direct child of root org) */
  parentId: string | null;

  /** Unit's timezone (optional, inherits from parent if not specified) */
  timeZone: string;

  /** Whether the unit is active (edit mode only) */
  isActive: boolean;
}

/**
 * Validation error structure
 */
export interface FormValidationError {
  field: keyof OrganizationUnitFormData;
  message: string;
}

/**
 * Default form values for new unit
 */
const DEFAULT_FORM_DATA: OrganizationUnitFormData = {
  name: '',
  displayName: '',
  parentId: null,
  timeZone: 'America/New_York',
  isActive: true,
};

/**
 * Organization Unit Form ViewModel
 *
 * MVVM pattern with constructor injection for dependency inversion.
 * Handles form state for both create and edit modes.
 */
export class OrganizationUnitFormViewModel {
  // ============================================
  // Observable State
  // ============================================

  /** Current form data */
  formData: OrganizationUnitFormData;

  /** Original form data (for dirty detection in edit mode) */
  private originalData: OrganizationUnitFormData;

  /** Validation errors by field */
  errors: Map<keyof OrganizationUnitFormData, string> = new Map();

  /** Fields that have been touched (for showing errors) */
  touchedFields: Set<keyof OrganizationUnitFormData> = new Set();

  /** Form submission in progress */
  isSubmitting = false;

  /** Error message from last submission attempt */
  submissionError: string | null = null;

  /** Form mode (create or edit) */
  readonly mode: FormMode;

  /** Unit ID being edited (edit mode only) */
  readonly editingUnitId: string | null;

  // ============================================
  // Constructor
  // ============================================

  /**
   * Constructor with dependency injection
   *
   * @param service - Organization unit service (defaults to factory-created instance)
   * @param mode - Form mode (create or edit)
   * @param existingUnit - Existing unit to edit (required for edit mode)
   */
  constructor(
    private service: IOrganizationUnitService = getOrganizationUnitService(),
    mode: FormMode = 'create',
    existingUnit?: OrganizationUnit
  ) {
    this.mode = mode;
    this.editingUnitId = existingUnit?.id ?? null;

    // Initialize form data based on mode
    if (mode === 'edit' && existingUnit) {
      this.formData = {
        name: existingUnit.name,
        displayName: existingUnit.displayName,
        parentId: existingUnit.parentId,
        timeZone: existingUnit.timeZone,
        isActive: existingUnit.isActive,
      };
    } else {
      this.formData = { ...DEFAULT_FORM_DATA };
    }

    // Store original for dirty tracking
    this.originalData = { ...this.formData };

    makeAutoObservable(this);

    log.debug('OrganizationUnitFormViewModel initialized', {
      mode,
      editingUnitId: this.editingUnitId,
    });
  }

  // ============================================
  // Computed Properties
  // ============================================

  /**
   * Whether the form has validation errors
   */
  get hasErrors(): boolean {
    return this.errors.size > 0;
  }

  /**
   * Whether the form is valid (no errors)
   */
  get isValid(): boolean {
    // Run validation and check result
    return this.validateAll();
  }

  /**
   * Whether the form has unsaved changes
   */
  get isDirty(): boolean {
    return (
      this.formData.name !== this.originalData.name ||
      this.formData.displayName !== this.originalData.displayName ||
      this.formData.parentId !== this.originalData.parentId ||
      this.formData.timeZone !== this.originalData.timeZone ||
      this.formData.isActive !== this.originalData.isActive
    );
  }

  /**
   * Whether the form can be submitted
   * - Must be dirty (have changes)
   * - Must be valid
   * - Must not be currently submitting
   */
  get canSubmit(): boolean {
    return this.isDirty && !this.isSubmitting && this.validateAll();
  }

  /**
   * Get error message for a specific field
   */
  getFieldError(field: keyof OrganizationUnitFormData): string | null {
    if (!this.touchedFields.has(field)) {
      return null;
    }
    return this.errors.get(field) ?? null;
  }

  /**
   * Check if a field has an error (and has been touched)
   */
  hasFieldError(field: keyof OrganizationUnitFormData): boolean {
    return this.touchedFields.has(field) && this.errors.has(field);
  }

  // ============================================
  // Actions - Field Updates
  // ============================================

  /**
   * Update a form field value
   *
   * @param field - Field name to update
   * @param value - New value
   */
  updateField<K extends keyof OrganizationUnitFormData>(
    field: K,
    value: OrganizationUnitFormData[K]
  ): void {
    runInAction(() => {
      this.formData[field] = value;
      this.touchedFields.add(field);
      // Clear submission error when user makes changes
      this.submissionError = null;
      // Validate the changed field
      this.validateField(field);
    });
  }

  /**
   * Update the name field and auto-generate display name if empty
   *
   * @param value - New name value
   */
  updateName(value: string): void {
    runInAction(() => {
      this.formData.name = value;
      this.touchedFields.add('name');

      // Auto-generate display name until user directly edits the displayName field.
      // This works for both create and edit modes because:
      // - updateName() auto-populates displayName WITHOUT adding to touchedFields
      // - updateField() (direct edits) DOES add to touchedFields
      const shouldAutoPopulate = !this.touchedFields.has('displayName');

      if (!this.formData.displayName || shouldAutoPopulate) {
        this.formData.displayName = value;
      }

      this.submissionError = null;
      this.validateField('name');
    });
  }

  /**
   * Mark a field as touched (for validation display)
   *
   * @param field - Field to mark as touched
   */
  touchField(field: keyof OrganizationUnitFormData): void {
    runInAction(() => {
      this.touchedFields.add(field);
      this.validateField(field);
    });
  }

  /**
   * Mark all fields as touched (useful before submit)
   */
  touchAllFields(): void {
    runInAction(() => {
      (Object.keys(this.formData) as (keyof OrganizationUnitFormData)[]).forEach(
        (field) => {
          this.touchedFields.add(field);
        }
      );
      this.validateAll();
    });
  }

  // ============================================
  // Actions - Validation
  // ============================================

  /**
   * Validate a specific field
   *
   * @param field - Field to validate
   * @returns true if field is valid
   */
  validateField(field: keyof OrganizationUnitFormData): boolean {
    let error: string | null = null;

    switch (field) {
      case 'name':
        if (!this.formData.name.trim()) {
          error = 'Name is required';
        } else if (this.formData.name.length > 100) {
          error = 'Name must be 100 characters or less';
        } else if (!/^[a-zA-Z0-9\s\-_]+$/.test(this.formData.name)) {
          error = 'Name can only contain letters, numbers, spaces, hyphens, and underscores';
        }
        break;

      case 'displayName':
        if (!this.formData.displayName.trim()) {
          error = 'Display name is required';
        } else if (this.formData.displayName.length > 200) {
          error = 'Display name must be 200 characters or less';
        }
        break;

      case 'timeZone':
        if (!this.formData.timeZone.trim()) {
          error = 'Timezone is required';
        }
        break;

      // parentId and isActive don't have validation rules
      default:
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

  /**
   * Validate all fields
   *
   * @returns true if all fields are valid
   */
  validateAll(): boolean {
    const fields: (keyof OrganizationUnitFormData)[] = [
      'name',
      'displayName',
      'timeZone',
    ];

    let allValid = true;
    for (const field of fields) {
      if (!this.validateField(field)) {
        allValid = false;
      }
    }

    return allValid;
  }

  // ============================================
  // Actions - Submission
  // ============================================

  /**
   * Submit the form
   *
   * @returns Operation result with created/updated unit or error
   */
  async submit(): Promise<OrganizationUnitOperationResult> {
    // Touch all fields to show any validation errors
    this.touchAllFields();

    // Validate all fields
    if (!this.validateAll()) {
      log.warn('Form validation failed', { errors: Array.from(this.errors.entries()) });
      return {
        success: false,
        error: 'Please fix validation errors before submitting',
        errorDetails: {
          code: 'UNKNOWN',
          message: 'Form validation failed',
        },
      };
    }

    runInAction(() => {
      this.isSubmitting = true;
      this.submissionError = null;
    });

    try {
      let result: OrganizationUnitOperationResult;

      if (this.mode === 'create') {
        const request: CreateOrganizationUnitRequest = {
          name: this.formData.name.trim(),
          displayName: this.formData.displayName.trim(),
          parentId: this.formData.parentId,
          timeZone: this.formData.timeZone,
        };

        log.debug('Submitting create request', { request });
        result = await this.service.createUnit(request);
      } else {
        // Edit mode
        if (!this.editingUnitId) {
          throw new Error('No unit ID for edit mode');
        }

        // Note: isActive is not updated here - use deactivateUnit/reactivateUnit instead
        const request: UpdateOrganizationUnitRequest = {
          id: this.editingUnitId,
          name: this.formData.name.trim(),
          displayName: this.formData.displayName.trim(),
          timeZone: this.formData.timeZone,
        };

        log.debug('Submitting update request', { request });
        result = await this.service.updateUnit(request);
      }

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success && result.unit) {
          // Update original data so form shows as not dirty
          this.originalData = { ...this.formData };
          log.info('Form submitted successfully', {
            mode: this.mode,
            unitId: result.unit.id,
          });
        } else {
          this.submissionError = result.error ?? 'An error occurred';
          log.warn('Form submission failed', { error: result.error });
        }
      });

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to submit form';

      runInAction(() => {
        this.isSubmitting = false;
        this.submissionError = errorMessage;
      });

      log.error('Form submission error', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: {
          code: 'UNKNOWN',
          message: errorMessage,
        },
      };
    }
  }

  // ============================================
  // Actions - Form Management
  // ============================================

  /**
   * Reset form to original values (or defaults for create mode)
   */
  reset(): void {
    runInAction(() => {
      this.formData = { ...this.originalData };
      this.errors.clear();
      this.touchedFields.clear();
      this.submissionError = null;
      log.debug('Form reset');
    });
  }

  /**
   * Clear submission error
   */
  clearSubmissionError(): void {
    runInAction(() => {
      this.submissionError = null;
    });
  }

  /**
   * Set parent unit (convenience method for parent selection)
   *
   * @param parentId - Parent unit ID (null for root children)
   */
  setParent(parentId: string | null): void {
    this.updateField('parentId', parentId);
  }

  /**
   * Set timezone (convenience method for timezone selection)
   *
   * @param timeZone - IANA timezone string
   */
  setTimeZone(timeZone: string): void {
    this.updateField('timeZone', timeZone);
  }

  /**
   * Toggle active status (edit mode only)
   */
  toggleActive(): void {
    if (this.mode === 'edit') {
      this.updateField('isActive', !this.formData.isActive);
    }
  }
}

/**
 * Common timezone options for the dropdown
 * Subset of IANA timezones commonly used in US healthcare
 */
export const COMMON_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)' },
] as const;
