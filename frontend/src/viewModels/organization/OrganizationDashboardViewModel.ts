/**
 * Organization Dashboard ViewModel
 *
 * Manages state and business logic for the organization dashboard page.
 * Supports viewing organization details and editing basic fields.
 *
 * Features:
 * - Load organization by ID
 * - Edit mode for updating name, display_name, timezone
 * - Event-driven updates via domain events
 * - Loading, saving, and error states
 * - Field validation
 *
 * Usage:
 * ```typescript
 * const viewModel = new OrganizationDashboardViewModel();
 * await viewModel.loadOrganization('org-uuid');
 * viewModel.enterEditMode();
 * viewModel.updateField('name', 'New Name');
 * await viewModel.saveChanges();
 * ```
 */

import { makeAutoObservable, runInAction } from 'mobx';
import type { IOrganizationQueryService } from '@/services/organization/IOrganizationQueryService';
import type { IOrganizationCommandService } from '@/services/organization/IOrganizationCommandService';
import { createOrganizationQueryService } from '@/services/organization/OrganizationQueryServiceFactory';
import { getOrganizationCommandService } from '@/services/organization/OrganizationCommandServiceFactory';
import type { Organization, OrganizationUpdateData } from '@/types/organization.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('viewmodel');

/**
 * Editable fields for organization
 */
export interface EditableOrganizationData {
  name: string;
  display_name: string;
  timezone: string;
}

/**
 * Field validation errors
 */
export interface ValidationErrors {
  name?: string;
  display_name?: string;
  timezone?: string;
}

/**
 * Organization Dashboard ViewModel
 */
export class OrganizationDashboardViewModel {
  // Organization data
  organization: Organization | null = null;
  organizationId: string | null = null;

  // Edit mode state
  isEditMode = false;
  editData: EditableOrganizationData = {
    name: '',
    display_name: '',
    timezone: '',
  };

  // Loading/Error states
  isLoading = false;
  isSaving = false;
  loadError: string | null = null;
  saveError: string | null = null;
  validationErrors: ValidationErrors = {};

  /**
   * Constructor with dependency injection
   */
  constructor(
    private queryService: IOrganizationQueryService = createOrganizationQueryService(),
    private commandService: IOrganizationCommandService = getOrganizationCommandService()
  ) {
    makeAutoObservable(this);
    log.debug('OrganizationDashboardViewModel initialized');
  }

