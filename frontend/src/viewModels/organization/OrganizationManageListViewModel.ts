/**
 * Organization Manage List ViewModel
 *
 * Manages state and business logic for the organization list in the manage page.
 * Uses MobX for reactive state management and dependency injection for services.
 *
 * Features:
 * - Organization list state management (selection, filtering)
 * - Lifecycle operations (deactivate, reactivate, delete)
 * - Loading and error states
 *
 * Dependencies:
 * - IOrganizationQueryService: Read operations
 * - IOrganizationCommandService: Write operations (lifecycle)
 *
 * @see IOrganizationQueryService
 * @see IOrganizationCommandService
 * @see OrganizationManageFormViewModel for form state
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { Logger } from '@/utils/logger';
import type { IOrganizationQueryService } from '@/services/organization/IOrganizationQueryService';
import type { IOrganizationCommandService } from '@/services/organization/IOrganizationCommandService';
import { getOrganizationQueryService } from '@/services/organization/OrganizationQueryServiceFactory';
import { getOrganizationCommandService } from '@/services/organization/OrganizationCommandServiceFactory';
import type {
  Organization,
  OrganizationFilterOptions,
  OrganizationOperationResult,
} from '@/types/organization.types';

const log = Logger.getLogger('viewmodel');

/**
 * Organization Manage List ViewModel
 *
 * MVVM pattern with constructor injection for dependency inversion.
 * Manages organization list state including selection, filtering, and lifecycle operations.
 */
export class OrganizationManageListViewModel {
  // ============================================
  // Observable State
  // ============================================

  /** Array of all organizations from service */
  private rawOrganizations: Organization[] = [];

  /** Currently selected organization ID (null if none selected) */
  selectedOrgId: string | null = null;

  /** Loading state for async operations */
  isLoading = false;

  /** Error message from last failed operation */
  error: string | null = null;

  /** Current filter options */
  filters: OrganizationFilterOptions = { status: 'all' };

  // ============================================
  // Constructor
  // ============================================

  constructor(
    private queryService: IOrganizationQueryService = getOrganizationQueryService(),
    private commandService: IOrganizationCommandService = getOrganizationCommandService()
  ) {
    makeAutoObservable(this);
    log.debug('OrganizationManageListViewModel initialized');
  }

  // ============================================
  // Computed Properties
  // ============================================

  /** Filtered list of organizations */
  get organizations(): Organization[] {
    return [...this.rawOrganizations];
  }

  /** Currently selected organization (or null) */
  get selectedOrganization(): Organization | null {
    if (!this.selectedOrgId) return null;
    return this.rawOrganizations.find((o) => o.id === this.selectedOrgId) ?? null;
  }

  /** Whether the selected org can be deactivated (must be active) */
  get canDeactivate(): boolean {
    const org = this.selectedOrganization;
    if (!org) return false;
    return org.is_active;
  }

  /** Whether the selected org can be reactivated (must be inactive) */
  get canReactivate(): boolean {
    const org = this.selectedOrganization;
    if (!org) return false;
    return !org.is_active;
  }

  /** Whether the selected org can be deleted (must be inactive first) */
  get canDelete(): boolean {
    const org = this.selectedOrganization;
    if (!org) return false;
    return !org.is_active;
  }

  /** Total number of organizations */
  get organizationCount(): number {
    return this.rawOrganizations.length;
  }

  /** Number of active organizations */
  get activeOrganizationCount(): number {
    return this.rawOrganizations.filter((o) => o.is_active).length;
  }

  // ============================================
  // Actions - Data Loading
  // ============================================

