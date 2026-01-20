/**
 * Users ViewModel
 *
 * Manages state and business logic for user list display and CRUD operations.
 * Uses MobX for reactive state management and dependency injection for services.
 *
 * Features:
 * - Unified user/invitation list with filtering and pagination
 * - User selection and detail view
 * - Invitation management (create, resend, revoke)
 * - User lifecycle management (activate/deactivate)
 * - Role assignment operations
 * - Debounced search
 * - Loading and error states
 *
 * Dependencies:
 * - IUserQueryService: Read operations
 * - IUserCommandService: Write operations
 *
 * Usage:
 * ```typescript
 * const viewModel = new UsersViewModel();
 * await viewModel.loadUsers();
 *
 * // Or with injected services for testing:
 * const viewModel = new UsersViewModel(mockQueryService, mockCommandService);
 * ```
 *
 * @see IUserQueryService
 * @see IUserCommandService
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { Logger } from '@/utils/logger';
import type { IUserQueryService } from '@/services/users/IUserQueryService';
import type { IUserCommandService } from '@/services/users/IUserCommandService';
import { getUserQueryService, getUserCommandService } from '@/services/users/UserServiceFactory';
import type {
  UserListItem,
  UserWithRoles,
  Invitation,
  EmailLookupResult,
  UserQueryOptions,
  UserFilterOptions,
  UserSortOptions,
  PaginationOptions,
  RoleReference,
  UserDisplayStatus,
  UserOperationResult,
  InviteUserRequest,
  ModifyRolesRequest,
  UserAddress,
  UserPhone,
  UserOrgAccess,
  AddUserAddressRequest,
  UpdateUserAddressRequest,
  RemoveUserAddressRequest,
  AddUserPhoneRequest,
  UpdateUserPhoneRequest,
  RemoveUserPhoneRequest,
  UpdateAccessDatesRequest,
  UpdateNotificationPreferencesRequest,
  NotificationPreferences,
} from '@/types/user.types';

const log = Logger.getLogger('viewmodel');

/** Debounce delay for search (ms) */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Users ViewModel
 *
 * MVVM pattern with constructor injection for dependency inversion.
 * Manages unified user/invitation list including selection, filtering, and CRUD operations.
 */
export class UsersViewModel {
  // ============================================
  // Observable State - List
  // ============================================

  /** Array of users and invitations */
  private rawItems: UserListItem[] = [];

  /** Total count from server (for pagination) */
  totalCount = 0;

  /** Currently selected item ID (user or invitation) */
  selectedItemId: string | null = null;

  /** Selected user details (loaded separately) */
  selectedUserDetails: UserWithRoles | null = null;

  /** Selected invitation details (loaded separately) */
  selectedInvitationDetails: Invitation | null = null;

  // ============================================
  // Observable State - Filters
  // ============================================

  /** Current filter options */
  filters: UserFilterOptions = { status: 'all' };

  /** Current sort options */
  sort: UserSortOptions = { sortBy: 'name', sortOrder: 'asc' };

  /** Current pagination options */
  pagination: PaginationOptions = { page: 1, pageSize: 20 };

  /** Search term (debounced) */
  searchTerm = '';

  /** Debounce timer for search */
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ============================================
  // Observable State - Loading/Error
  // ============================================

  /** Loading state for list operations */
  isLoading = false;

  /** Loading state for detail operations */
  isLoadingDetails = false;

  /** Loading state for command operations */
  isSubmitting = false;

  /** Error message from last failed operation */
  error: string | null = null;

  /** Success message for feedback */
  successMessage: string | null = null;

  // ============================================
  // Observable State - Assignable Roles
  // ============================================

  /** Roles that can be assigned to users */
  assignableRoles: RoleReference[] = [];

  // ============================================
  // Observable State - Email Lookup
  // ============================================

  /** Result of email lookup (for invitation form) */
  emailLookupResult: EmailLookupResult | null = null;

  /** Loading state for email lookup */
  isCheckingEmail = false;

  // ============================================
  // Observable State - Extended Data (Phase 0A)
  // ============================================

  /** Selected user's addresses (global + org-specific) */
  userAddresses: UserAddress[] = [];

  /** Selected user's phones (global + org-specific) */
  userPhones: UserPhone[] = [];

  /** Selected user's org access (access dates + notification prefs) */
  userOrgAccess: UserOrgAccess | null = null;

  /** Loading state for extended data */
  isLoadingExtendedData = false;

  /** Current organization ID (for org-specific data) */
  currentOrgId: string = 'org-acme-healthcare';

  // ============================================
  // Constructor
  // ============================================

