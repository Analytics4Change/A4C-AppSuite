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
import type { IUserQueryService } from '@/services/users/IUserQueryService';
import type {
  InviteUserFormData,
  InviteUserRequest,
  UpdateUserRequest,
  RoleReference,
  InviteUserResult,
  UpdateUserResult,
  ModifyUserRolesResult,
  EmailLookupResult,
  EmailLookupStatus,
  NotificationPreferences,
  InvitationPhone,
  UserListItem,
} from '@/types/user.types';
import type { UsersViewModel } from './UsersViewModel';
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
 * Form mode: create new user invitation or edit existing user
 */
export type FormMode = 'create' | 'edit';

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
  submissionErrorDetails: { code?: string; details?: string; correlationId?: string } | null = null;

  /** Email lookup result (from UsersViewModel) */
  emailLookupResult: EmailLookupResult | null = null;

  /** Whether email lookup is in progress */
  isCheckingEmail = false;

  /**
   * Which name fields the lookup filled in (as opposed to the admin typing them).
   * Only these are reverted when the email changes — an admin-typed name is never
   * touched, and writing one clears its flag.
   *
   * Bookkeeping, not UI state — but note it IS observable: `makeAutoObservable`
   * annotates `private` fields regardless of the TS modifier, and this one deeply.
   * Harmless (class-field-initialized before the call, and `reset()` replaces the
   * object wholesale), and MobX's `AnnotationsMap` type does not admit `private`
   * keys so it cannot be opted out without a cast. Do not read it in a computed —
   * it would create a dependency nothing intends.
   *
   * Forward-looking: the deployed `SupabaseUserQueryService.checkEmailStatus`
   * returns `firstName: null` on every branch (the RPCs do not select names), so
   * today only `MockUserQueryService` can trigger the prefill. The union permits
   * names, so this keeps the invariant honest if the RPCs are ever widened.
   */
  private prefilledNameFromLookup = { first: false, last: false };

  /**
   * The address the current `emailLookupResult` was fetched for, so repeated blurs
   * on an unchanged address don't re-probe. Scoped to this form instance, which is
   * why it needs no reset in `enterCreateMode` — that builds a fresh VM.
   */
  private lastLookedUpEmail: string | null = null;

  /**
   * The address a lookup is keyed on — trimmed, because that is what actually gets
   * compared downstream.
   *
   * `validateEmail` trims before validating, and `buildRequest` submits trimmed, so
   * " bob@org.com" is a *valid* address with no field error. But the guarded RPCs
   * compare with bare equality (`WHERE u.email = p_email`), so probing the
   * untrimmed value matches nothing, all three probes come back empty, and the UI
   * renders a confident "New user — invite them" for someone who is already an
   * active member. That is the exact failure the service contract forbids, arriving
   * through the input path instead of the infrastructure path.
   *
   * NOT lowercased. Emails are case-insensitive by convention but nothing in this
   * codebase normalizes case on write, and the RPC comparison is bare `=` — so
   * lowercasing here would *create* the same false-green for any address stored
   * mixed-case. Fixing that needs `lower()`/`btrim()` in the RPCs plus an index
   * check; seeded separately rather than guessed at.
   */
  private get lookupKey(): string {
    return this.formData.email.trim();
  }

  /**
   * Address of the lookup currently in flight, or null.
   *
   * Distinct from comparing against `formData.email`: when a stale response
   * resolves and NO newer probe is running, the flag must still clear — otherwise
   * `isCheckingEmail` stays true forever and `canSubmit` wedges the form shut.
   * Comparing to this tells us whether a newer probe has taken ownership.
   */
  private inFlightFor: string | null = null;

  /** Available roles for selection */
  assignableRoles: RoleReference[];

  /** Form mode (create or edit) */
  readonly mode: FormMode;

  /** User ID being edited (edit mode only) */
  readonly editingUserId: string | null;

  // ============================================
  // Constructor
  // ============================================

  /**
   * Constructor
   *
   * @param assignableRoles - Roles available for assignment
   * @param mode - Form mode (create or edit)
   * @param existingUser - Existing user to edit (required for edit mode)
   */
  constructor(
    assignableRoles: RoleReference[] = [],
    mode: FormMode = 'create',
    existingUser?: UserListItem
  ) {
    this.assignableRoles = assignableRoles;
    this.mode = mode;
    this.editingUserId = existingUser?.id ?? null;

    // Initialize form data based on mode
    if (mode === 'edit' && existingUser) {
      this.formData = {
        email: existingUser.email,
        firstName: existingUser.firstName ?? '',
        lastName: existingUser.lastName ?? '',
        roleIds: existingUser.roles.map((r) => r.roleId),
        accessStartDate: undefined,
        accessExpirationDate: undefined,
        notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
        phones: [],
      };
      // Copy to original for dirty tracking
      this.originalData = {
        ...this.formData,
        roleIds: [...this.formData.roleIds],
        // Spread DEFAULT first to ensure all required properties are defined,
        // then override with any existing values
        notificationPreferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          ...this.formData.notificationPreferences,
        },
        phones: [],
      };
    }

    makeAutoObservable(this);
    log.debug('UserFormViewModel initialized', {
      mode,
      roleCount: assignableRoles.length,
      editingUserId: this.editingUserId,
    });
  }

  /**
   * Update assignable roles (for async loading scenarios)
   *
   * This method handles the case where roles load asynchronously after the
   * ViewModel is created. Without this, selectedRoles getter would filter
   * against an empty array and return [] even when roles are selected.
   */
  setAssignableRoles(roles: RoleReference[]): void {
    this.assignableRoles = roles;
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

    // Check if email lookup blocks submission.
    //
    // Enumerated POSITIVELY and typed against the union on purpose: a status
    // absent from this list — notably `lookup_failed` — must fail OPEN. A
    // failed pre-flight is a missing courtesy, not a reason to stop an admin
    // submitting; the server re-checks before routing. The annotation makes a
    // typo'd or stale entry a compile error instead of a silent no-op.
    if (this.emailLookupResult) {
      const blockingStatuses: EmailLookupStatus[] = ['active_member'];
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
   * Roles to add (in current selection but not in original)
   */
  get rolesToAdd(): string[] {
    return this.formData.roleIds.filter((id) => !this.originalData.roleIds.includes(id));
  }

  /**
   * Roles to remove (in original but not in current selection)
   */
  get rolesToRemove(): string[] {
    return this.originalData.roleIds.filter((id) => !this.formData.roleIds.includes(id));
  }

  /**
   * Whether roles have been modified (edit mode)
   */
  get hasRoleChanges(): boolean {
    return this.rolesToAdd.length > 0 || this.rolesToRemove.length > 0;
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
  /**
   * NOTE: currently has NO consumer. `UserFormFields` used to take a
   * `suggestedAction` prop, destructure it as `_suggestedAction` and never read it;
   * PR B's review removed the prop and the page mapping that fed it. The getter is
   * kept because the per-status intent is the natural input to wiring the panel's
   * action buttons (resend / view-user), which is seeded — but until then, changing
   * it changes nothing that renders.
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
      case 'lookup_failed':
        // Not a verdict, so there is nothing to suggest. Explicit rather than
        // falling through to `default` so a new status can't inherit it silently.
        return 'none';
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
      // Compare the NORMALIZED key, not the raw value: the memo, the in-flight guard
      // and the RPC all key on the trimmed address, so a whitespace-only edit is the
      // same address and must not invalidate a still-valid verdict.
      const prevKey = this.lookupKey;

      this.formData[field] = value;

      const emailChanged = field === 'email' && this.lookupKey !== prevKey;
      this.touchedFields.add(field);
      this.submissionError = null;
      this.validateField(field);

      // A lookup result describes ONE address. The moment the address changes the
      // result is stale, and stale is dangerous here rather than merely untidy:
      // `shouldDisableFields` locks the name/role inputs on active_member|pending
      // and `canSubmit` blocks on active_member, so leaving a stale verdict in
      // place traps the admin in a form they cannot edit their way out of.
      //
      // Done at the single mutation point so `setEmail` and every other writer is
      // covered. No reentrancy: this runs before any lookup writes, and
      // setEmailLookupResult touches formData directly rather than via updateField.
      if (emailChanged) {
        this.emailLookupResult = null;
        this.lastLookedUpEmail = null;
        this.revertLookupPrefilledNames();
      }

      // Writing a name field takes ownership of it. Without this the revert above
      // would later wipe an admin's own edit: a lookup prefills "External", the
      // admin corrects it to "Alice" (nothing locks the field for other_org), then
      // corrects the email — and "Alice" is deleted.
      if (field === 'firstName') {
        this.prefilledNameFromLookup.first = false;
      }
      if (field === 'lastName') {
        this.prefilledNameFromLookup.last = false;
      }
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
   * Run the smart email lookup for the address currently in the form.
   *
   * **Owns the whole operation** — the call, the in-flight flag, the result, and
   * the staleness guard. The query service arrives per call rather than being
   * held, matching `submit(commandService, …)`; this VM deliberately holds no
   * services. Never throws: the service maps every failure to `lookup_failed`.
   *
   * **The guard is keyed on the email string, not a sequence counter.** A counter
   * only catches out-of-order responses. The case that actually bites is
   * edit-during-flight: blur fires, the admin returns to the field and corrects a
   * typo, then the original response lands — and that response IS the latest one,
   * so a counter admits it. Comparing the issued address against `formData.email`
   * at the *write* site rejects it, and subsumes the out-of-order case too.
   *
   * Guard is per form instance, which is why this lives here rather than on
   * `UsersViewModel`: `enterCreateMode` builds a fresh `UserFormViewModel` each
   * time, so a lookup in flight for a cancelled form cannot land on a new one.
   */
  async checkEmailStatus(queryService: IUserQueryService): Promise<void> {
    const issuedFor = this.lookupKey;

    if (!issuedFor || issuedFor.trim().length < 3) {
      this.clearEmailLookup();
      return;
    }

    // Don't re-probe an address we already have a verdict for — blur fires on every
    // focus loss, and each lookup is up to three membership probes.
    //
    // `lookup_failed` is deliberately EXEMPT: it is not a verdict, it means "we
    // could not find out". Memoising it would make the failure permanent for that
    // address and leave the "Try again" button unable to do anything — the exact
    // dead affordance this PR is closing.
    if (
      this.emailLookupResult &&
      this.emailLookupResult.status !== 'lookup_failed' &&
      this.lastLookedUpEmail === issuedFor
    ) {
      return;
    }

    // Already probing this exact address — don't stack a second one. Reachable via
    // edit-away-and-back (which clears the result and so defeats the memo above)
    // and via repeat retry clicks, since lookup_failed is memo-exempt. Value-keying
    // cannot tell two same-address probes apart, so the first to finish would clear
    // the in-flight flag while the second is still out: aria-busy, the spinner and
    // canSubmit would all read "idle" while a late verdict was still able to land
    // and re-lock the form after the admin clicked Send.
    if (this.inFlightFor === issuedFor) {
      return;
    }

    runInAction(() => {
      this.isCheckingEmail = true;
      this.inFlightFor = issuedFor;
    });

    // The service never rejects — it maps no-session / no-org / RPC error /
    // exception to `lookup_failed`. try/finally only guarantees the in-flight
    // flag clears if that contract is ever broken.
    try {
      // No correlation id passed on purpose. Per services/CLAUDE.md §4
      // "Service-mints variant", this leaf owns its own failure logging and
      // DEFAULTS the id, so threading one here would mint a second and break the
      // very join the id exists to make.
      const result = await queryService.checkEmailStatus(issuedFor);

      if (issuedFor !== this.lookupKey) {
        // Address changed while we waited. Discard — do NOT clear the result:
        // a newer lookup may already have written a valid verdict, and wiping it
        // here is the bug the value-keyed guard exists to prevent.
        log.debug('Discarding stale email lookup', { status: result.status });
        return;
      }

      this.setEmailLookupResult(result);
      runInAction(() => {
        this.lastLookedUpEmail = issuedFor;
      });
    } finally {
      runInAction(() => {
        // Clear only if WE are still the in-flight lookup. If a newer probe has
        // started it owns the flag; if none has, this must clear even though the
        // address changed, or the form is left permanently "checking".
        if (this.inFlightFor === issuedFor) {
          this.isCheckingEmail = false;
          this.inFlightFor = null;
        }
      });
    }
  }

  /**
   * Set email lookup result.
   *
   * A `lookup_failed` result carries no identity by construction, so the
   * name pre-fill below is unreachable for it — we never put a name in the
   * form on the strength of a lookup we could not complete.
   *
   * Prefilled names are TRACKED (`prefilledNameFromLookup`) so an email edit can
   * revert them. Without that, correcting a mistyped address leaves the previous
   * person's name sitting in the form, and it submits.
   */
  setEmailLookupResult(result: EmailLookupResult | null): void {
    runInAction(() => {
      this.emailLookupResult = result;

      const identity = result && result.status !== 'lookup_failed' ? result : null;

      // Pre-fill name if available from lookup
      if (identity?.firstName && !this.formData.firstName) {
        this.formData.firstName = identity.firstName;
        this.prefilledNameFromLookup.first = true;
      }
      if (identity?.lastName && !this.formData.lastName) {
        this.formData.lastName = identity.lastName;
        this.prefilledNameFromLookup.last = true;
      }
    });
  }

  /**
   * Set email checking state.
   *
   * @internal No production caller — `checkEmailStatus` owns this flag end to end.
   * Retained only so a test can stage the in-flight state directly; prefer
   * exercising the real path where practical.
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
      this.lastLookedUpEmail = null;
      this.revertLookupPrefilledNames();
    });
  }

  /**
   * Drop any name the lookup put in the form, leaving admin-typed names alone
   * (writing a name field clears its flag, so an admin edit is never reverted).
   *
   * The failure mode: admin types an active member's address, the lookup prefills
   * that person's name, admin realises the typo and corrects the email — and
   * without this the *other* person's name stays and submits.
   *
   * FORWARD-LOOKING, not a live fix. The deployed
   * `SupabaseUserQueryService.checkEmailStatus` returns `firstName: null` on every
   * branch, because the three RPCs do not select names — so today only
   * `MockUserQueryService` can trigger the prefill this reverts. Kept because the
   * result union permits names and widening those RPCs is an open follow-up; if
   * that never happens, this and `prefilledNameFromLookup` can both go.
   */
  private revertLookupPrefilledNames(): void {
    if (this.prefilledNameFromLookup.first) {
      this.formData.firstName = '';
      this.prefilledNameFromLookup.first = false;
    }
    if (this.prefilledNameFromLookup.last) {
      this.formData.lastName = '';
      this.prefilledNameFromLookup.last = false;
    }
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
          error =
            dateErrors[field === 'accessStartDate' ? 'accessStartDate' : 'accessExpirationDate'] ??
            null;
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
    if (this.formData.roleIds.length > 0 && this.assignableRoles.length === 0) {
      log.warn('buildRequest: roleIds selected but assignableRoles is empty — roles will be lost', {
        roleIds: this.formData.roleIds,
      });
    }
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
   *
   * In create mode: Sends invitation via commandService.inviteUser()
   * In edit mode: Updates user profile via commandService.updateUser(), then
   * (if profile update succeeded and roles changed) delegates role modification
   * to `usersViewModel.modifyRoles(...)` — the page-level handler that owns
   * `lastRoleViolations` / `lastRolePartialFailure` state for the rich
   * `UsersErrorBanner` rendering. Going through the page VM (instead of calling
   * `commandService.modifyRoles` directly) is the single source of truth for
   * role-modification error surfacing: violation/partial detail flows to the
   * page banner, the form's `submissionError` is suppressed when the banner
   * owns it.
   *
   * Return union: on edit mode with role changes, `result` is reassigned to
   * the modifyRoles result when role modification fails, so callers see the
   * role error (rich `violations` / `partial` fields on `ModifyUserRolesResult`).
   */
  async submit(
    commandService: IUserCommandService,
    usersViewModel: UsersViewModel
  ): Promise<InviteUserResult | UpdateUserResult | ModifyUserRolesResult> {
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

    // Check email lookup blocking conditions (create mode only)
    if (this.mode === 'create' && this.emailLookupResult?.status === 'active_member') {
      return {
        success: false,
        error: 'User is already a member of this organization',
        errorDetails: { code: 'ALREADY_MEMBER', message: 'User already has access' },
      };
    }

    // Validate edit mode has user ID
    if (this.mode === 'edit' && !this.editingUserId) {
      log.error('Edit mode requires editingUserId');
      return {
        success: false,
        error: 'Cannot update user: missing user ID',
        errorDetails: { code: 'MISSING_USER_ID', message: 'No user ID for edit mode' },
      };
    }

    runInAction(() => {
      this.isSubmitting = true;
      this.submissionError = null;
    });

    // Snapshot the page VM's structured role-error state before submit. The
    // suppression check below compares by reference: a fresh role failure on
    // THIS submit makes `modifyRoles` assign a new array/object (see
    // UsersViewModel lines 1205 and 1216), so reference equality only holds
    // when this submit did NOT touch those fields. Without this snapshot,
    // sticky state from a PRIOR submit would falsely trigger suppression of
    // a fresh non-role failure on the current submit.
    const initialRoleViolations = usersViewModel.lastRoleViolations;
    const initialRolePartialFailure = usersViewModel.lastRolePartialFailure;

    try {
      let result: InviteUserResult | UpdateUserResult | ModifyUserRolesResult;

      if (this.mode === 'create') {
        // Create mode: Send invitation
        const request = this.buildRequest();
        log.debug('Submitting invitation', { email: request.email });
        result = await commandService.inviteUser(request);
      } else {
        // Edit mode: Update user profile
        const updateRequest: UpdateUserRequest = {
          userId: this.editingUserId!,
          firstName: this.formData.firstName.trim(),
          lastName: this.formData.lastName.trim(),
        };
        log.debug('Updating user profile', { userId: updateRequest.userId });
        result = await commandService.updateUser(updateRequest);

        // Handle role changes (if profile update succeeded and roles changed).
        // Delegate to the page VM's modifyRoles handler — it captures
        // `lastRoleViolations` and `lastRolePartialFailure` on itself so the
        // page-level UsersErrorBanner can render the rich violation list
        // (`data-testid="role-modification-violation"`) or partial-failure
        // recovery banner (`data-testid="role-modification-partial-warning"`).
        // The page VM also logs structured warnings for both failure modes.
        if (result.success && this.hasRoleChanges) {
          log.debug('Processing role changes', {
            userId: this.editingUserId,
            rolesToAdd: this.rolesToAdd,
            rolesToRemove: this.rolesToRemove,
          });
          const roleResult = await usersViewModel.modifyRoles({
            userId: this.editingUserId!,
            roleIdsToAdd: this.rolesToAdd,
            roleIdsToRemove: this.rolesToRemove,
          });

          if (!roleResult.success) {
            // Role modification failed — return role error so caller can react.
            // The page VM has already populated `lastRoleViolations` /
            // `lastRolePartialFailure` for the banner; the failure branch below
            // suppresses the form's inline submissionError to avoid duplicate
            // error surfaces.
            result = roleResult;
          }
          // Success path: role changes applied. UsersManagePage surfaces the
          // edit-save success via its `showCommandSuccess('Changes saved')`
          // banner; the page VM logs internally, so no additional log here.
        }
      }

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          if (this.mode === 'create') {
            log.info('Invitation submitted successfully', { email: this.formData.email });
          } else {
            log.info('User profile updated successfully', { userId: this.editingUserId });
          }
        } else {
          // If the page VM has captured structured role-modification state
          // (violations or partial-failure), that surface owns the error
          // display. Suppress the form's inline submissionError to avoid
          // rendering the same error twice (architect Finding #2).
          //
          // Compare against the pre-submit snapshot by reference so that
          // sticky state from a prior submit (e.g., a previous role-violation
          // that the user has not dismissed) cannot falsely suppress a fresh
          // non-role failure on this submit. `modifyRoles` always assigns a
          // new array/object when it populates these fields, so reference
          // inequality is a sound provenance check for "this submit caused
          // the population."
          const handledByPageBanner =
            usersViewModel.lastRoleViolations !== initialRoleViolations ||
            usersViewModel.lastRolePartialFailure !== initialRolePartialFailure;

          if (handledByPageBanner) {
            this.submissionError = null;
            this.submissionErrorDetails = null;
          } else {
            // Non-role failures (profile-update error, network error, etc.)
            // still surface inline in the form. Prefer the rich
            // `errorDetails.message` over the bare `error` code string.
            this.submissionError =
              result.errorDetails?.message ?? result.error ?? 'An error occurred';
            // Extract detailed error info for display + tracing. The context
            // (when present) carries the rich violation detail; the
            // correlationId is captured regardless so the page's reportFailure
            // can log it (it's threaded through, never displayed).
            const ctx = result.errorDetails?.context as Record<string, unknown> | undefined;
            const correlationId = result.errorDetails?.correlationId;
            if (ctx || correlationId || result.errorDetails?.code) {
              this.submissionErrorDetails = {
                code: result.errorDetails?.code ?? (ctx?.code as string | undefined),
                details: ctx ? this.formatViolationDetails(ctx) : undefined,
                correlationId,
              };
            } else {
              this.submissionErrorDetails = null;
            }
          }
          log.warn('Form submission failed', {
            mode: this.mode,
            error: result.error,
            errorDetails: result.errorDetails,
            handledByPageBanner,
          });
        }
      });

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : this.mode === 'create'
            ? 'Failed to send invitation'
            : 'Failed to update user';

      runInAction(() => {
        this.isSubmitting = false;
        this.submissionError = errorMessage;
      });

      log.error('Form submission error', { mode: this.mode, error });

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
      // reset() rebuilds formData wholesale, so the names are already gone —
      // clear the tracking flags too or the next lookup's revert misfires.
      this.prefilledNameFromLookup = { first: false, last: false };
      this.lastLookedUpEmail = null;
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
}
