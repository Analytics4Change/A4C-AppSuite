/**
 * Role Form ViewModel
 *
 * Manages state and business logic for role create/edit forms.
 * Uses MobX for reactive state management and dependency injection for services.
 *
 * Features:
 * - Form state management for create and edit modes
 * - Permission selection with subset-only enforcement
 * - Field validation with error messages
 * - Submit handling with async operations
 * - Dirty tracking and form reset
 *
 * Dependencies:
 * - IRoleService: CRUD operations (MockRoleService | SupabaseRoleService)
 *
 * Usage:
 * ```typescript
 * // Create mode
 * const viewModel = new RoleFormViewModel(service, 'create', permissions, userPermissions);
 *
 * // Edit mode with existing role
 * const viewModel = new RoleFormViewModel(service, 'edit', permissions, userPermissions, existingRole);
 * ```
 *
 * @see IRoleService
 * @see RolesViewModel for list state
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { Logger } from '@/utils/logger';
import type { IRoleService } from '@/services/roles/IRoleService';
import { getRoleService } from '@/services/roles/RoleServiceFactory';
import type {
  Role,
  RoleWithPermissions,
  Permission,
  PermissionGroup,
  CreateRoleRequest,
  UpdateRoleRequest,
  RoleOperationResult,
  RoleFormData,
} from '@/types/role.types';
import {
  groupPermissionsByApplet,
  canGrantPermission,
  validateRoleName,
  validateRoleDescription,
} from '@/types/role.types';

const log = Logger.getLogger('viewmodel');

/**
 * Form mode: create new role or edit existing
 */
export type FormMode = 'create' | 'edit';

/**
 * Role Form ViewModel
 *
 * MVVM pattern with constructor injection for dependency inversion.
 * Handles form state for both create and edit modes, including permission selection.
 */
export class RoleFormViewModel {
  // ============================================
  // Observable State
  // ============================================

  /** Current form data */
  formData: RoleFormData;

  /** Original form data (for dirty detection in edit mode) */
  private originalData: RoleFormData;

  /** Selected permission IDs */
  selectedPermissionIds: Set<string> = new Set();

  /** Original permission IDs (for dirty detection) */
  private originalPermissionIds: Set<string> = new Set();

  /** Validation errors by field */
  errors: Map<keyof RoleFormData, string> = new Map();

  /** Fields that have been touched (for showing errors) */
  touchedFields: Set<keyof RoleFormData> = new Set();

  /** Form submission in progress */
  isSubmitting = false;

  /** Error message from last submission attempt */
  submissionError: string | null = null;

  /** Form mode (create or edit) */
  readonly mode: FormMode;

  /** Role ID being edited (edit mode only) */
  readonly editingRoleId: string | null;

  /** All available permissions */
  readonly allPermissions: Permission[];

  /** User's permission IDs (for subset-only enforcement) */
  readonly userPermissionIds: Set<string>;

  // ============================================
  // Constructor
  // ============================================

  /**
   * Constructor with dependency injection
   *
   * @param service - Role service (defaults to factory-created instance)
   * @param mode - Form mode (create or edit)
   * @param allPermissions - All available permissions
   * @param userPermissionIds - User's permission IDs for subset-only enforcement
   * @param existingRole - Existing role to edit (required for edit mode)
   */
  constructor(
    private service: IRoleService = getRoleService(),
    mode: FormMode = 'create',
    allPermissions: Permission[] = [],
    userPermissionIds: string[] = [],
    existingRole?: RoleWithPermissions
  ) {
    this.mode = mode;
    this.editingRoleId = existingRole?.id ?? null;
    this.allPermissions = allPermissions;
    this.userPermissionIds = new Set(userPermissionIds);

    // Initialize form data based on mode
    if (mode === 'edit' && existingRole) {
      this.formData = {
        name: existingRole.name,
        description: existingRole.description,
        orgHierarchyScope: existingRole.orgHierarchyScope,
      };
      this.selectedPermissionIds = new Set(existingRole.permissions.map((p) => p.id));
    } else {
      this.formData = {
        name: '',
        description: '',
        orgHierarchyScope: null,
      };
      this.selectedPermissionIds = new Set();
    }

    // Store originals for dirty tracking
    this.originalData = { ...this.formData };
    this.originalPermissionIds = new Set(this.selectedPermissionIds);

    makeAutoObservable(this);

    log.debug('RoleFormViewModel initialized', {
      mode,
      editingRoleId: this.editingRoleId,
      permissionCount: this.selectedPermissionIds.size,
    });
  }

  // ============================================
  // Computed Properties
  // ============================================