  /**
   * Load organization by ID
   */
  async loadOrganization(orgId: string): Promise<void> {
    runInAction(() => {
      this.organizationId = orgId;
      this.isLoading = true;
      this.loadError = null;
    });

    try {
      log.debug('Loading organization', { orgId });

      const organization = await this.queryService.getOrganizationById(orgId);

      runInAction(() => {
        if (organization) {
          this.organization = organization;
          // Initialize edit data with current values
          this.editData = {
            name: organization.name,
            display_name: organization.display_name || '',
            timezone: organization.time_zone,
          };
          log.info('Organization loaded', { orgId, name: organization.name });
        } else {
          this.loadError = 'Organization not found';
          log.warn('Organization not found', { orgId });
        }
        this.isLoading = false;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load organization';
      runInAction(() => {
        this.loadError = message;
        this.isLoading = false;
      });
      log.error('Failed to load organization', { error, orgId });
    }
  }

  /**
   * Enter edit mode
   */
  enterEditMode(): void {
    if (!this.organization) {
      log.warn('Cannot enter edit mode without organization');
      return;
    }

    runInAction(() => {
      this.isEditMode = true;
      // Reset edit data to current values
      this.editData = {
        name: this.organization!.name,
        display_name: this.organization!.display_name || '',
        timezone: this.organization!.time_zone,
      };
      this.validationErrors = {};
      this.saveError = null;
    });

    log.debug('Entered edit mode');
  }

  /**
   * Cancel edit mode and reset changes
   */
  cancelEdit(): void {
    runInAction(() => {
      this.isEditMode = false;
      // Reset edit data to current organization values
      if (this.organization) {
        this.editData = {
          name: this.organization.name,
          display_name: this.organization.display_name || '',
          timezone: this.organization.time_zone,
        };
      }
      this.validationErrors = {};
      this.saveError = null;
    });

    log.debug('Cancelled edit mode');
  }

  /**
   * Update a single field in edit data
   */
  updateField<K extends keyof EditableOrganizationData>(
    field: K,
    value: EditableOrganizationData[K]
  ): void {
    runInAction(() => {
      this.editData[field] = value;
      // Clear validation error for this field
      if (this.validationErrors[field]) {
        delete this.validationErrors[field];
      }
    });
  }

  /**
   * Validate edit data
   */
  private validate(): boolean {
    const errors: ValidationErrors = {};

    if (!this.editData.name.trim()) {
      errors.name = 'Name is required';
    } else if (this.editData.name.length > 255) {
      errors.name = 'Name must be 255 characters or less';
    }

    if (this.editData.display_name && this.editData.display_name.length > 255) {
      errors.display_name = 'Display name must be 255 characters or less';
    }

    if (!this.editData.timezone.trim()) {
      errors.timezone = 'Timezone is required';
    }

    runInAction(() => {
      this.validationErrors = errors;
    });

    return Object.keys(errors).length === 0;
  }

  /**
   * Check if there are unsaved changes
   */
  get hasChanges(): boolean {
    if (!this.organization) return false;

    return (
      this.editData.name !== this.organization.name ||
      this.editData.display_name !== (this.organization.display_name || '') ||
      this.editData.timezone !== this.organization.time_zone
    );
  }

  /**
   * Get the fields that have changed
   */
  private getChangedFields(): OrganizationUpdateData {
    if (!this.organization) return {};

    const changes: OrganizationUpdateData = {};

    if (this.editData.name !== this.organization.name) {
      changes.name = this.editData.name;
    }

    if (this.editData.display_name !== (this.organization.display_name || '')) {
      changes.display_name = this.editData.display_name || undefined;
    }

    if (this.editData.timezone !== this.organization.time_zone) {
      changes.timezone = this.editData.timezone;
    }

    return changes;
  }

  /**
   * Save changes via domain event
   */
  async saveChanges(): Promise<boolean> {
    if (!this.organization || !this.organizationId) {
      log.warn('Cannot save without organization');
      return false;
    }

    // Validate
    if (!this.validate()) {
      log.debug('Validation failed', { errors: this.validationErrors });
      return false;
    }

    // Check for changes
    const changes = this.getChangedFields();
    if (Object.keys(changes).length === 0) {
      log.debug('No changes to save');
      runInAction(() => {
        this.isEditMode = false;
      });
      return true;
    }

    runInAction(() => {
      this.isSaving = true;
      this.saveError = null;
    });

    try {
      log.debug('Saving organization changes', { orgId: this.organizationId, changes });

      await this.commandService.updateOrganization(
        this.organizationId,
        changes,
        'Updated via dashboard'
      );

      // Reload to get updated data from projection
      await this.loadOrganization(this.organizationId);

      runInAction(() => {
        this.isEditMode = false;
        this.isSaving = false;
      });

      log.info('Organization updated successfully', { orgId: this.organizationId });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save changes';
      runInAction(() => {
        this.saveError = message;
        this.isSaving = false;
      });
      log.error('Failed to save organization changes', { error, orgId: this.organizationId });
      return false;
    }
  }

  /**
   * Refresh organization data
   */
  async refresh(): Promise<void> {
    if (this.organizationId) {
      await this.loadOrganization(this.organizationId);
    }
  }

  /**
   * Get organization type display name
   */
  get typeDisplayName(): string {
    if (!this.organization) return '';

    const typeMap: Record<string, string> = {
      platform_owner: 'Platform Owner',
      provider: 'Provider',
      provider_partner: 'Partner',
    };

    return typeMap[this.organization.type] || this.organization.type;
  }

  /**
   * Get organization status display
   */
  get statusDisplay(): { label: string; color: string } {
    if (!this.organization) {
      return { label: 'Unknown', color: 'gray' };
    }

    return this.organization.is_active
      ? { label: 'Active', color: 'green' }
      : { label: 'Inactive', color: 'red' };
  }
}
