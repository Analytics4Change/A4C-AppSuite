/**
 * User Form ViewModel
 *
 * Manages state and business logic for user invitation form.
 * Uses MobX for reactive state management.
 *
 * Features:
 * - Form state management for invitation creation
 * - Field validation with error messages
 * - Email lookup integration for smart form behavior
 * - Role selection with subset-only enforcement display
 * - Submit handling with async operations
 * - Dirty tracking and form reset
 *
 * Usage:
 * ```typescript
 * const viewModel = new UserFormViewModel(assignableRoles);
 * viewModel.updateField('email', 'user@example.com');
 * await viewModel.submit(commandService);
 * ```
 *
 * @see UsersViewModel for list and CRUD operations
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { Logger } from '@/utils/logger';
import type { IUserCommandService } from '@/services/users/IUserCommandService';
import type {
  InviteUserFormData,
  InviteUserRequest,
  RoleReference,
  UserOperationResult,
  EmailLookupResult,
  NotificationPreferences,
  InvitationPhone,
} from '@/types/user.types';
import {
  validateEmail,
  validateFirstName,
  validateLastName,
  validateRoles,
  validateAccessDates,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from '@/types/user.types';

const log = Logger.getLogger('viewmodel');

/**
 * Form field keys
 */
type FormField = keyof InviteUserFormData;

/**
 * User Form ViewModel
 *
 * MVVM pattern for invitation form state management.
 * Handles validation, dirty tracking, and submission.
 */
export class UserFormViewModel {
  // ============================================
  // Observable State
  // ============================================

  /** Current form data */
  formData: InviteUserFormData = {
    email: '',
    firstName: '',
    lastName: '',
    roleIds: [],
    accessStartDate: undefined,
    accessExpirationDate: undefined,
    notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    phones: [],
  };

  /** Original form data (for dirty detection) */
  private originalData: InviteUserFormData = {
    email: '',
    firstName: '',
    lastName: '',
    roleIds: [],
    accessStartDate: undefined,
    accessExpirationDate: undefined,
    notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    phones: [],
  };

  /** Validation errors by field */
  errors: Map<FormField, string> = new Map();

  /** Fields that have been touched (for showing errors) */
  touchedFields: Set<FormField> = new Set();

  /** Form submission in progress */
  isSubmitting = false;

  /** Error message from last submission attempt */
  submissionError: string | null = null;

  /** Detailed error info from last submission attempt */
  submissionErrorDetails: { code?: string; details?: string } | null = null;

  /** Email lookup result (from UsersViewModel) */
  emailLookupResult: EmailLookupResult | null = null;

  /** Whether email lookup is in progress */
  isCheckingEmail = false;

  /** Available roles for selection */
  readonly assignableRoles: RoleReference[];

  // ============================================
  // Constructor
  // ============================================

  /**
   * Constructor
   *
   * @param assignableRoles - Roles available for assignment
   */
  constructor(assignableRoles: RoleReference[] = []) {
    this.assignableRoles = assignableRoles;
    makeAutoObservable(this);
    log.debug('UserFormViewModel initialized', { roleCount: assignableRoles.length });
  }