  /**
   * Permissions grouped by applet for UI display
   */
  get permissionGroups(): PermissionGroup[] {
    return groupPermissionsByApplet(this.allPermissions);
  }

  /**
   * Whether the form has validation errors
   */
  get hasErrors(): boolean {
    return this.errors.size > 0;
  }

  /**
   * Whether the form has unsaved changes
   */
  get isDirty(): boolean {
    // Check form data changes
    if (
      this.formData.name !== this.originalData.name ||
      this.formData.description !== this.originalData.description ||
      this.formData.orgHierarchyScope !== this.originalData.orgHierarchyScope
    ) {
      return true;
    }

    // Check permission changes
    if (this.selectedPermissionIds.size !== this.originalPermissionIds.size) {
      return true;
    }

    for (const id of this.selectedPermissionIds) {
      if (!this.originalPermissionIds.has(id)) {
        return true;
      }
    }

    return false;
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
    return this.isDirty && !this.isSubmitting && this.validateAll();
  }

  /**
   * Number of selected permissions
   */
  get selectedPermissionCount(): number {
    return this.selectedPermissionIds.size;
  }

  /**
   * Get error message for a specific field
   */
  getFieldError(field: keyof RoleFormData): string | null {
    if (!this.touchedFields.has(field)) {
      return null;
    }
    return this.errors.get(field) ?? null;
  }

  /**
   * Check if a field has an error (and has been touched)
   */
  hasFieldError(field: keyof RoleFormData): boolean {
    return this.touchedFields.has(field) && this.errors.has(field);
  }

  // ============================================
  // Permission Helpers
  // ============================================

  /**
   * Check if user can grant a specific permission (subset-only rule)
   */
  canGrant(permissionId: string): boolean {
    return canGrantPermission(permissionId, this.userPermissionIds);
  }

  /**
   * Check if a permission is currently selected
   */
  isPermissionSelected(permissionId: string): boolean {
    return this.selectedPermissionIds.has(permissionId);
  }

  /**
   * Get all selected permissions for a specific applet
   */
  getSelectedInApplet(applet: string): Permission[] {
    return this.allPermissions.filter(
      (p) => p.applet === applet && this.selectedPermissionIds.has(p.id)
    );
  }

  /**
   * Get count of selected permissions in an applet
   */
  getSelectedCountInApplet(applet: string): number {
    return this.getSelectedInApplet(applet).length;
  }

  /**
   * Check if all grantable permissions in an applet are selected
   */
  isAppletFullySelected(applet: string): boolean {
    const appletPerms = this.allPermissions.filter((p) => p.applet === applet);
    const grantablePerms = appletPerms.filter((p) => this.canGrant(p.id));
    if (grantablePerms.length === 0) return false;
    return grantablePerms.every((p) => this.selectedPermissionIds.has(p.id));
  }

  /**
   * Check if some (but not all) grantable permissions in an applet are selected
   */
  isAppletPartiallySelected(applet: string): boolean {
    const appletPerms = this.allPermissions.filter((p) => p.applet === applet);
    const grantablePerms = appletPerms.filter((p) => this.canGrant(p.id));
    if (grantablePerms.length === 0) return false;

    const selectedCount = grantablePerms.filter((p) =>
      this.selectedPermissionIds.has(p.id)
    ).length;
    return selectedCount > 0 && selectedCount < grantablePerms.length;
  }

  // ============================================
  // Actions - Permission Selection
  // ============================================

  /**
   * Toggle a permission selection
   */
  togglePermission(permissionId: string): void {
    if (!this.canGrant(permissionId)) {
      log.warn('Cannot toggle permission - user does not possess it', { permissionId });
      return;
    }

    runInAction(() => {
      if (this.selectedPermissionIds.has(permissionId)) {
        this.selectedPermissionIds.delete(permissionId);
      } else {
        this.selectedPermissionIds.add(permissionId);
      }
      // Create new Set to trigger MobX reactivity
      this.selectedPermissionIds = new Set(this.selectedPermissionIds);
      this.submissionError = null;
      log.debug('Toggled permission', {
        permissionId,
        selected: this.selectedPermissionIds.has(permissionId),
      });
    });
  }

  /**
   * Select a specific permission
   */
  selectPermission(permissionId: string): void {
    if (!this.canGrant(permissionId)) return;

    runInAction(() => {
      this.selectedPermissionIds.add(permissionId);
      this.selectedPermissionIds = new Set(this.selectedPermissionIds);
      this.submissionError = null;
    });
  }

  /**
   * Deselect a specific permission
   */
  deselectPermission(permissionId: string): void {
    runInAction(() => {
      this.selectedPermissionIds.delete(permissionId);
      this.selectedPermissionIds = new Set(this.selectedPermissionIds);
      this.submissionError = null;
    });
  }

