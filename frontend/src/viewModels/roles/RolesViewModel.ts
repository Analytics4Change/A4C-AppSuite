/**
 * Roles ViewModel
 *
 * Manages state and business logic for role list display and CRUD operations.
 * Uses MobX for reactive state management and dependency injection for services.
 *
 * Features:
 * - Role list state management (selection, filtering)
 * - CRUD operations delegated to service
 * - Loading and error states
 * - Permission loading for subset-only enforcement
 *
 * Dependencies:
 * - IRoleService: CRUD operations (MockRoleService | SupabaseRoleService)
 *
 * Usage:
 * ```typescript
 * const viewModel = new RolesViewModel();
 * await viewModel.loadRoles();
 *
 * // Or with injected service for testing:
 * const viewModel = new RolesViewModel(mockService);
 * ```
 *
 * @see IRoleService
 * @see RoleFormViewModel for form state
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { Logger } from '@/utils/logger';
import { isCanonicalRole } from '@/config/roles.config';
import type { IRoleService } from '@/services/roles/IRoleService';
import { getRoleService } from '@/services/roles/RoleServiceFactory';
import type {
  Role,
  RoleWithPermissions,
  Permission,
  RoleFilterOptions,
  CreateRoleRequest,
  UpdateRoleRequest,
  RoleOperationResult,
} from '@/types/role.types';

const log = Logger.getLogger('viewmodel');

/**
 * Roles ViewModel
 *
 * MVVM pattern with constructor injection for dependency inversion.
 * Manages role list state including selection, filtering, and CRUD operations.
 */
export class RolesViewModel {
  // ============================================
  // Observable State
  // ============================================

  /** Array of all roles from service */
  private rawRoles: Role[] = [];

  /** Currently selected role ID (null if none selected) */
  selectedRoleId: string | null = null;

  /** Loading state for async operations */
  isLoading = false;

  /** Error message from last failed operation */
  error: string | null = null;

  /** Current filter options */
  filters: RoleFilterOptions = { status: 'all' };

  /** All available permissions (for permission selector) */
  allPermissions: Permission[] = [];

  /** Current user's permission IDs (for subset-only enforcement) */
  userPermissionIds: string[] = [];

  // ============================================
  // Constructor
  // ============================================

  /**
   * Constructor with dependency injection
   *
   * @param service - Role service (defaults to factory-created instance)
   */
  constructor(private service: IRoleService = getRoleService()) {
    makeAutoObservable(this);
    log.debug('RolesViewModel initialized');
  }

  // ============================================
  // Computed Properties
  // ============================================

  /**
   * Filtered and sorted list of roles
   */
  get roles(): Role[] {
    return [...this.rawRoles];
  }

  /**
   * Currently selected role (or null if none selected)
   */
  get selectedRole(): Role | null {
    if (!this.selectedRoleId) return null;
    return this.rawRoles.find((r) => r.id === this.selectedRoleId) ?? null;
  }

  /**
   * Whether the selected role can be edited
   * - Must have a selection
   * - Must be active (inactive roles can't be edited)
   */
  get canEdit(): boolean {
    const role = this.selectedRole;
    if (!role) return false;
    return role.isActive;
  }

  /**
   * Whether the selected role can be deactivated
   * - Must have a selection
   * - Must be currently active
   */
  get canDeactivate(): boolean {
    const role = this.selectedRole;
    if (!role) return false;
    return role.isActive;
  }

  /**
   * Whether the selected role can be reactivated
   * - Must have a selection
   * - Must be currently inactive
   */
  get canReactivate(): boolean {
    const role = this.selectedRole;
    if (!role) return false;
    return !role.isActive;
  }

  /**
   * Whether the selected role can be deleted
   * - Must have a selection
   * - Must be inactive (deactivated first)
   * - Must have no users assigned
   */
  get canDelete(): boolean {
    const role = this.selectedRole;
    if (!role) return false;
    if (role.isActive) return false;
    if (role.userCount > 0) return false;
    return true;
  }

  /**
   * Whether a new role can be created
   */
  get canCreate(): boolean {
    return !this.isLoading;
  }

  /**
   * Total number of roles
   */
  get roleCount(): number {
    return this.rawRoles.length;
  }

  /**
   * Number of active roles
   */
  get activeRoleCount(): number {
    return this.rawRoles.filter((r) => r.isActive).length;
  }

  /**
   * Set of user's permission IDs for quick lookup
   */
  get userPermissionIdSet(): Set<string> {
    return new Set(this.userPermissionIds);
  }

