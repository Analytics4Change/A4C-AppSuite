/**
 * Bulk Role Assignment ViewModel
 *
 * Manages state and business logic for bulk role assignment dialog.
 * Uses MobX for reactive state management and dependency injection for services.
 *
 * Features:
 * - User selection with search filtering
 * - Scope path selection
 * - Bulk assignment with partial failure handling
 * - Progress tracking and result display
 *
 * Dependencies:
 * - IRoleService: Bulk assignment operations (MockRoleService | SupabaseRoleService)
 *
 * Usage:
 * ```typescript
 * const viewModel = new BulkRoleAssignmentViewModel(
 *   service,
 *   { id: 'role-uuid', name: 'Clinician' },
 *   'acme.pediatrics'
 * );
 *
 * await viewModel.loadUsers();
 * viewModel.toggleUser('user-1');
 * viewModel.toggleUser('user-2');
 * await viewModel.assignRole();
 * ```
 *
 * @see IRoleService
 * @see BulkAssignmentDialog for UI component
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { Logger } from '@/utils/logger';
import type { IRoleService } from '@/services/roles/IRoleService';
import { getRoleService } from '@/services/roles/RoleServiceFactory';
import type {
  BulkAssignmentResult,
  UserSelectionState,
  BulkAssignmentDialogState,
} from '@/types/bulk-assignment.types';

const log = Logger.getLogger('viewmodel');

/**
 * Role information needed by the ViewModel
 */
export interface RoleInfo {
  id: string;
  name: string;
  description?: string;
}

/**
 * Bulk Role Assignment ViewModel
 *
 * MVVM pattern with constructor injection for dependency inversion.
 * Handles user selection, search, and bulk assignment operations.
 */
export class BulkRoleAssignmentViewModel {
  // ============================================
  // Observable State
  // ============================================

  /** Current dialog state */
  state: BulkAssignmentDialogState = 'idle';

  /** Available users for selection */
  users: UserSelectionState[] = [];

  /** Set of selected user IDs */
  selectedUserIds: Set<string> = new Set();

  /** Current scope path for assignment */
  scopePath: string;

  /** Search term for filtering users */
  searchTerm = '';

  /** Loading state for user list */
  isLoading = false;

  /** Processing state for assignment operation */
  isProcessing = false;

  /** Result from the last assignment operation */
  result: BulkAssignmentResult | null = null;

  /** Error message from last operation */
  error: string | null = null;

  /** Correlation ID from the last operation (for support reference) */
  correlationId: string | null = null;

  /** Pagination offset */
  offset = 0;

  /** Whether more users can be loaded */
  hasMore = true;

  /** Page size for user loading */
  readonly pageSize = 50;

  /** Role being assigned */
  readonly role: RoleInfo;

  // ============================================
  // Constructor
  // ============================================

  /**
   * Constructor with dependency injection
   *
   * @param service - Role service (defaults to factory-created instance)
   * @param role - The role to be assigned
   * @param defaultScopePath - Initial scope path for assignment
   */
  constructor(
    private service: IRoleService = getRoleService(),
    role: RoleInfo,
    defaultScopePath: string = ''
  ) {
    this.role = role;
    this.scopePath = defaultScopePath;

    makeAutoObservable(this);

    log.info('BulkRoleAssignmentViewModel initialized', {
      roleId: role.id,
      roleName: role.name,
      scopePath: defaultScopePath,
    });
  }

  // ============================================
  // Computed Properties
  // ============================================

  /**
   * Number of selected users
   */
  get selectedCount(): number {
    return this.selectedUserIds.size;
  }

  /**
   * Users filtered by search term
   */
  get filteredUsers(): UserSelectionState[] {
    if (!this.searchTerm.trim()) {
      return this.users;
    }

    const searchLower = this.searchTerm.toLowerCase().trim();
    return this.users.filter(
      (u) =>
        u.displayName.toLowerCase().includes(searchLower) ||
        u.email.toLowerCase().includes(searchLower)
    );
  }

  /**
   * Users that are eligible for selection (not already assigned)
   */
  get eligibleUsers(): UserSelectionState[] {
    return this.users.filter((u) => !u.isAlreadyAssigned);
  }

  /**
   * Number of eligible users
   */
  get eligibleCount(): number {
    return this.eligibleUsers.length;
  }

  /**
   * Selected users (for display)
   */
  get selectedUsers(): UserSelectionState[] {
    return this.users.filter((u) => this.selectedUserIds.has(u.id));
  }

  /**
   * Whether any users are selected
   */
  get hasSelections(): boolean {
    return this.selectedUserIds.size > 0;
  }