  /** Load all organizations */
  async loadOrganizations(filters?: OrganizationFilterOptions): Promise<void> {
    log.debug('Loading organizations', { filters });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
      if (filters) {
        this.filters = filters;
      }
    });

    try {
      const organizations = await this.queryService.getOrganizations(this.filters);

      runInAction(() => {
        // Exclude platform_owner from manage list — it's not manageable
        this.rawOrganizations = organizations.filter((o) => o.type !== 'platform_owner');
        this.isLoading = false;
        log.info('Loaded organizations', { count: this.rawOrganizations.length });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load organizations';

      runInAction(() => {
        this.isLoading = false;
        this.error = errorMessage;
      });

      log.error('Failed to load organizations', error);
    }
  }

  /** Refresh organizations (reload with current filters) */
  async refresh(): Promise<void> {
    await this.loadOrganizations();
  }

  // ============================================
  // Actions - Selection
  // ============================================

  /** Select an organization by ID */
  selectOrganization(orgId: string | null): void {
    runInAction(() => {
      this.selectedOrgId = orgId;
      log.debug('Selected organization', { orgId });
    });
  }

  /** Clear the current selection */
  clearSelection(): void {
    this.selectOrganization(null);
  }

  // ============================================
  // Actions - Filtering
  // ============================================

  /** Update filter options and reload */
  async setFilters(filters: OrganizationFilterOptions): Promise<void> {
    await this.loadOrganizations(filters);
  }

  /** Set status filter */
  async setStatusFilter(status: 'all' | 'active' | 'inactive'): Promise<void> {
    await this.setFilters({ ...this.filters, status });
  }

  /** Set search term filter */
  async setSearchFilter(searchTerm: string): Promise<void> {
    await this.setFilters({ ...this.filters, searchTerm: searchTerm || undefined });
  }

  // ============================================
  // Actions - Lifecycle Operations
  // ============================================

  /** Deactivate an organization */
  async deactivateOrganization(
    orgId: string,
    reason?: string
  ): Promise<OrganizationOperationResult> {
    log.debug('Deactivating organization', { orgId, reason });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const result = await this.commandService.deactivateOrganization(orgId, reason);

      if (result.success) {
        runInAction(() => {
          const index = this.rawOrganizations.findIndex((o) => o.id === orgId);
          if (index !== -1) {
            const updated = { ...this.rawOrganizations[index], is_active: false };
            this.rawOrganizations = [
              ...this.rawOrganizations.slice(0, index),
              updated,
              ...this.rawOrganizations.slice(index + 1),
            ];
          }
          this.isLoading = false;
        });
        log.info('Deactivated organization', { orgId });
      } else {
        runInAction(() => {
          this.error = result.error ?? 'Failed to deactivate organization';
          this.isLoading = false;
        });
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to deactivate organization';

      runInAction(() => {
        this.error = errorMessage;
        this.isLoading = false;
      });

      log.error('Error deactivating organization', error);
      return { success: false, error: errorMessage };
    }
  }

  /** Reactivate an organization */
  async reactivateOrganization(orgId: string): Promise<OrganizationOperationResult> {
    log.debug('Reactivating organization', { orgId });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const result = await this.commandService.reactivateOrganization(orgId);

      if (result.success) {
        runInAction(() => {
          const index = this.rawOrganizations.findIndex((o) => o.id === orgId);
          if (index !== -1) {
            const updated = { ...this.rawOrganizations[index], is_active: true };
            this.rawOrganizations = [
              ...this.rawOrganizations.slice(0, index),
              updated,
              ...this.rawOrganizations.slice(index + 1),
            ];
          }
          this.isLoading = false;
        });
        log.info('Reactivated organization', { orgId });
      } else {
        runInAction(() => {
          this.error = result.error ?? 'Failed to reactivate organization';
          this.isLoading = false;
        });
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to reactivate organization';

      runInAction(() => {
        this.error = errorMessage;
        this.isLoading = false;
      });

      log.error('Error reactivating organization', error);
      return { success: false, error: errorMessage };
    }
  }

  /** Delete an organization (must be deactivated first) */
  async deleteOrganization(orgId: string, reason?: string): Promise<OrganizationOperationResult> {
    log.debug('Deleting organization', { orgId, reason });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const result = await this.commandService.deleteOrganization(orgId, reason);

      if (result.success) {
        runInAction(() => {
          this.rawOrganizations = this.rawOrganizations.filter((o) => o.id !== orgId);
          if (this.selectedOrgId === orgId) {
            this.selectedOrgId = null;
          }
          this.isLoading = false;
        });
        log.info('Deleted organization', { orgId });
      } else {
        runInAction(() => {
          this.error = result.error ?? 'Failed to delete organization';
          this.isLoading = false;
        });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete organization';

      runInAction(() => {
        this.error = errorMessage;
        this.isLoading = false;
      });

      log.error('Error deleting organization', error);
      return { success: false, error: errorMessage };
    }
  }

  // ============================================
  // Utility Methods
  // ============================================

  /** Clear error state */
  clearError(): void {
    runInAction(() => {
      this.error = null;
    });
  }

  /** Get an organization by ID from loaded data */
  getOrganizationById(orgId: string): Organization | null {
    return this.rawOrganizations.find((o) => o.id === orgId) ?? null;
  }
}