  // ============================================
  // Actions - Data Loading
  // ============================================

  /**
   * Load all roles
   *
   * @param filters - Optional filters to apply
   */
  async loadRoles(filters?: RoleFilterOptions): Promise<void> {
    log.debug('Loading roles', { filters });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
      if (filters) {
        this.filters = filters;
      }
    });

    try {
      const roles = await this.service.getRoles(this.filters);

      runInAction(() => {
        // Filter out canonical/system roles - they should not be visible in Role Management UI
        const visibleRoles = roles.filter((role) => !isCanonicalRole(role.name));
        this.rawRoles = visibleRoles;
        this.isLoading = false;
        log.info('Loaded roles', {
          totalFromApi: roles.length,
          visibleCount: visibleRoles.length,
          hiddenCanonicalRoles: roles.length - visibleRoles.length,
        });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load roles';

      runInAction(() => {
        this.isLoading = false;
        this.error = errorMessage;
      });

      log.error('Failed to load roles', error);
    }
  }

  /**
   * Load all available permissions (for permission selector)
   */
  async loadPermissions(): Promise<void> {
    log.debug('Loading permissions');

    try {
      const permissions = await this.service.getPermissions();

      runInAction(() => {
        this.allPermissions = permissions;
        log.info('Loaded permissions', { count: permissions.length });
      });
    } catch (error) {
      log.error('Failed to load permissions', error);
      // Don't set error state - permissions are secondary data
    }
  }

  /**
   * Load current user's permissions (for subset-only enforcement)
   */
  async loadUserPermissions(): Promise<void> {
    log.debug('Loading user permissions');

    try {
      const permissionIds = await this.service.getUserPermissions();

      runInAction(() => {
        this.userPermissionIds = permissionIds;
        log.info('Loaded user permissions', { count: permissionIds.length });
      });
    } catch (error) {
      log.error('Failed to load user permissions', error);
      // Don't set error state - user permissions are secondary data
    }
  }

  /**
   * Load all data needed for role management
   */
  async loadAll(): Promise<void> {
    await Promise.all([this.loadRoles(), this.loadPermissions(), this.loadUserPermissions()]);
  }

  /**
   * Refresh roles (reload with current filters)
   */
  async refresh(): Promise<void> {
    await this.loadRoles();
  }

  // ============================================
  // Actions - Selection
  // ============================================

  /**
   * Select a role by ID
   *
   * @param roleId - ID of role to select (null to clear selection)
   */
  selectRole(roleId: string | null): void {
    runInAction(() => {
      this.selectedRoleId = roleId;
      log.debug('Selected role', { roleId });
    });
  }

  /**
   * Clear the current selection
   */
  clearSelection(): void {
    this.selectRole(null);
  }

  // ============================================
  // Actions - Filtering
  // ============================================

  /**
   * Update filter options and reload
   *
   * @param filters - New filter options
   */
  async setFilters(filters: RoleFilterOptions): Promise<void> {
    await this.loadRoles(filters);
  }

  /**
   * Set status filter
   *
   * @param status - Status filter value
   */
  async setStatusFilter(status: 'all' | 'active' | 'inactive'): Promise<void> {
    await this.setFilters({ ...this.filters, status });
  }

  /**
   * Set search term filter
   *
   * @param searchTerm - Search term
   */
  async setSearchFilter(searchTerm: string): Promise<void> {
    await this.setFilters({ ...this.filters, searchTerm: searchTerm || undefined });
  }

  // ============================================
  // Actions - CRUD Operations
  // ============================================

  /**
   * Create a new role
   *
   * @param request - Creation request
   * @returns Operation result
   */
  async createRole(request: CreateRoleRequest): Promise<RoleOperationResult> {
    log.debug('Creating role', { request });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const result = await this.service.createRole(request);

      if (result.success && result.role) {
        runInAction(() => {
          // Add new role to list
          this.rawRoles = [...this.rawRoles, result.role!];
          // Select the new role
          this.selectedRoleId = result.role!.id;
          this.isLoading = false;
        });
        log.info('Created role', { id: result.role.id });
      } else {
        runInAction(() => {
          this.error = result.error ?? 'Failed to create role';
          this.isLoading = false;
        });
        log.warn('Failed to create role', { error: result.error });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create role';

      runInAction(() => {
        this.error = errorMessage;
        this.isLoading = false;
      });

      log.error('Error creating role', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  /**
   * Update an existing role
   *
   * @param request - Update request
   * @returns Operation result
   */
  async updateRole(request: UpdateRoleRequest): Promise<RoleOperationResult> {
    log.debug('Updating role', { request });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const result = await this.service.updateRole(request);

      if (result.success) {
        // Reload to get fresh data
        await this.loadRoles();

        runInAction(() => {
          this.isLoading = false;
        });
        log.info('Updated role', { id: request.id });
      } else {
        runInAction(() => {
          this.error = result.error ?? 'Failed to update role';
          this.isLoading = false;
        });
        log.warn('Failed to update role', { error: result.error });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update role';

      runInAction(() => {
        this.error = errorMessage;
        this.isLoading = false;
      });

      log.error('Error updating role', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  /**
   * Deactivate a role
   *
   * @param roleId - ID of role to deactivate
   * @returns Operation result
   */
  async deactivateRole(roleId: string): Promise<RoleOperationResult> {
    log.debug('Deactivating role', { roleId });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const result = await this.service.deactivateRole(roleId);

      if (result.success) {
        // Update local state
        runInAction(() => {
          const index = this.rawRoles.findIndex((r) => r.id === roleId);
          if (index !== -1) {
            const updated = { ...this.rawRoles[index], isActive: false };
            this.rawRoles = [
              ...this.rawRoles.slice(0, index),
              updated,
              ...this.rawRoles.slice(index + 1),
            ];
          }
          this.isLoading = false;
        });
        log.info('Deactivated role', { roleId });
      } else {
        runInAction(() => {
          this.error = result.error ?? 'Failed to deactivate role';
          this.isLoading = false;
        });
        log.warn('Failed to deactivate role', { error: result.error });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to deactivate role';

      runInAction(() => {
        this.error = errorMessage;
        this.isLoading = false;
      });

      log.error('Error deactivating role', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  /**
   * Reactivate a role
   *
   * @param roleId - ID of role to reactivate
   * @returns Operation result
   */
  async reactivateRole(roleId: string): Promise<RoleOperationResult> {
    log.debug('Reactivating role', { roleId });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const result = await this.service.reactivateRole(roleId);

      if (result.success) {
        // Update local state
        runInAction(() => {
          const index = this.rawRoles.findIndex((r) => r.id === roleId);
          if (index !== -1) {
            const updated = { ...this.rawRoles[index], isActive: true };
            this.rawRoles = [
              ...this.rawRoles.slice(0, index),
              updated,
              ...this.rawRoles.slice(index + 1),
            ];
          }
          this.isLoading = false;
        });
        log.info('Reactivated role', { roleId });
      } else {
        runInAction(() => {
          this.error = result.error ?? 'Failed to reactivate role';
          this.isLoading = false;
        });
        log.warn('Failed to reactivate role', { error: result.error });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to reactivate role';

      runInAction(() => {
        this.error = errorMessage;
        this.isLoading = false;
      });

      log.error('Error reactivating role', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  /**
   * Delete a role (soft delete)
   *
   * @param roleId - ID of role to delete
   * @returns Operation result
   */
  async deleteRole(roleId: string): Promise<RoleOperationResult> {
    log.debug('Deleting role', { roleId });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const result = await this.service.deleteRole(roleId);

      if (result.success) {
        runInAction(() => {
          // Remove from list
          this.rawRoles = this.rawRoles.filter((r) => r.id !== roleId);
          // Clear selection if deleted role was selected
          if (this.selectedRoleId === roleId) {
            this.selectedRoleId = null;
          }
          this.isLoading = false;
        });
        log.info('Deleted role', { roleId });
      } else {
        runInAction(() => {
          this.error = result.error ?? 'Failed to delete role';
          this.isLoading = false;
        });
        log.warn('Failed to delete role', { error: result.error });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete role';

      runInAction(() => {
        this.error = errorMessage;
        this.isLoading = false;
      });

      log.error('Error deleting role', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Clear error state
   */
  clearError(): void {
    runInAction(() => {
      this.error = null;
    });
  }

  /**
   * Get a role by ID from loaded data
   *
   * @param roleId - Role ID to find
   * @returns Role or null if not found
   */
  getRoleById(roleId: string): Role | null {
    return this.rawRoles.find((r) => r.id === roleId) ?? null;
  }

  /**
   * Get role with full permissions (requires API call)
   *
   * @param roleId - Role ID to fetch
   * @returns Role with permissions or null
   */
  async getRoleWithPermissions(roleId: string): Promise<RoleWithPermissions | null> {
    try {
      return await this.service.getRoleById(roleId);
    } catch (error) {
      log.error('Failed to get role with permissions', error);
      return null;
    }
  }
}