  /**
   * Whether all eligible users are selected
   */
  get allEligibleSelected(): boolean {
    if (this.eligibleCount === 0) return false;
    return this.eligibleUsers.every((u) => this.selectedUserIds.has(u.id));
  }

  /**
   * Whether some (but not all) eligible users are selected
   */
  get someEligibleSelected(): boolean {
    if (this.eligibleCount === 0) return false;
    const selectedEligible = this.eligibleUsers.filter((u) => this.selectedUserIds.has(u.id));
    return selectedEligible.length > 0 && selectedEligible.length < this.eligibleCount;
  }

  /**
   * Whether the assignment can proceed
   */
  get canAssign(): boolean {
    return this.hasSelections && this.scopePath.length > 0 && !this.isProcessing;
  }

  /**
   * Whether the operation was completely successful (no failures)
   */
  get isCompleteSuccess(): boolean {
    return this.result !== null && this.result.totalFailed === 0;
  }

  /**
   * Whether the operation had partial success (some failures)
   */
  get isPartialSuccess(): boolean {
    return (
      this.result !== null && this.result.totalSucceeded > 0 && this.result.totalFailed > 0
    );
  }

  /**
   * Whether the operation completely failed
   */
  get isCompleteFail(): boolean {
    return this.result !== null && this.result.totalSucceeded === 0;
  }

  // ============================================
  // Actions - User Loading
  // ============================================