  /**
   * Constructor with dependency injection
   *
   * @param queryService - User query service (defaults to factory-created instance)
   * @param commandService - User command service (defaults to factory-created instance)
   */
  constructor(
    private queryService: IUserQueryService = getUserQueryService(),
    private commandService: IUserCommandService = getUserCommandService()
  ) {
    makeAutoObservable(this);
    log.debug('UsersViewModel initialized');
  }

  // ============================================
  // Computed Properties - List
  // ============================================

  /**
   * Users and invitations list
   */
  get items(): UserListItem[] {
    return [...this.rawItems];
  }

  /**
   * Currently selected item (user or invitation)
   */
  get selectedItem(): UserListItem | null {
    if (!this.selectedItemId) return null;
    return this.rawItems.find((item) => item.id === this.selectedItemId) ?? null;
  }

  /**
   * Whether the selected item is an invitation
   */
  get isSelectedItemInvitation(): boolean {
    return this.selectedItem?.isInvitation ?? false;
  }

  /**
   * Whether the selected item is an active user
   */
  get isSelectedItemActiveUser(): boolean {
    const item = this.selectedItem;
    if (!item || item.isInvitation) return false;
    return item.displayStatus === 'active';
  }

  /**
   * Whether the selected item is a deactivated user
   */
  get isSelectedItemDeactivated(): boolean {
    const item = this.selectedItem;
    if (!item || item.isInvitation) return false;
    return item.displayStatus === 'deactivated';
  }

  // ============================================
  // Computed Properties - Actions
  // ============================================

  /**
   * Whether a user can be deactivated
   */
  get canDeactivate(): boolean {
    return this.isSelectedItemActiveUser;
  }

  /**
   * Whether a user can be reactivated
   */
  get canReactivate(): boolean {
    return this.isSelectedItemDeactivated;
  }

  /**
   * Whether a user can be deleted (must be deactivated first)
   */
  get canDelete(): boolean {
    return this.isSelectedItemDeactivated;
  }

  /**
   * Whether an invitation can be resent
   */
  get canResendInvitation(): boolean {
    const item = this.selectedItem;
    if (!item || !item.isInvitation) return false;
    return item.displayStatus === 'pending' || item.displayStatus === 'expired';
  }

  /**
   * Whether an invitation can be revoked
   */
  get canRevokeInvitation(): boolean {
    const item = this.selectedItem;
    if (!item || !item.isInvitation) return false;
    return item.displayStatus === 'pending';
  }

  /**
   * Whether roles can be edited
   */
  get canEditRoles(): boolean {
    return this.isSelectedItemActiveUser || this.isSelectedItemDeactivated;
  }

  // ============================================
  // Computed Properties - Pagination
  // ============================================

  /**
   * Total number of pages
   */
  get totalPages(): number {
    return Math.ceil(this.totalCount / this.pagination.pageSize);
  }

  /**
   * Whether there are more pages
   */
  get hasMorePages(): boolean {
    return this.pagination.page < this.totalPages;
  }

  /**
   * Whether there are previous pages
   */
  get hasPreviousPages(): boolean {
    return this.pagination.page > 1;
  }

  // ============================================
  // Computed Properties - Counts
  // ============================================

  /**
   * Number of active users
   */
  get activeUserCount(): number {
    return this.rawItems.filter((i) => !i.isInvitation && i.displayStatus === 'active').length;
  }

  /**
   * Number of pending invitations
   */
  get pendingInvitationCount(): number {
    return this.rawItems.filter((i) => i.isInvitation && i.displayStatus === 'pending').length;
  }

  // ============================================
  // Computed Properties - Extended Data
  // ============================================

  /**
   * Active addresses (not soft-deleted)
   */
  get activeAddresses(): UserAddress[] {
    return this.userAddresses.filter((a) => a.isActive);
  }

  /**
   * Primary address (if any)
   */
  get primaryAddress(): UserAddress | null {
    return this.activeAddresses.find((a) => a.isPrimary) ?? null;
  }

  /**
   * Global addresses (no org override)
   */
  get globalAddresses(): UserAddress[] {
    return this.activeAddresses.filter((a) => !a.orgId);
  }

  /**
   * Org-specific address overrides
   */
  get orgAddressOverrides(): UserAddress[] {
    return this.activeAddresses.filter((a) => a.orgId === this.currentOrgId);
  }

  /**
   * Active phones (not soft-deleted)
   */
  get activePhones(): UserPhone[] {
    return this.userPhones.filter((p) => p.isActive);
  }

  /**
   * Primary phone (if any)
   */
  get primaryPhone(): UserPhone | null {
    return this.activePhones.find((p) => p.isPrimary) ?? null;
  }

  /**
   * SMS-capable phones
   */
  get smsCapablePhones(): UserPhone[] {
    return this.activePhones.filter((p) => p.smsCapable);
  }