  /**
   * Update assignable roles (for async loading scenarios)
   *
   * This method handles the case where roles load asynchronously after the
   * ViewModel is created. Without this, selectedRoles getter would filter
   * against an empty array and return [] even when roles are selected.
   */
  setAssignableRoles(roles: RoleReference[]): void {
    // Type assertion to work around readonly - controlled mutation from within ViewModel
    (this as { assignableRoles: RoleReference[] }).assignableRoles = roles;
    log.debug('Updated assignable roles', { roleCount: roles.length });
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
   * Whether the form has unsaved changes
   *
   * Defensive implementation to prevent MobX errors if data is in inconsistent state.
   */
  get isDirty(): boolean {
    try {
      // Guard against undefined/null data
      if (!this.formData || !this.originalData) {
        return false;
      }

      return (
        this.formData.email !== this.originalData.email ||
        this.formData.firstName !== this.originalData.firstName ||
        this.formData.lastName !== this.originalData.lastName ||
        JSON.stringify(this.formData.roleIds?.slice().sort() ?? []) !==
          JSON.stringify(this.originalData.roleIds?.slice().sort() ?? []) ||
        this.formData.accessStartDate !== this.originalData.accessStartDate ||
        this.formData.accessExpirationDate !== this.originalData.accessExpirationDate ||
        JSON.stringify(this.formData.notificationPreferences ?? {}) !==
          JSON.stringify(this.originalData.notificationPreferences ?? {}) ||
        JSON.stringify(this.formData.phones ?? []) !==
          JSON.stringify(this.originalData.phones ?? [])
      );
    } catch {
      // If any error occurs during dirty check, assume not dirty to prevent crashes
      return false;
    }
  }

  /**
   * Whether the form is valid
   */
  get isValid(): boolean {
    return this.validateAll();
  }

  /**
   * Whether the form can be submitted
   */
  get canSubmit(): boolean {
    // Can submit if:
    // - Not currently submitting
    // - Has required data
    // - Passes validation
    // - Email lookup doesn't block (e.g., already member)
    if (this.isSubmitting) return false;
    if (this.isCheckingEmail) return false;
    if (!this.validateAll()) return false;

    // Check if email lookup blocks submission
    if (this.emailLookupResult) {
      const blockingStatuses = ['active_member'];
      if (blockingStatuses.includes(this.emailLookupResult.status)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Number of selected roles
   */
  get selectedRoleCount(): number {
    return this.formData.roleIds.length;
  }

  /**
   * Selected roles as RoleReference objects
   */
  get selectedRoles(): RoleReference[] {
    return this.assignableRoles.filter((r) => this.formData.roleIds.includes(r.roleId));
  }

  /**
   * Get error message for a specific field
   */
  getFieldError(field: FormField): string | null {
    if (!this.touchedFields.has(field)) {
      return null;
    }
    return this.errors.get(field) ?? null;
  }

  /**
   * Check if a field has an error (and has been touched)
   */
  hasFieldError(field: FormField): boolean {
    return this.touchedFields.has(field) && this.errors.has(field);
  }

  /**
   * Whether the email lookup suggests a specific action
   */
  get suggestedAction(): 'invite' | 'resend' | 'reactivate' | 'add_to_org' | 'none' | null {
    if (!this.emailLookupResult) return null;

    switch (this.emailLookupResult.status) {
      case 'not_found':
        return 'invite';
      case 'pending':
        return 'resend';
      case 'expired':
        return 'invite';
      case 'active_member':
        return 'none';
      case 'deactivated':
        return 'reactivate';
      case 'other_org':
        return 'add_to_org';
      default:
        return null;
    }
  }

  // ============================================
  // Actions - Field Updates
  // ============================================

  /**
   * Update a form field value
   */
  updateField<K extends FormField>(field: K, value: InviteUserFormData[K]): void {
    runInAction(() => {
      this.formData[field] = value;
      this.touchedFields.add(field);
      this.submissionError = null;
      this.validateField(field);
    });
  }

  /**
   * Update email field
   */
  setEmail(email: string): void {
    this.updateField('email', email);
  }

  /**
   * Update first name field
   */
  setFirstName(firstName: string): void {
    this.updateField('firstName', firstName);
  }

  /**
   * Update last name field
   */
  setLastName(lastName: string): void {
    this.updateField('lastName', lastName);
  }

  /**
   * Toggle a role selection
   */
  toggleRole(roleId: string): void {
    runInAction(() => {
      const currentIds = [...this.formData.roleIds];
      const index = currentIds.indexOf(roleId);

      if (index === -1) {
        currentIds.push(roleId);
      } else {
        currentIds.splice(index, 1);
      }

      this.formData.roleIds = currentIds;
      this.touchedFields.add('roleIds');
      this.submissionError = null;
      this.validateField('roleIds');

      log.debug('Toggled role', { roleId, selected: index === -1 });
    });
  }

  /**
   * Select a specific role
   */
  selectRole(roleId: string): void {
    if (!this.formData.roleIds.includes(roleId)) {
      runInAction(() => {
        this.formData.roleIds = [...this.formData.roleIds, roleId];
        this.touchedFields.add('roleIds');
        this.submissionError = null;
        this.validateField('roleIds');
      });
    }
  }

  /**
   * Deselect a specific role
   */
  deselectRole(roleId: string): void {
    runInAction(() => {
      this.formData.roleIds = this.formData.roleIds.filter((id) => id !== roleId);
      this.touchedFields.add('roleIds');
      this.submissionError = null;
      this.validateField('roleIds');
    });
  }

  /**
   * Set all selected roles
   */
  setRoles(roleIds: string[]): void {
    runInAction(() => {
      this.formData.roleIds = [...roleIds];
      this.touchedFields.add('roleIds');
      this.submissionError = null;
      this.validateField('roleIds');
    });
  }

  /**
   * Clear all role selections
   */
  clearRoles(): void {
    this.setRoles([]);
  }

  /**
   * Sync originalData to current formData.
   * Call after programmatically loading user data for editing
   * to prevent false "unsaved changes" indicators.
   */
  syncOriginalData(): void {
    runInAction(() => {
      this.originalData = {
        ...this.formData,
        roleIds: [...this.formData.roleIds],
        notificationPreferences: this.formData.notificationPreferences
          ? { ...this.formData.notificationPreferences }
          : undefined,
        phones: this.formData.phones ? [...this.formData.phones] : [],
      };
      this.touchedFields.clear();
    });
  }

  // ============================================
  // Actions - Extended Data Fields
  // ============================================

  /**
   * Set access start date
   */
  setAccessStartDate(date: string | undefined): void {
    runInAction(() => {
      this.formData.accessStartDate = date;
      this.touchedFields.add('accessStartDate');
      this.submissionError = null;
      this.validateField('accessStartDate');
      // Also validate expiration date since they're related
      if (this.touchedFields.has('accessExpirationDate')) {
        this.validateField('accessExpirationDate');
      }
    });
  }

  /**
   * Set access expiration date
   */
  setAccessExpirationDate(date: string | undefined): void {
    runInAction(() => {
      this.formData.accessExpirationDate = date;
      this.touchedFields.add('accessExpirationDate');
      this.submissionError = null;
      this.validateField('accessExpirationDate');
      // Also validate start date since they're related
      if (this.touchedFields.has('accessStartDate')) {
        this.validateField('accessStartDate');
      }
    });
  }

  /**
   * Clear access dates
   */
  clearAccessDates(): void {
    runInAction(() => {
      this.formData.accessStartDate = undefined;
      this.formData.accessExpirationDate = undefined;
      this.errors.delete('accessStartDate');
      this.errors.delete('accessExpirationDate');
    });
  }

  /**
   * Set notification preferences
   */
  setNotificationPreferences(prefs: NotificationPreferences): void {
    runInAction(() => {
      this.formData.notificationPreferences = { ...prefs };
      this.touchedFields.add('notificationPreferences');
      this.submissionError = null;
    });
  }

  /**
   * Update email notification preference
   */
  setEmailNotifications(enabled: boolean): void {
    runInAction(() => {
      const current = this.formData.notificationPreferences ?? DEFAULT_NOTIFICATION_PREFERENCES;
      this.formData.notificationPreferences = {
        email: enabled,
        sms: current.sms,
        inApp: current.inApp,
      };
      this.touchedFields.add('notificationPreferences');
    });
  }

  /**
   * Update SMS notification preference
   */
  setSmsNotifications(enabled: boolean, phoneId: string | null = null): void {
    runInAction(() => {
      const current = this.formData.notificationPreferences ?? DEFAULT_NOTIFICATION_PREFERENCES;
      this.formData.notificationPreferences = {
        email: current.email,
        sms: { enabled, phoneId },
        inApp: current.inApp,
      };
      this.touchedFields.add('notificationPreferences');
    });
  }

  /**
   * Update in-app notification preference
   */
  setInAppNotifications(enabled: boolean): void {
    runInAction(() => {
      const current = this.formData.notificationPreferences ?? DEFAULT_NOTIFICATION_PREFERENCES;
      this.formData.notificationPreferences = {
        email: current.email,
        sms: current.sms,
        inApp: enabled,
      };
      this.touchedFields.add('notificationPreferences');
    });
  }

  /**
   * Reset notification preferences to defaults
   */
  resetNotificationPreferences(): void {
    runInAction(() => {
      this.formData.notificationPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
    });
  }

  // ============================================
  // Actions - Phone Management (Phase 6)
  // ============================================

  /**
   * Set all phones
   */
  setPhones(phones: InvitationPhone[]): void {
    runInAction(() => {
      this.formData.phones = [...phones];
      this.touchedFields.add('phones');
      this.submissionError = null;
    });
  }

  /**
   * Add a new phone entry
   */
  addPhone(phone: InvitationPhone): void {
    runInAction(() => {
      const phones = this.formData.phones ?? [];
      // If this is the first phone, set it as primary
      const newPhone = phones.length === 0 ? { ...phone, isPrimary: true } : phone;
      this.formData.phones = [...phones, newPhone];
      this.touchedFields.add('phones');
      this.submissionError = null;
    });
  }

  /**
   * Update a phone entry at index
   */
  updatePhone(index: number, updates: Partial<InvitationPhone>): void {
    runInAction(() => {
      const phones = [...(this.formData.phones ?? [])];
      if (index >= 0 && index < phones.length) {
        // If setting as primary, clear primary from others
        if (updates.isPrimary) {
          phones.forEach((p, i) => {
            if (i !== index) {
              phones[i] = { ...p, isPrimary: false };
            }
          });
        }
        phones[index] = { ...phones[index], ...updates };
        this.formData.phones = phones;
        this.touchedFields.add('phones');
        this.submissionError = null;
      }
    });
  }

  /**
   * Remove a phone entry at index
   */
  removePhone(index: number): void {
    runInAction(() => {
      const phones = [...(this.formData.phones ?? [])];
      if (index >= 0 && index < phones.length) {
        const wasRemovingPrimary = phones[index].isPrimary;
        phones.splice(index, 1);

        // If removed phone was primary, make first remaining phone primary
        if (wasRemovingPrimary && phones.length > 0) {
          phones[0] = { ...phones[0], isPrimary: true };
        }

        this.formData.phones = phones;
        this.touchedFields.add('phones');
        this.submissionError = null;
      }
    });
  }

  /**
   * Clear all phones
   */
  clearPhones(): void {
    runInAction(() => {
      this.formData.phones = [];
      this.touchedFields.add('phones');
    });
  }

  /**
   * Mark a field as touched
   */
  touchField(field: FormField): void {
    runInAction(() => {
      this.touchedFields.add(field);
      this.validateField(field);
    });
  }

  /**
   * Mark all fields as touched
   */
  touchAllFields(): void {
    runInAction(() => {
      const fields: FormField[] = [
        'email',
        'firstName',
        'lastName',
        'roleIds',
        'accessStartDate',
        'accessExpirationDate',
        'notificationPreferences',
        'phones',
      ];
      fields.forEach((field) => this.touchedFields.add(field));
      this.validateAll();
    });
  }

  // ============================================
  // Actions - Email Lookup
  // ============================================

  /**
   * Set email lookup result (typically called from UsersViewModel)
   */
  setEmailLookupResult(result: EmailLookupResult | null): void {
    runInAction(() => {
      this.emailLookupResult = result;

      // Pre-fill name if available from lookup
      if (result && result.firstName && !this.formData.firstName) {
        this.formData.firstName = result.firstName;
      }
      if (result && result.lastName && !this.formData.lastName) {
        this.formData.lastName = result.lastName;
      }
    });
  }

  /**
   * Set email checking state
   */
  setIsCheckingEmail(isChecking: boolean): void {
    runInAction(() => {
      this.isCheckingEmail = isChecking;
    });
  }

  /**
   * Clear email lookup
   */
  clearEmailLookup(): void {
    runInAction(() => {
      this.emailLookupResult = null;
      this.isCheckingEmail = false;
    });
  }

  // ============================================
  // Actions - Validation
  // ============================================

  /**
   * Validate a specific field
   */
  validateField(field: FormField): boolean {
    let error: string | null = null;

    switch (field) {
      case 'email':
        error = validateEmail(this.formData.email);
        break;

      case 'firstName':
        error = validateFirstName(this.formData.firstName);
        break;

      case 'lastName':
        error = validateLastName(this.formData.lastName);
        break;

      case 'roleIds':
        error = validateRoles(this.formData.roleIds);
        break;

      case 'accessStartDate':
      case 'accessExpirationDate': {
        // Validate access dates together
        const dateErrors = validateAccessDates(
          this.formData.accessStartDate ?? undefined,
          this.formData.accessExpirationDate ?? undefined
        );
        if (dateErrors) {
          // Set specific error for the field being validated
          error = dateErrors[field === 'accessStartDate' ? 'accessStartDate' : 'accessExpirationDate'] ?? null;
        }
        break;
      }

      case 'notificationPreferences':
        // Notification preferences are always valid (no required fields)
        error = null;
        break;

      case 'phones':
        // Phone validation is handled by InvitationPhoneInput component
        // Phones are optional, so no ViewModel-level validation required
        error = null;
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
   */
  validateAll(): boolean {
    const fields: FormField[] = [
      'email',
      'firstName',
      'lastName',
      'roleIds',
      'accessStartDate',
      'accessExpirationDate',
      'notificationPreferences',
      'phones',
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
   * Format violation details from Edge Function error context for user display.
   *
   * Edge Function returns errorDetails with structure like:
   * {
   *   code: 'ROLE_ASSIGNMENT_VIOLATION',
   *   role_id: 'uuid',
   *   role_name: 'Role Name',
   *   violations: [{ error_code: 'SCOPE_HIERARCHY_VIOLATION', message: '...' }]
   * }
   *
   * @param ctx - The errorDetails context from Edge Function
   * @returns Human-readable error message
   */
  private formatViolationDetails(ctx: Record<string, unknown>): string {
    // Check for violations array (contains detailed messages)
    const violations = ctx.violations as
      | Array<{ error_code: string; message: string; role_name?: string }>
      | undefined;
    if (violations && violations.length > 0) {
      return violations.map((v) => v.message).join('; ');
    }

    // Fallback to role_name + code for user-friendly message
    const roleName = ctx.role_name as string | undefined;
    const code = ctx.code as string | undefined;
    if (roleName && code) {
      if (code === 'SCOPE_HIERARCHY_VIOLATION') {
        return `Role "${roleName}" has a scope outside your authority`;
      }
      if (code === 'SUBSET_ONLY_VIOLATION') {
        return `Role "${roleName}" has permissions you don't have`;
      }
      if (code === 'ROLE_ASSIGNMENT_VIOLATION') {
        return `Cannot assign role "${roleName}" - check permissions and scope`;
      }
      return `Role "${roleName}": ${code}`;
    }

    // Last resort: JSON stringify for debugging
    return JSON.stringify(ctx);
  }

  /**
   * Build invitation request from form data
   */
  buildRequest(): InviteUserRequest {
    return {
      email: this.formData.email.trim(),
      firstName: this.formData.firstName.trim(),
      lastName: this.formData.lastName.trim(),
      roles: this.selectedRoles,
      accessStartDate: this.formData.accessStartDate ?? undefined,
      accessExpirationDate: this.formData.accessExpirationDate ?? undefined,
      notificationPreferences: this.formData.notificationPreferences,
      phones: this.formData.phones,
    };
  }

  /**
   * Submit the form
   */
  async submit(commandService: IUserCommandService): Promise<UserOperationResult> {
    // Touch all fields to show validation errors
    this.touchAllFields();

    // Validate
    if (!this.validateAll()) {
      log.warn('Form validation failed', { errors: Array.from(this.errors.entries()) });
      return {
        success: false,
        error: 'Please fix validation errors before submitting',
        errorDetails: { code: 'VALIDATION_ERROR', message: 'Form validation failed' },
      };
    }

    // Check email lookup blocking conditions
    if (this.emailLookupResult?.status === 'active_member') {
      return {
        success: false,
        error: 'User is already a member of this organization',
        errorDetails: { code: 'ALREADY_MEMBER', message: 'User already has access' },
      };
    }

    runInAction(() => {
      this.isSubmitting = true;
      this.submissionError = null;
    });

    try {
      const request = this.buildRequest();
      log.debug('Submitting invitation', { email: request.email });

      const result = await commandService.inviteUser(request);

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          log.info('Invitation submitted successfully', { email: request.email });
        } else {
          this.submissionError = result.error ?? 'An error occurred';
          // Extract detailed error info for display
          // The context contains the full errorDetails from the Edge Function
          const ctx = result.errorDetails?.context as Record<string, unknown> | undefined;
          if (ctx) {
            this.submissionErrorDetails = {
              code: result.errorDetails?.code ?? (ctx.code as string),
              details: this.formatViolationDetails(ctx),
            };
          } else {
            this.submissionErrorDetails = null;
          }
          log.warn('Invitation submission failed', { error: result.error, errorDetails: result.errorDetails });
        }
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send invitation';

      runInAction(() => {
        this.isSubmitting = false;
        this.submissionError = errorMessage;
      });

      log.error('Invitation submission error', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  // ============================================
  // Actions - Form Management
  // ============================================

  /**
   * Reset form to initial empty state
   */
  reset(): void {
    runInAction(() => {
      this.formData = {
        email: '',
        firstName: '',
        lastName: '',
        roleIds: [],
        accessStartDate: undefined,
        accessExpirationDate: undefined,
        notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
        phones: [],
      };
      this.originalData = {
        ...this.formData,
        notificationPreferences: this.formData.notificationPreferences
          ? { ...this.formData.notificationPreferences }
          : undefined,
        phones: [],
      };
      this.errors.clear();
      this.touchedFields.clear();
      this.submissionError = null;
      this.submissionErrorDetails = null;
      this.emailLookupResult = null;
      this.isCheckingEmail = false;
      log.debug('Form reset');
    });
  }

  /**
   * Clear submission error
   */
  clearSubmissionError(): void {
    runInAction(() => {
      this.submissionError = null;
      this.submissionErrorDetails = null;
    });
  }

  /**
   * Initialize form for editing an existing user's profile
   * (Not used for invitations, but included for future use)
   */
  initializeForEdit(userId: string, firstName: string, lastName: string): void {
    runInAction(() => {
      this.formData = {
        email: '', // Email is read-only in edit mode
        firstName,
        lastName,
        roleIds: [],
        accessStartDate: undefined,
        accessExpirationDate: undefined,
        notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
        phones: [],
      };
      this.originalData = {
        ...this.formData,
        notificationPreferences: this.formData.notificationPreferences
          ? { ...this.formData.notificationPreferences }
          : undefined,
        phones: [],
      };
      this.errors.clear();
      this.touchedFields.clear();
      this.submissionError = null;
      log.debug('Form initialized for edit', { userId });
    });
  }

  /**
   * Pre-fill form from email lookup result
   */
  prefillFromLookup(result: EmailLookupResult): void {
    runInAction(() => {
      if (result.firstName) {
        this.formData.firstName = result.firstName;
      }
      if (result.lastName) {
        this.formData.lastName = result.lastName;
      }
      this.emailLookupResult = result;
      log.debug('Form prefilled from lookup', { status: result.status });
    });
  }
}
