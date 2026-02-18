/**
 * Schedule Assignment ViewModel
 *
 * Manages state and business logic for schedule template user assignment management.
 * Supports adding AND removing user assignments in a single operation, with
 * auto-transfer detection for users already assigned to another schedule.
 *
 * Key Differences from RoleAssignmentViewModel:
 * - No scopePath (schedules are org-scoped, not scope-path-scoped)
 * - Tracks users being transferred from another schedule
 * - changesSummary includes transfer count
 * - Result type includes transferred array
 *
 * Dependencies:
 * - IScheduleService: Schedule management operations (MockScheduleService | SupabaseScheduleService)
 *
 * Usage:
 * ```typescript
 * const viewModel = new ScheduleAssignmentViewModel(
 *   service,
 *   { id: 'template-uuid', name: 'Day Shift M-F 8-4' }
 * );
 *
 * await viewModel.open();
 * // Initially assigned users have checkbox checked
 * // Toggle checkboxes to add/remove assignments
 * await viewModel.saveChanges();
 * ```
 *
 * @see IScheduleService
 * @see ScheduleAssignmentDialog for UI component
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { Logger } from '@/utils/logger';
import type { IScheduleService } from '@/services/schedule/IScheduleService';
import { getScheduleService } from '@/services/schedule/ScheduleServiceFactory';
import type {
  ScheduleManageableUserState,
  SyncScheduleAssignmentsResult,
} from '@/types/bulk-assignment.types';
import type { AssignmentDialogState } from '@/types/assignment.types';

const log = Logger.getLogger('viewmodel');

/**
 * Schedule template information needed by the ViewModel
 */
export interface ScheduleTemplateInfo {
  id: string;
  name: string;
}

/**
 * Schedule Assignment ViewModel
 *
 * MVVM pattern with constructor injection for dependency inversion.
 * Handles user selection, tracks delta from initial state, and syncs assignments.
 */
export class ScheduleAssignmentViewModel {
  // ============================================
  // Observable State
  // ============================================

  /** Current dialog state */
  state: AssignmentDialogState = 'idle';

  /** All users with their assignment status */
  users: ScheduleManageableUserState[] = [];

  /**
   * Initial assignment state when dialog opened
   * Used to compute what changed (delta)
   */
  private initialAssignedUserIds: Set<string> = new Set();

  /**
   * Current checkbox state (selected = should be assigned after save)
   */
  selectedUserIds: Set<string> = new Set();

  /** Search term for filtering users */
  searchTerm = '';

  /** Loading state for user list */
  isLoading = false;

  /** Processing state for save operation */
  isSaving = false;

  /** Result from the last sync operation */
  result: SyncScheduleAssignmentsResult | null = null;

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

  /** Schedule template being managed */
  readonly template: ScheduleTemplateInfo;

  // ============================================
  // Constructor
  // ============================================

  /**
   * Constructor with dependency injection
   *
   * @param service - Schedule service (defaults to factory-created instance)
   * @param template - The schedule template to manage assignments for
   */
  constructor(
    private service: IScheduleService = getScheduleService(),
    template: ScheduleTemplateInfo
  ) {
    this.template = template;

    makeAutoObservable(this);

    log.info('ScheduleAssignmentViewModel initialized', {
      templateId: template.id,
      templateName: template.name,
    });
  }

  // ============================================
  // Computed Properties - Delta Tracking
  // ============================================

  /**
   * Users to ADD (now selected who weren't initially assigned)
   */
  get usersToAdd(): string[] {
    return [...this.selectedUserIds].filter((id) => !this.initialAssignedUserIds.has(id));
  }

  /**
   * Users to REMOVE (initially assigned who are now deselected)
   */
  get usersToRemove(): string[] {
    return [...this.initialAssignedUserIds].filter((id) => !this.selectedUserIds.has(id));
  }

  /**
   * Whether there are any changes from the initial state
   */
  get hasChanges(): boolean {
    return this.usersToAdd.length > 0 || this.usersToRemove.length > 0;
  }

  /**
   * Users being added who are currently assigned to a different schedule (transfers)
   */
  get usersToTransfer(): ScheduleManageableUserState[] {
    const addIds = new Set(this.usersToAdd);
    return this.users.filter((u) => addIds.has(u.id) && u.currentScheduleId != null);
  }

  /**
   * Summary of changes for display
   * Example: "+2 to assign (1 transfer), -1 to remove"
   */
  get changesSummary(): string {
    const parts: string[] = [];
    if (this.usersToAdd.length > 0) {
      let addPart = `+${this.usersToAdd.length} to assign`;
      const transferCount = this.usersToTransfer.length;
      if (transferCount > 0) {
        addPart += ` (${transferCount} transfer)`;
      }
      parts.push(addPart);
    }
    if (this.usersToRemove.length > 0) {
      parts.push(`-${this.usersToRemove.length} to remove`);
    }
    return parts.join(', ') || 'No changes';
  }