  /**
   * Global phones (no org override)
   */
  get globalPhones(): UserPhone[] {
    return this.activePhones.filter((p) => !p.orgId);
  }

  /**
   * Org-specific phone overrides
   */
  get orgPhoneOverrides(): UserPhone[] {
    return this.activePhones.filter((p) => p.orgId === this.currentOrgId);
  }

  /**
   * Whether user has access date restrictions
   */
  get hasAccessDateRestrictions(): boolean {
    return !!(this.userOrgAccess?.accessStartDate || this.userOrgAccess?.accessExpirationDate);
  }

  /**
   * User's current notification preferences (or defaults)
   */
  get currentNotificationPreferences(): NotificationPreferences | null {
    return this.userOrgAccess?.notificationPreferences ?? null;
  }

  // ============================================
  // Actions - Data Loading
  // ============================================

  /**
   * Load users and invitations with current filters
   */
  async loadUsers(): Promise<void> {
    log.debug('Loading users', { filters: this.filters, sort: this.sort, pagination: this.pagination });

    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });

    try {
      const options: UserQueryOptions = {
        filters: this.filters,
        sort: this.sort,
        pagination: this.pagination,
      };

      const result = await this.queryService.getUsersPaginated(options);

      runInAction(() => {
        this.rawItems = result.items;
        this.totalCount = result.totalCount;
        this.isLoading = false;
        log.info('Loaded users', { count: result.items.length, total: result.totalCount });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load users';

      runInAction(() => {
        this.isLoading = false;
        this.error = errorMessage;
      });

      log.error('Failed to load users', error);
    }
  }

  /**
   * Load assignable roles for role selector
   */
  async loadAssignableRoles(): Promise<void> {
    log.debug('Loading assignable roles');

    try {
      const roles = await this.queryService.getAssignableRoles();

      runInAction(() => {
        this.assignableRoles = roles;
        log.info('Loaded assignable roles', { count: roles.length });
      });
    } catch (error) {
      log.error('Failed to load assignable roles', error);
    }
  }

  /**
   * Load all data needed for user management
   */
  async loadAll(): Promise<void> {
    await Promise.all([this.loadUsers(), this.loadAssignableRoles()]);
  }

  /**
   * Refresh list with current filters
   */
  async refresh(): Promise<void> {
    await this.loadUsers();
  }

  /**
   * Load user details by ID
   *
   * Uses structured result from service to display actual error messages
   * instead of generic "unexpected error" from ErrorBoundary.
   */
  async loadUserDetails(userId: string): Promise<void> {
    log.debug('Loading user details', { userId });

    runInAction(() => {
      this.isLoadingDetails = true;
      this.selectedUserDetails = null;
      this.error = null; // Clear previous error
    });

    try {
      const result = await this.queryService.getUserById(userId);

      runInAction(() => {
        this.isLoadingDetails = false;
        if (result.user) {
          this.selectedUserDetails = result.user;
          log.info('Loaded user details', { userId, email: result.user.email });
        } else {
          this.selectedUserDetails = null;
          // Use actual error message from service for visibility
          this.error = result.errorMessage ||
            'Failed to load user details. The user may not exist or you may not have permission to view them.';
          log.warn('User details load failed', { userId, errorMessage: result.errorMessage });
        }
      });
    } catch (error) {
      // This catch handles unexpected exceptions (e.g., network failures)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('Failed to load user details (exception)', { userId, error: errorMessage });

      runInAction(() => {
        this.isLoadingDetails = false;
        // Show actual error message for visibility
        this.error = `Failed to load user details: ${errorMessage}`;
      });
    }
  }

  /**
   * Load invitation details by ID
   */
  async loadInvitationDetails(invitationId: string): Promise<void> {
    log.debug('Loading invitation details', { invitationId });

    runInAction(() => {
      this.isLoadingDetails = true;
      this.selectedInvitationDetails = null;
    });

    try {
      const invitation = await this.queryService.getInvitationById(invitationId);

      runInAction(() => {
        this.selectedInvitationDetails = invitation;
        this.isLoadingDetails = false;
        if (invitation) {
          log.info('Loaded invitation details', { invitationId, email: invitation.email });
        }
      });
    } catch (error) {
      log.error('Failed to load invitation details', error);

      runInAction(() => {
        this.isLoadingDetails = false;
      });
    }
  }

  // ============================================
  // Actions - Selection
  // ============================================

  /**
   * Select an item by ID and load its details
   */
  async selectItem(itemId: string | null): Promise<void> {
    runInAction(() => {
      this.selectedItemId = itemId;
      this.selectedUserDetails = null;
      this.selectedInvitationDetails = null;
      log.debug('Selected item', { itemId });
    });

    if (itemId) {
      const item = this.rawItems.find((i) => i.id === itemId);
      if (item) {
        if (item.isInvitation && item.invitationId) {
          await this.loadInvitationDetails(item.invitationId);
        } else {
          await this.loadUserDetails(item.id);
        }
      }
    }
  }

  /**
   * Clear the current selection
   */
  clearSelection(): void {
    runInAction(() => {
      this.selectedItemId = null;
      this.selectedUserDetails = null;
      this.selectedInvitationDetails = null;
    });
  }

  // ============================================
  // Actions - Filtering
  // ============================================

  /**
   * Set search term with debounce
   */
  setSearchTerm(term: string): void {
    runInAction(() => {
      this.searchTerm = term;
    });

    // Clear existing timer
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }

    // Set new timer
    this.searchDebounceTimer = setTimeout(() => {
      runInAction(() => {
        this.filters = { ...this.filters, searchTerm: term || undefined };
        this.pagination = { ...this.pagination, page: 1 }; // Reset to first page
      });
      this.loadUsers();
    }, SEARCH_DEBOUNCE_MS);
  }

  /**
   * Set status filter
   */
  async setStatusFilter(status: UserDisplayStatus | 'all'): Promise<void> {
    runInAction(() => {
      this.filters = { ...this.filters, status };
      this.pagination = { ...this.pagination, page: 1 };
    });
    await this.loadUsers();
  }

  /**
   * Set role filter
   */
  async setRoleFilter(roleId: string | undefined): Promise<void> {
    runInAction(() => {
      this.filters = { ...this.filters, roleId };
      this.pagination = { ...this.pagination, page: 1 };
    });
    await this.loadUsers();
  }

  /**
   * Toggle invitations only filter
   */
  async toggleInvitationsOnly(): Promise<void> {
    runInAction(() => {
      this.filters = {
        ...this.filters,
        invitationsOnly: !this.filters.invitationsOnly,
        usersOnly: false,
      };
      this.pagination = { ...this.pagination, page: 1 };
    });
    await this.loadUsers();
  }

  /**
   * Toggle users only filter
   */
  async toggleUsersOnly(): Promise<void> {
    runInAction(() => {
      this.filters = {
        ...this.filters,
        usersOnly: !this.filters.usersOnly,
        invitationsOnly: false,
      };
      this.pagination = { ...this.pagination, page: 1 };
    });
    await this.loadUsers();
  }

  /**
   * Clear all filters
   */
  async clearFilters(): Promise<void> {
    runInAction(() => {
      this.filters = { status: 'all' };
      this.searchTerm = '';
      this.pagination = { ...this.pagination, page: 1 };
    });
    await this.loadUsers();
  }

  // ============================================
  // Actions - Sorting
  // ============================================

  /**
   * Set sort options
   */
  async setSort(sortBy: UserSortOptions['sortBy'], sortOrder?: UserSortOptions['sortOrder']): Promise<void> {
    runInAction(() => {
      // Toggle order if same field, else use provided or default to asc
      const newOrder = sortBy === this.sort.sortBy && !sortOrder
        ? (this.sort.sortOrder === 'asc' ? 'desc' : 'asc')
        : (sortOrder ?? 'asc');

      this.sort = { sortBy, sortOrder: newOrder };
    });
    await this.loadUsers();
  }

  // ============================================
  // Actions - Pagination
  // ============================================

  /**
   * Go to a specific page
   */
  async goToPage(page: number): Promise<void> {
    if (page < 1 || page > this.totalPages) return;

    runInAction(() => {
      this.pagination = { ...this.pagination, page };
    });
    await this.loadUsers();
  }

  /**
   * Go to next page
   */
  async nextPage(): Promise<void> {
    if (this.hasMorePages) {
      await this.goToPage(this.pagination.page + 1);
    }
  }

  /**
   * Go to previous page
   */
  async previousPage(): Promise<void> {
    if (this.hasPreviousPages) {
      await this.goToPage(this.pagination.page - 1);
    }
  }

  /**
   * Change page size
   */
  async setPageSize(pageSize: number): Promise<void> {
    runInAction(() => {
      this.pagination = { page: 1, pageSize };
    });
    await this.loadUsers();
  }

  // ============================================
  // Actions - Email Lookup
  // ============================================

  /**
   * Check email status for smart invitation form
   */
  async checkEmailStatus(email: string): Promise<EmailLookupResult | null> {
    if (!email || email.trim().length < 3) {
      runInAction(() => {
        this.emailLookupResult = null;
      });
      return null;
    }

    log.debug('Checking email status', { email });

    runInAction(() => {
      this.isCheckingEmail = true;
    });

    try {
      const result = await this.queryService.checkEmailStatus(email);

      runInAction(() => {
        this.emailLookupResult = result;
        this.isCheckingEmail = false;
        log.info('Email lookup result', { email, status: result.status });
      });

      return result;
    } catch (error) {
      log.error('Failed to check email status', error);

      runInAction(() => {
        this.isCheckingEmail = false;
        this.emailLookupResult = null;
      });

      return null;
    }
  }

  /**
   * Clear email lookup result
   */
  clearEmailLookup(): void {
    runInAction(() => {
      this.emailLookupResult = null;
    });
  }

  // ============================================
  // Actions - Invitation Operations
  // ============================================

  /**
   * Invite a new user
   */
  async inviteUser(request: InviteUserRequest): Promise<UserOperationResult> {
    log.debug('Inviting user', { email: request.email });

    runInAction(() => {
      this.isSubmitting = true;
      this.error = null;
    });

    try {
      const result = await this.commandService.inviteUser(request);

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          this.successMessage = `Invitation sent to ${request.email}`;
          log.info('User invited', { email: request.email });
        } else {
          this.error = result.error ?? 'Failed to send invitation';
          log.warn('Failed to invite user', { error: result.error });
        }
      });

      // Refresh list on success
      if (result.success) {
        await this.loadUsers();
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send invitation';

      runInAction(() => {
        this.isSubmitting = false;
        this.error = errorMessage;
      });

      log.error('Error inviting user', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  /**
   * Resend an invitation
   */
  async resendInvitation(invitationId: string): Promise<UserOperationResult> {
    log.debug('Resending invitation', { invitationId });

    runInAction(() => {
      this.isSubmitting = true;
      this.error = null;
    });

    try {
      const result = await this.commandService.resendInvitation(invitationId);

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          this.successMessage = 'Invitation resent';
          log.info('Invitation resent', { invitationId });
        } else {
          this.error = result.error ?? 'Failed to resend invitation';
          log.warn('Failed to resend invitation', { error: result.error });
        }
      });

      // Refresh list on success
      if (result.success) {
        await this.loadUsers();
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to resend invitation';

      runInAction(() => {
        this.isSubmitting = false;
        this.error = errorMessage;
      });

      log.error('Error resending invitation', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  /**
   * Revoke an invitation
   */
  async revokeInvitation(invitationId: string): Promise<UserOperationResult> {
    log.debug('Revoking invitation', { invitationId });

    runInAction(() => {
      this.isSubmitting = true;
      this.error = null;
    });

    try {
      const result = await this.commandService.revokeInvitation(invitationId);

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          this.successMessage = 'Invitation cancelled';
          this.clearSelection();
          log.info('Invitation revoked', { invitationId });
        } else {
          this.error = result.error ?? 'Failed to revoke invitation';
          log.warn('Failed to revoke invitation', { error: result.error });
        }
      });

      // Refresh list on success
      if (result.success) {
        await this.loadUsers();
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to revoke invitation';

      runInAction(() => {
        this.isSubmitting = false;
        this.error = errorMessage;
      });

      log.error('Error revoking invitation', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  // ============================================
  // Actions - User Lifecycle
  // ============================================

  /**
   * Deactivate a user
   */
  async deactivateUser(userId: string): Promise<UserOperationResult> {
    log.debug('Deactivating user', { userId });

    runInAction(() => {
      this.isSubmitting = true;
      this.error = null;
    });

    try {
      const result = await this.commandService.deactivateUser(userId);

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          this.successMessage = 'User deactivated';
          log.info('User deactivated', { userId });

          // Update local state
          const index = this.rawItems.findIndex((i) => i.id === userId);
          if (index !== -1) {
            const updated = { ...this.rawItems[index], displayStatus: 'deactivated' as UserDisplayStatus };
            this.rawItems = [
              ...this.rawItems.slice(0, index),
              updated,
              ...this.rawItems.slice(index + 1),
            ];
          }
        } else {
          this.error = result.error ?? 'Failed to deactivate user';
          log.warn('Failed to deactivate user', { error: result.error });
        }
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to deactivate user';

      runInAction(() => {
        this.isSubmitting = false;
        this.error = errorMessage;
      });

      log.error('Error deactivating user', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  /**
   * Reactivate a user
   */
  async reactivateUser(userId: string): Promise<UserOperationResult> {
    log.debug('Reactivating user', { userId });

    runInAction(() => {
      this.isSubmitting = true;
      this.error = null;
    });

    try {
      const result = await this.commandService.reactivateUser(userId);

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          this.successMessage = 'User reactivated';
          log.info('User reactivated', { userId });

          // Update local state
          const index = this.rawItems.findIndex((i) => i.id === userId);
          if (index !== -1) {
            const updated = { ...this.rawItems[index], displayStatus: 'active' as UserDisplayStatus };
            this.rawItems = [
              ...this.rawItems.slice(0, index),
              updated,
              ...this.rawItems.slice(index + 1),
            ];
          }
        } else {
          this.error = result.error ?? 'Failed to reactivate user';
          log.warn('Failed to reactivate user', { error: result.error });
        }
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to reactivate user';

      runInAction(() => {
        this.isSubmitting = false;
        this.error = errorMessage;
      });

      log.error('Error reactivating user', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  /**
   * Delete a deactivated user from the organization
   *
   * This is a soft-delete that removes the user from the organization
   * but preserves the Supabase Auth user (they may belong to other orgs).
   *
   * Precondition: User must be deactivated before deletion.
   */
  async deleteUser(userId: string, reason?: string): Promise<UserOperationResult> {
    log.debug('Deleting user', { userId, reason });

    runInAction(() => {
      this.isSubmitting = true;
      this.error = null;
    });

    try {
      const result = await this.commandService.deleteUser(userId, reason);

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          this.successMessage = 'User deleted';
          this.clearSelection(); // User is removed, clear selection
          log.info('User deleted', { userId });
        } else {
          this.error = result.error ?? 'Failed to delete user';
          log.warn('Failed to delete user', { error: result.error });
        }
      });

      // Refresh list on success (user will no longer appear)
      if (result.success) {
        await this.loadUsers();
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete user';

      runInAction(() => {
        this.isSubmitting = false;
        this.error = errorMessage;
      });

      log.error('Error deleting user', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  // ============================================
  // Actions - Role Modification
  // ============================================

  /**
   * Modify roles for a user (add and/or remove)
   */
  async modifyRoles(request: ModifyRolesRequest): Promise<UserOperationResult> {
    log.debug('Modifying roles', { userId: request.userId });

    runInAction(() => {
      this.isSubmitting = true;
      this.error = null;
    });

    try {
      const result = await this.commandService.modifyRoles(request);

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          this.successMessage = 'Roles updated';
          log.info('Roles modified', { userId: request.userId });
        } else {
          this.error = result.error ?? 'Failed to modify roles';
          log.warn('Failed to modify roles', { error: result.error });
        }
      });

      // Refresh user details on success
      if (result.success && this.selectedItemId === request.userId) {
        await this.loadUserDetails(request.userId);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to modify roles';

      runInAction(() => {
        this.isSubmitting = false;
        this.error = errorMessage;
      });

      log.error('Error modifying roles', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  /**
   * Add existing user from another org to this org
   */
  async addUserToOrganization(
    userId: string,
    roles: Array<{ roleId: string; roleName: string }>
  ): Promise<UserOperationResult> {
    log.debug('Adding user to organization', { userId, roles });

    runInAction(() => {
      this.isSubmitting = true;
      this.error = null;
    });

    try {
      const result = await this.commandService.addUserToOrganization(userId, roles);

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          this.successMessage = 'User added to organization';
          log.info('User added to organization', { userId });
        } else {
          this.error = result.error ?? 'Failed to add user';
          log.warn('Failed to add user to organization', { error: result.error });
        }
      });

      // Refresh list on success
      if (result.success) {
        await this.loadUsers();
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to add user';

      runInAction(() => {
        this.isSubmitting = false;
        this.error = errorMessage;
      });

      log.error('Error adding user to organization', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  // ============================================
  // Actions - Extended Data Loading
  // ============================================

  /**
   * Load extended data for the selected user (addresses, phones, org access)
   */
  async loadUserExtendedData(userId: string): Promise<void> {
    log.debug('Loading extended data', { userId });

    runInAction(() => {
      this.isLoadingExtendedData = true;
    });

    try {
      const [addresses, phones, orgAccess] = await Promise.all([
        this.queryService.getUserAddresses(userId),
        this.queryService.getUserPhones(userId),
        this.queryService.getUserOrgAccess(userId, this.currentOrgId),
      ]);

      runInAction(() => {
        this.userAddresses = addresses;
        this.userPhones = phones;
        this.userOrgAccess = orgAccess;
        this.isLoadingExtendedData = false;
        log.info('Loaded extended data', {
          userId,
          addressCount: addresses.length,
          phoneCount: phones.length,
          hasOrgAccess: !!orgAccess,
        });
      });
    } catch (error) {
      log.error('Failed to load extended data', error);

      runInAction(() => {
        this.isLoadingExtendedData = false;
      });
    }
  }

  /**
   * Load addresses for a user
   */
  async loadUserAddresses(userId: string): Promise<void> {
    log.debug('Loading user addresses', { userId });

    try {
      const addresses = await this.queryService.getUserAddresses(userId);

      runInAction(() => {
        this.userAddresses = addresses;
        log.info('Loaded user addresses', { userId, count: addresses.length });
      });
    } catch (error) {
      log.error('Failed to load user addresses', error);
    }
  }

  /**
   * Load phones for a user
   */
  async loadUserPhones(userId: string): Promise<void> {
    log.debug('Loading user phones', { userId });

    try {
      const phones = await this.queryService.getUserPhones(userId);

      runInAction(() => {
        this.userPhones = phones;
        log.info('Loaded user phones', { userId, count: phones.length });
      });
    } catch (error) {
      log.error('Failed to load user phones', error);
    }
  }

  /**
   * Load org access for a user
   */
  async loadUserOrgAccess(userId: string, orgId?: string): Promise<void> {
    const targetOrgId = orgId ?? this.currentOrgId;
    log.debug('Loading user org access', { userId, orgId: targetOrgId });

    try {
      const orgAccess = await this.queryService.getUserOrgAccess(userId, targetOrgId);

      runInAction(() => {
        this.userOrgAccess = orgAccess;
        log.info('Loaded user org access', { userId, orgId: targetOrgId, hasAccess: !!orgAccess });
      });
    } catch (error) {
      log.error('Failed to load user org access', error);
    }
  }

  /**
   * Clear extended data state
   */
  clearExtendedData(): void {
    runInAction(() => {
      this.userAddresses = [];
      this.userPhones = [];
      this.userOrgAccess = null;
    });
  }

  // ============================================
  // Actions - Address Operations
  // ============================================

  /**
   * Add a new address for the selected user
   */
  async addUserAddress(request: AddUserAddressRequest): Promise<UserOperationResult> {
    log.debug('Adding user address', { userId: request.userId, label: request.label });

    runInAction(() => {
      this.isSubmitting = true;
      this.error = null;
    });

    try {
      const result = await this.commandService.addUserAddress(request);

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          this.successMessage = 'Address added';
          log.info('Address added', { userId: request.userId });
        } else {
          this.error = result.error ?? 'Failed to add address';
          log.warn('Failed to add address', { error: result.error });
        }
      });

      // Refresh addresses on success
      if (result.success) {
        await this.loadUserAddresses(request.userId);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to add address';

      runInAction(() => {
        this.isSubmitting = false;
        this.error = errorMessage;
      });

      log.error('Error adding address', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  /**
   * Update an existing user address
   */
  async updateUserAddress(request: UpdateUserAddressRequest): Promise<UserOperationResult> {
    log.debug('Updating user address', { addressId: request.addressId });

    runInAction(() => {
      this.isSubmitting = true;
      this.error = null;
    });

    try {
      const result = await this.commandService.updateUserAddress(request);

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          this.successMessage = 'Address updated';
          log.info('Address updated', { addressId: request.addressId });
        } else {
          this.error = result.error ?? 'Failed to update address';
          log.warn('Failed to update address', { error: result.error });
        }
      });

      // Refresh addresses on success
      if (result.success && this.selectedItemId) {
        await this.loadUserAddresses(this.selectedItemId);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update address';

      runInAction(() => {
        this.isSubmitting = false;
        this.error = errorMessage;
      });

      log.error('Error updating address', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  /**
   * Remove (soft delete) a user address
   */
  async removeUserAddress(request: RemoveUserAddressRequest): Promise<UserOperationResult> {
    log.debug('Removing user address', { addressId: request.addressId });

    runInAction(() => {
      this.isSubmitting = true;
      this.error = null;
    });

    try {
      const result = await this.commandService.removeUserAddress(request);

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          this.successMessage = 'Address removed';
          log.info('Address removed', { addressId: request.addressId });
        } else {
          this.error = result.error ?? 'Failed to remove address';
          log.warn('Failed to remove address', { error: result.error });
        }
      });

      // Refresh addresses on success
      if (result.success && this.selectedItemId) {
        await this.loadUserAddresses(this.selectedItemId);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to remove address';

      runInAction(() => {
        this.isSubmitting = false;
        this.error = errorMessage;
      });

      log.error('Error removing address', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  // ============================================
  // Actions - Phone Operations
  // ============================================

  /**
   * Add a new phone for the selected user
   */
  async addUserPhone(request: AddUserPhoneRequest): Promise<UserOperationResult> {
    log.debug('Adding user phone', { userId: request.userId, label: request.label });

    runInAction(() => {
      this.isSubmitting = true;
      this.error = null;
    });

    try {
      const result = await this.commandService.addUserPhone(request);

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          this.successMessage = 'Phone added';
          log.info('Phone added', { userId: request.userId });
        } else {
          this.error = result.error ?? 'Failed to add phone';
          log.warn('Failed to add phone', { error: result.error });
        }
      });

      // Refresh phones on success
      if (result.success) {
        await this.loadUserPhones(request.userId);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to add phone';

      runInAction(() => {
        this.isSubmitting = false;
        this.error = errorMessage;
      });

      log.error('Error adding phone', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  /**
   * Update an existing user phone
   */
  async updateUserPhone(request: UpdateUserPhoneRequest): Promise<UserOperationResult> {
    log.debug('Updating user phone', { phoneId: request.phoneId });

    runInAction(() => {
      this.isSubmitting = true;
      this.error = null;
    });

    try {
      const result = await this.commandService.updateUserPhone(request);

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          this.successMessage = 'Phone updated';
          log.info('Phone updated', { phoneId: request.phoneId });
        } else {
          this.error = result.error ?? 'Failed to update phone';
          log.warn('Failed to update phone', { error: result.error });
        }
      });

      // Refresh phones on success
      if (result.success && this.selectedItemId) {
        await this.loadUserPhones(this.selectedItemId);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update phone';

      runInAction(() => {
        this.isSubmitting = false;
        this.error = errorMessage;
      });

      log.error('Error updating phone', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  /**
   * Remove (soft delete) a user phone
   */
  async removeUserPhone(request: RemoveUserPhoneRequest): Promise<UserOperationResult> {
    log.debug('Removing user phone', { phoneId: request.phoneId });

    runInAction(() => {
      this.isSubmitting = true;
      this.error = null;
    });

    try {
      const result = await this.commandService.removeUserPhone(request);

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          this.successMessage = 'Phone removed';
          log.info('Phone removed', { phoneId: request.phoneId });
        } else {
          this.error = result.error ?? 'Failed to remove phone';
          log.warn('Failed to remove phone', { error: result.error });
        }
      });

      // Refresh phones on success
      if (result.success && this.selectedItemId) {
        await this.loadUserPhones(this.selectedItemId);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to remove phone';

      runInAction(() => {
        this.isSubmitting = false;
        this.error = errorMessage;
      });

      log.error('Error removing phone', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  // ============================================
  // Actions - Access Dates & Notifications
  // ============================================

  /**
   * Update access dates for a user in the current organization
   */
  async updateAccessDates(request: UpdateAccessDatesRequest): Promise<UserOperationResult> {
    log.debug('Updating access dates', { userId: request.userId, orgId: request.orgId });

    runInAction(() => {
      this.isSubmitting = true;
      this.error = null;
    });

    try {
      const result = await this.commandService.updateAccessDates(request);

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          this.successMessage = 'Access dates updated';
          log.info('Access dates updated', { userId: request.userId, orgId: request.orgId });
        } else {
          this.error = result.error ?? 'Failed to update access dates';
          log.warn('Failed to update access dates', { error: result.error });
        }
      });

      // Refresh org access on success
      if (result.success) {
        await this.loadUserOrgAccess(request.userId, request.orgId);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update access dates';

      runInAction(() => {
        this.isSubmitting = false;
        this.error = errorMessage;
      });

      log.error('Error updating access dates', error);

      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'UNKNOWN', message: errorMessage },
      };
    }
  }

  /**
   * Update notification preferences for a user in the current organization
   */
  async updateNotificationPreferences(
    request: UpdateNotificationPreferencesRequest
  ): Promise<UserOperationResult> {
    log.debug('Updating notification preferences', { userId: request.userId, orgId: request.orgId });

    runInAction(() => {
      this.isSubmitting = true;
      this.error = null;
    });

    try {
      const result = await this.commandService.updateNotificationPreferences(request);

      runInAction(() => {
        this.isSubmitting = false;

        if (result.success) {
          this.successMessage = 'Notification preferences updated';
          log.info('Notification preferences updated', { userId: request.userId, orgId: request.orgId });
        } else {
          this.error = result.error ?? 'Failed to update notification preferences';
          log.warn('Failed to update notification preferences', { error: result.error });
        }
      });

      // Refresh org access on success
      if (result.success) {
        await this.loadUserOrgAccess(request.userId, request.orgId);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update notification preferences';

      runInAction(() => {
        this.isSubmitting = false;
        this.error = errorMessage;
      });

      log.error('Error updating notification preferences', error);

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
   * Clear success message
   */
  clearSuccessMessage(): void {
    runInAction(() => {
      this.successMessage = null;
    });
  }

  /**
   * Clear all messages
   */
  clearMessages(): void {
    runInAction(() => {
      this.error = null;
      this.successMessage = null;
    });
  }

  /**
   * Get item by ID from loaded data
   */
  getItemById(itemId: string): UserListItem | null {
    return this.rawItems.find((i) => i.id === itemId) ?? null;
  }

  /**
   * Dispose of any timers
   */
  dispose(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
  }
}