  /**
   * Select all grantable permissions in an applet
   */
  selectAllInApplet(applet: string): void {
    runInAction(() => {
      const appletPerms = this.allPermissions.filter((p) => p.applet === applet);
      for (const perm of appletPerms) {
        if (this.canGrant(perm.id)) {
          this.selectedPermissionIds.add(perm.id);
        }
      }
      this.selectedPermissionIds = new Set(this.selectedPermissionIds);
      this.submissionError = null;
      log.debug('Selected all in applet', { applet });
    });
  }

  /**
   * Deselect all permissions in an applet
   */
  deselectAllInApplet(applet: string): void {
    runInAction(() => {
      const appletPerms = this.allPermissions.filter((p) => p.applet === applet);
      for (const perm of appletPerms) {
        this.selectedPermissionIds.delete(perm.id);
      }
      this.selectedPermissionIds = new Set(this.selectedPermissionIds);
      this.submissionError = null;
      log.debug('Deselected all in applet', { applet });
    });
  }

  /**
   * Toggle all grantable permissions in an applet
   */
  toggleApplet(applet: string): void {
    if (this.isAppletFullySelected(applet)) {
      this.deselectAllInApplet(applet);
    } else {
      this.selectAllInApplet(applet);
    }
  }

  /**
   * Clear all permission selections
   */
  clearAllPermissions(): void {
    runInAction(() => {
      this.selectedPermissionIds = new Set();
      this.submissionError = null;
      log.debug('Cleared all permissions');
    });
  }

  // ============================================
  // Actions - Field Updates
  // ============================================

  /**
   * Update a form field value
   */
  updateField<K extends keyof RoleFormData>(field: K, value: RoleFormData[K]): void {
    runInAction(() => {
      this.formData[field] = value;
      this.touchedFields.add(field);
      this.submissionError = null;
      this.validateField(field);
    });
  }

  /**
   * Mark a field as touched
   */
  touchField(field: keyof RoleFormData): void {
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
      (Object.keys(this.formData) as (keyof RoleFormData)[]).forEach((field) => {
        this.touchedFields.add(field);
      });
      this.validateAll();
    });
  }

  // ============================================
  // Actions - Validation
  // ============================================

  /**
   * Validate a specific field
   */
  validateField(field: keyof RoleFormData): boolean {
    let error: string | null = null;

    switch (field) {
      case 'name':
        error = validateRoleName(this.formData.name);
        break;

      case 'description':
        error = validateRoleDescription(this.formData.description);
        break;

      case 'orgHierarchyScope':
        // Optional field - no validation required
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
    const fields: (keyof RoleFormData)[] = ['name', 'description'];

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
   */
  async submit(): Promise<RoleOperationResult> {
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

    runInAction(() => {
      this.isSubmitting = true;
      this.submissionError = null;
    });

    try {
      let result: RoleOperationResult;
      const permissionIds = Array.from(this.selectedPermissionIds);

      if (this.mode === 'create') {
        const request: CreateRoleRequest = {
          name: this.formData.name.trim(),
          description: this.formData.description.trim(),
          orgHierarchyScope: this.formData.orgHierarchyScope || undefined,
          permissionIds,
        };

        log.debug('Submitting create request', { request });
        result = await this.service.createRole(request);
      } else {
        // Edit mode
        if (!this.editingRoleId) {
          throw new Error('No role ID for edit mode');
        }

        const request: UpdateRoleRequest = {
          id: this.editingRoleId,
          name: this.formData.name.trim(),
          description: this.formData.description.trim(),
          permissionIds,
        };

        log.debug('Submitting update request', { request });
        result = await this.service.updateRole(request);
      }

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          // Update originals so form shows as not dirty
          this.originalData = { ...this.formData };
          this.originalPermissionIds = new Set(this.selectedPermissionIds);
          log.info('Form submitted successfully', {
            mode: this.mode,
            roleId: result.role?.id ?? this.editingRoleId,
          });
        } else {
          this.submissionError = result.error ?? 'An error occurred';
          log.warn('Form submission failed', { error: result.error });
        }
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to submit form';

      runInAction(() => {
        this.isSubmitting = false;
        this.submissionError = errorMessage;
      });

      log.error('Form submission error', error);

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
   * Reset form to original values
   */
  reset(): void {
    runInAction(() => {
      this.formData = { ...this.originalData };
      this.selectedPermissionIds = new Set(this.originalPermissionIds);
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
   * Set organizational unit scope
   */
  setScope(scope: string | null): void {
    this.updateField('orgHierarchyScope', scope);
  }
}