  // ============================================
  // Computed Properties - Selection Stats
  // ============================================

  /**
   * Number of currently selected users
   */
  get selectedCount(): number {
    return this.selectedUserIds.size;
  }

  /**
   * Users filtered by search term (client-side filter)
   */
  get filteredUsers(): ScheduleManageableUserState[] {
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
   * Active users (can be assigned/unassigned)
   */
  get activeUsers(): ScheduleManageableUserState[] {
    return this.users.filter((u) => u.isActive);
  }

  /**
   * Number of active users
   */
  get activeUserCount(): number {
    return this.activeUsers.length;
  }

  /**
   * Whether all active users are selected
   */
  get allActiveSelected(): boolean {
    if (this.activeUserCount === 0) return false;
    return this.activeUsers.every((u) => this.selectedUserIds.has(u.id));
  }

  /**
   * Whether some (but not all) active users are selected
   */
  get someActiveSelected(): boolean {
    if (this.activeUserCount === 0) return false;
    const selectedActive = this.activeUsers.filter((u) => this.selectedUserIds.has(u.id));
    return selectedActive.length > 0 && selectedActive.length < this.activeUserCount;
  }

  /**
   * Whether save can proceed
   */
  get canSave(): boolean {
    return this.hasChanges && !this.isSaving;
  }

  // ============================================
  // Computed Properties - Result Analysis
  // ============================================

  /**
   * Whether the operation was completely successful
   */
  get isCompleteSuccess(): boolean {
    if (!this.result) return false;
    return this.result.added.failed.length === 0 && this.result.removed.failed.length === 0;
  }

  /**
   * Whether the operation had partial success
   */
  get isPartialSuccess(): boolean {
    if (!this.result) return false;
    const hasSuccess =
      this.result.added.successful.length > 0 || this.result.removed.successful.length > 0;
    const hasFailure = this.result.added.failed.length > 0 || this.result.removed.failed.length > 0;
    return hasSuccess && hasFailure;
  }

  /**
   * Total number of successful operations
   */
  get totalSucceeded(): number {
    if (!this.result) return 0;
    return this.result.added.successful.length + this.result.removed.successful.length;
  }

  /**
   * Total number of failed operations
   */
  get totalFailed(): number {
    if (!this.result) return 0;
    return this.result.added.failed.length + this.result.removed.failed.length;
  }

  /**
   * Number of users transferred from another schedule
   */
  get totalTransferred(): number {
    if (!this.result) return 0;
    return this.result.transferred.length;
  }

  // ============================================
  // Actions - User Loading
  // ============================================

  /**
   * Load users for schedule management
   */
  async loadUsers(): Promise<void> {
    if (this.isLoading) return;

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      log.debug('Loading users for schedule management', {
        templateId: this.template.id,
        searchTerm: this.searchTerm,
        offset: this.offset,
      });

      const users = await this.service.listUsersForScheduleManagement({
        templateId: this.template.id,
        searchTerm: this.searchTerm || undefined,
        limit: this.pageSize,
        offset: this.offset,
      });

      runInAction(() => {
        // Map to ScheduleManageableUserState with checkbox state
        const userStates: ScheduleManageableUserState[] = users.map((u) => ({
          ...u,
          isChecked: u.isAssigned, // Initialize checkbox from current assignment
        }));

        if (this.offset === 0) {
          this.users = userStates;

          // Initialize tracking sets from loaded data
          this.initialAssignedUserIds = new Set(users.filter((u) => u.isAssigned).map((u) => u.id));
          this.selectedUserIds = new Set(this.initialAssignedUserIds);
        } else {
          // Append for pagination
          this.users = [...this.users, ...userStates];

          // Add new assigned users to tracking sets
          for (const u of users) {
            if (u.isAssigned) {
              this.initialAssignedUserIds.add(u.id);
              this.selectedUserIds.add(u.id);
            }
          }
        }

        this.hasMore = users.length === this.pageSize;
        this.isLoading = false;

        log.info('Loaded users for schedule management', {
          count: users.length,
          total: this.users.length,
          initiallyAssigned: this.initialAssignedUserIds.size,
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
   * Refresh the user list (reset pagination but keep selections)
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
    if (!user || !user.isActive) {
      log.warn('Cannot toggle user', { userId, isActive: user?.isActive });
      return;
    }

    runInAction(() => {
      const newSelectedUserIds = new Set(this.selectedUserIds);
      if (newSelectedUserIds.has(userId)) {
        newSelectedUserIds.delete(userId);
      } else {
        newSelectedUserIds.add(userId);
      }
      this.selectedUserIds = newSelectedUserIds;

      // Update user's isChecked state
      this.users = this.users.map((u) =>
        u.id === userId ? { ...u, isChecked: this.selectedUserIds.has(u.id) } : u
      );

      log.debug('Toggled user selection', {
        userId,
        isChecked: this.selectedUserIds.has(userId),
        totalSelected: this.selectedUserIds.size,
        toAdd: this.usersToAdd.length,
        toRemove: this.usersToRemove.length,
      });
    });
  }

  /**
   * Select all active users
   */
  selectAll(): void {
    runInAction(() => {
      const newSelectedUserIds = new Set(this.selectedUserIds);
      for (const user of this.activeUsers) {
        newSelectedUserIds.add(user.id);
      }
      this.selectedUserIds = newSelectedUserIds;

      // Update all users' isChecked state
      this.users = this.users.map((u) => ({
        ...u,
        isChecked: this.selectedUserIds.has(u.id),
      }));

      log.debug('Selected all active users', { count: this.selectedUserIds.size });
    });
  }

  /**
   * Deselect all users
   */
  deselectAll(): void {
    runInAction(() => {
      this.selectedUserIds = new Set();

      // Update all users' isChecked state
      this.users = this.users.map((u) => ({
        ...u,
        isChecked: false,
      }));

      log.debug('Deselected all users');
    });
  }

  /**
   * Toggle select all / deselect all
   */
  toggleSelectAll(): void {
    if (this.allActiveSelected) {
      this.deselectAll();
    } else {
      this.selectAll();
    }
  }

  // ============================================
  // Actions - Search and Filter
  // ============================================

  /**
   * Set search term (client-side filtering)
   */
  setSearchTerm(term: string): void {
    runInAction(() => {
      this.searchTerm = term;
    });
  }

  // ============================================
  // Actions - Save Changes
  // ============================================

  /**
   * Save changes (add and remove assignments)
   */
  async saveChanges(reason?: string): Promise<SyncScheduleAssignmentsResult> {
    if (!this.canSave) {
      throw new Error('Cannot save: no changes');
    }

    runInAction(() => {
      this.isSaving = true;
      this.error = null;
      this.state = 'saving';
    });

    try {
      log.info('Saving schedule assignment changes', {
        templateId: this.template.id,
        templateName: this.template.name,
        addCount: this.usersToAdd.length,
        removeCount: this.usersToRemove.length,
        transferCount: this.usersToTransfer.length,
      });

      const result = await this.service.syncScheduleAssignments({
        templateId: this.template.id,
        userIdsToAdd: this.usersToAdd,
        userIdsToRemove: this.usersToRemove,
        reason: reason || `Schedule assignment update for ${this.template.name}`,
      });

      runInAction(() => {
        this.result = result;
        this.correlationId = result.correlationId;
        this.isSaving = false;
        this.state = 'completed';

        // Update initial state to reflect successful changes
        // Add successfully added users to initial set
        for (const userId of result.added.successful) {
          this.initialAssignedUserIds.add(userId);
        }
        // Remove successfully removed users from initial set
        for (const userId of result.removed.successful) {
          this.initialAssignedUserIds.delete(userId);
        }
        this.initialAssignedUserIds = new Set(this.initialAssignedUserIds);

        // Update selectedUserIds to match the new initial state
        this.selectedUserIds = new Set(this.initialAssignedUserIds);

        // Update users list to reflect changes
        this.users = this.users.map((u) => ({
          ...u,
          isAssigned: this.initialAssignedUserIds.has(u.id),
          isChecked: this.selectedUserIds.has(u.id),
        }));

        log.info('Save completed', {
          addedSuccessful: result.added.successful.length,
          addedFailed: result.added.failed.length,
          removedSuccessful: result.removed.successful.length,
          removedFailed: result.removed.failed.length,
          transferred: result.transferred.length,
          correlationId: result.correlationId,
        });
      });

      return result;
    } catch (err) {
      runInAction(() => {
        this.error = err instanceof Error ? err.message : 'Save failed';
        this.isSaving = false;
        this.state = 'error';
      });

      log.error('Save failed', err);
      throw err;
    }
  }

  // ============================================
  // Actions - State Management
  // ============================================

  /**
   * Open the dialog and start loading users
   */
  async open(): Promise<void> {
    runInAction(() => {
      this.state = 'loading';
      this.error = null;
      this.result = null;
      this.correlationId = null;
      this.offset = 0;
      this.hasMore = true;
    });

    await this.loadUsers();

    runInAction(() => {
      if (this.state !== 'error') {
        this.state = 'managing';
      }
    });
  }

  /**
   * Close the dialog and reset state
   */
  close(): void {
    runInAction(() => {
      this.state = 'idle';
      this.users = [];
      this.initialAssignedUserIds = new Set();
      this.selectedUserIds = new Set();
      this.searchTerm = '';
      this.offset = 0;
      this.hasMore = true;
      this.error = null;
      this.result = null;
      this.isLoading = false;
      this.isSaving = false;
    });

    log.debug('ScheduleAssignmentViewModel closed');
  }

  /**
   * Reset to managing state (after viewing results)
   */
  backToManaging(): void {
    runInAction(() => {
      this.state = 'managing';
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