  /**
   * Load users eligible for bulk assignment
   */
  async loadUsers(): Promise<void> {
    if (this.isLoading) return;

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
      this.state = 'selecting';
    });

    try {
      log.debug('Loading users for bulk assignment', {
        roleId: this.role.id,
        scopePath: this.scopePath,
        searchTerm: this.searchTerm,
        offset: this.offset,
      });

      const users = await this.service.listUsersForBulkAssignment({
        roleId: this.role.id,
        scopePath: this.scopePath,
        searchTerm: this.searchTerm || undefined,
        limit: this.pageSize,
        offset: this.offset,
      });

      runInAction(() => {
        // Map to UserSelectionState with isSelected tracking
        const userStates: UserSelectionState[] = users.map((u) => ({
          ...u,
          isSelected: this.selectedUserIds.has(u.id),
        }));

        if (this.offset === 0) {
          this.users = userStates;
        } else {
          // Append for pagination
          this.users = [...this.users, ...userStates];
        }

        this.hasMore = users.length === this.pageSize;
        this.isLoading = false;

        log.info('Loaded users for bulk assignment', {
          count: users.length,
          total: this.users.length,
          hasMore: this.hasMore,
        });
      });
    } catch (err) {
      runInAction(() => {
        this.error = err instanceof Error ? err.message : 'Failed to load users';
        this.isLoading = false;
      });
      log.error('Failed to load users', err);
    }
  }

  /**
   * Load more users (pagination)
   */
  async loadMore(): Promise<void> {
    if (!this.hasMore || this.isLoading) return;

    runInAction(() => {
      this.offset += this.pageSize;
    });

    await this.loadUsers();
  }

  /**
   * Refresh the user list (reset pagination)
   */
  async refresh(): Promise<void> {
    runInAction(() => {
      this.offset = 0;
      this.hasMore = true;
    });

    await this.loadUsers();
  }

  // ============================================
  // Actions - User Selection
  // ============================================

  /**
   * Toggle selection for a user
   */
  toggleUser(userId: string): void {
    const user = this.users.find((u) => u.id === userId);
    if (!user || user.isAlreadyAssigned) {
      log.warn('Cannot toggle user', { userId, isAlreadyAssigned: user?.isAlreadyAssigned });
      return;
    }

    runInAction(() => {
      if (this.selectedUserIds.has(userId)) {
        this.selectedUserIds.delete(userId);
      } else {
        this.selectedUserIds.add(userId);
      }
      // Create new Set to trigger MobX reactivity
      this.selectedUserIds = new Set(this.selectedUserIds);

      // Update user's isSelected state
      const userIndex = this.users.findIndex((u) => u.id === userId);
      if (userIndex !== -1) {
        this.users[userIndex] = {
          ...this.users[userIndex],
          isSelected: this.selectedUserIds.has(userId),
        };
        this.users = [...this.users]; // Trigger reactivity
      }

      log.debug('Toggled user selection', {
        userId,
        isSelected: this.selectedUserIds.has(userId),
        totalSelected: this.selectedUserIds.size,
      });
    });
  }

  /**
   * Select all eligible users
   */
  selectAll(): void {
    runInAction(() => {
      for (const user of this.eligibleUsers) {
        this.selectedUserIds.add(user.id);
      }
      this.selectedUserIds = new Set(this.selectedUserIds);

      // Update all users' isSelected state
      this.users = this.users.map((u) => ({
        ...u,
        isSelected: this.selectedUserIds.has(u.id),
      }));

      log.debug('Selected all eligible users', { count: this.selectedUserIds.size });
    });
  }

  /**
   * Deselect all users
   */
  deselectAll(): void {
    runInAction(() => {
      this.selectedUserIds = new Set();

      // Update all users' isSelected state
      this.users = this.users.map((u) => ({
        ...u,
        isSelected: false,
      }));

      log.debug('Deselected all users');
    });
  }

  /**
   * Toggle select all / deselect all
   */
  toggleSelectAll(): void {
    if (this.allEligibleSelected) {
      this.deselectAll();
    } else {
      this.selectAll();
    }
  }

  // ============================================
  // Actions - Search and Filter
  // ============================================

  /**
   * Set search term and reload users
   */
  setSearchTerm(term: string): void {
    runInAction(() => {
      this.searchTerm = term;
    });

    // Debounce would be handled by the component
    // For now, just refresh when called
  }

  /**
   * Set scope path and reload users
   */
  setScopePath(path: string): void {
    runInAction(() => {
      this.scopePath = path;
      this.offset = 0;
      this.users = [];
      this.selectedUserIds = new Set();
    });

    // Reload users for new scope
    this.loadUsers();
  }

  // ============================================
  // Actions - Assignment
  // ============================================

  /**
   * Perform bulk role assignment
   */
  async assignRole(reason?: string): Promise<BulkAssignmentResult> {
    if (!this.canAssign) {
      throw new Error('Cannot assign: no users selected or missing scope');
    }

    runInAction(() => {
      this.isProcessing = true;
      this.error = null;
      this.state = 'processing';
    });

    try {
      const userIds = Array.from(this.selectedUserIds);

      log.info('Starting bulk role assignment', {
        roleId: this.role.id,
        roleName: this.role.name,
        userCount: userIds.length,
        scopePath: this.scopePath,
      });

      const result = await this.service.bulkAssignRole({
        roleId: this.role.id,
        userIds,
        scopePath: this.scopePath,
        reason: reason || `Bulk assignment to ${this.role.name}`,
      });

      runInAction(() => {
        this.result = result;
        this.correlationId = result.correlationId;
        this.isProcessing = false;
        this.state = 'completed';

        // Clear selections for successfully assigned users
        for (const userId of result.successful) {
          this.selectedUserIds.delete(userId);
        }
        this.selectedUserIds = new Set(this.selectedUserIds);

        // Update users list to reflect new assignments
        this.users = this.users.map((u) => {
          if (result.successful.includes(u.id)) {
            return { ...u, isAlreadyAssigned: true, isSelected: false };
          }
          if (this.selectedUserIds.has(u.id)) {
            return { ...u, isSelected: true };
          }
          return { ...u, isSelected: false };
        });

        log.info('Bulk assignment completed', {
          totalSucceeded: result.totalSucceeded,
          totalFailed: result.totalFailed,
          correlationId: result.correlationId,
        });
      });

      return result;
    } catch (err) {
      runInAction(() => {
        this.error = err instanceof Error ? err.message : 'Assignment failed';
        this.isProcessing = false;
        this.state = 'error';
      });

      log.error('Bulk assignment failed', err);
      throw err;
    }
  }

  /**
   * Retry failed assignments only
   */
  async retryFailed(): Promise<BulkAssignmentResult | null> {
    if (!this.result || this.result.failed.length === 0) {
      return null;
    }

    // Select only the failed user IDs
    runInAction(() => {
      this.selectedUserIds = new Set(this.result!.failed.map((f) => f.userId));
    });

    return this.assignRole('Retry failed assignments');
  }

  // ============================================
  // Actions - State Management
  // ============================================

  /**
   * Open the dialog and start loading users
   */
  async open(): Promise<void> {
    runInAction(() => {
      this.state = 'selecting';
      this.error = null;
      this.result = null;
      this.correlationId = null;
    });

    await this.loadUsers();
  }

  /**
   * Close the dialog and reset state
   */
  close(): void {
    runInAction(() => {
      this.state = 'idle';
      this.users = [];
      this.selectedUserIds = new Set();
      this.searchTerm = '';
      this.offset = 0;
      this.hasMore = true;
      this.error = null;
      this.result = null;
      this.isLoading = false;
      this.isProcessing = false;
    });

    log.debug('BulkRoleAssignmentViewModel closed');
  }

  /**
   * Reset to selecting state (after viewing results)
   */
  backToSelecting(): void {
    runInAction(() => {
      this.state = 'selecting';
      this.result = null;
      this.error = null;
    });
  }

  /**
   * Clear error message
   */
  clearError(): void {
    runInAction(() => {
      this.error = null;
    });
  }
}
