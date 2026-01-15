/**
 * User Query Service Interface
 *
 * Provides read-only access to user and invitation data within the current
 * organization. Supports the unified user list that combines active users
 * with pending invitations.
 *
 * Security Model:
 * - All operations scoped to current organization (via JWT org_id claim)
 * - RLS policies enforce organization isolation
 * - Users can only view users within their organizational scope
 *
 * @see documentation/architecture/authorization/rbac-architecture.md
 * @see dev/active/user-management-context.md
 */

import type {
  User,
  UserWithRoles,
  UserListItem,
  Invitation,
  EmailLookupResult,
  UserQueryOptions,
  PaginatedResult,
  RoleReference,
  UserAddress,
  UserPhone,
  UserOrgAccess,
  NotificationPreferences,
} from '@/types/user.types';

export interface IUserQueryService {
  /**
   * Retrieves a unified list of users and invitations for the current organization
   *
   * Returns a paginated list that combines:
   * - Active and deactivated users
   * - Pending and expired invitations
   *
   * Results are unified into UserListItem format with computed displayStatus.
   *
   * @param options - Query options including filters, pagination, and sorting
   * @returns Promise resolving to paginated result
   *
   * @example
   * // Get first page of all users and invitations
   * const result = await service.getUsersPaginated({
   *   pagination: { page: 1, pageSize: 20 },
   *   sort: { sortBy: 'name', sortOrder: 'asc' }
   * });
   *
   * @example
   * // Filter to pending invitations only
   * const result = await service.getUsersPaginated({
   *   filters: { status: 'pending' },
   *   pagination: { page: 1, pageSize: 10 }
   * });
   */
  getUsersPaginated(options?: UserQueryOptions): Promise<PaginatedResult<UserListItem>>;

  /**
   * Retrieves a single user by ID with their role assignments
   *
   * @param userId - User UUID
   * @returns Promise resolving to user with roles or null if not found
   *
   * @example
   * const user = await service.getUserById('123e4567-e89b-12d3-a456-426614174000');
   * if (user) {
   *   console.log(user.firstName, user.roles.length);
   * }
   */
  getUserById(userId: string): Promise<UserWithRoles | null>;

  /**
   * Retrieves all pending invitations for the current organization
   *
   * Includes both valid (not yet expired) and expired invitations.
   * Use computeInvitationDisplayStatus() to determine actual status.
   *
   * @returns Promise resolving to array of invitations
   *
   * @example
   * const invitations = await service.getInvitations();
   * const pending = invitations.filter(
   *   inv => computeInvitationDisplayStatus(inv) === 'pending'
   * );
   */
  getInvitations(): Promise<Invitation[]>;

  /**
   * Retrieves a single invitation by ID
   *
   * @param invitationId - Invitation UUID
   * @returns Promise resolving to invitation or null if not found
   *
   * @example
   * const invitation = await service.getInvitationById(invId);
   * if (invitation) {
   *   console.log(invitation.email, invitation.status);
   * }
   */
  getInvitationById(invitationId: string): Promise<Invitation | null>;

  /**
   * Performs smart email lookup to determine appropriate action
   *
   * Called when admin enters an email in the invitation form (on blur).
   * Returns status indicating what action should be taken:
   *
   * - not_found: Show full invitation form
   * - pending: Offer to resend existing invitation
   * - expired: Offer to send new invitation
   * - active_member: Show "already member" message
   * - deactivated: Offer to reactivate user
   * - other_org: Offer to add user to this organization
   *
   * @param email - Email address to check
   * @returns Promise resolving to lookup result with status and context
   *
   * @example
   * const result = await service.checkEmailStatus('user@example.com');
   * switch (result.status) {
   *   case 'not_found':
   *     showInvitationForm();
   *     break;
   *   case 'pending':
   *     showResendPrompt(result.invitationId, result.expiresAt);
   *     break;
   *   case 'active_member':
   *     showAlreadyMemberMessage(result.userId);
   *     break;
   * }
   */
  checkEmailStatus(email: string): Promise<EmailLookupResult>;

  /**
   * Retrieves roles that the current user can assign to invitees
   *
   * Filtered by:
   * 1. Permission subset constraint: role.permissions is a subset of inviter's permissions
   * 2. Scope hierarchy constraint: role.scope is within inviter's scope
   *
   * Used to populate the role selector in the invitation form.
   *
   * @returns Promise resolving to array of assignable role references
   *
   * @example
   * const assignableRoles = await service.getAssignableRoles();
   * // Only show roles the user can actually assign
   * setRoleOptions(assignableRoles);
   */
  getAssignableRoles(): Promise<RoleReference[]>;

  /**
   * Retrieves organizations the current user has access to
   *
   * Used for the org selector dropdown to show which organizations
   * the user can switch to.
   *
   * @returns Promise resolving to array of organization references
   *
   * @example
   * const orgs = await service.getUserOrganizations();
   * if (orgs.length > 1) {
   *   showOrgSelector(orgs);
   * }
   */
  getUserOrganizations(): Promise<
    Array<{
      id: string;
      name: string;
      type: string;
    }>
  >;

  // ============================================================================
  // Extended Data Collection Methods (Phase 0A)
  // ============================================================================

  /**
   * Retrieves all addresses for a user
   *
   * Returns both global addresses (no org_id) and org-specific overrides
   * for the current organization.
   *
   * @param userId - User UUID
   * @returns Promise resolving to array of user addresses
   *
   * @example
   * const addresses = await service.getUserAddresses(userId);
   * const primary = addresses.find(a => a.isPrimary);
   * const orgOverrides = addresses.filter(a => a.orgId);
   */
  getUserAddresses(userId: string): Promise<UserAddress[]>;

  /**
   * Retrieves all phone numbers for a user
   *
   * Returns both global phones (no org_id) and org-specific overrides
   * for the current organization.
   *
   * @param userId - User UUID
   * @returns Promise resolving to array of user phones
   *
   * @example
   * const phones = await service.getUserPhones(userId);
   * const smsCapable = phones.filter(p => p.smsCapable);
   * const primary = phones.find(p => p.isPrimary);
   */
  getUserPhones(userId: string): Promise<UserPhone[]>;

  /**
   * Retrieves user's access and notification preferences for a specific organization
   *
   * Returns the user_org_access record which includes:
   * - Access start/expiration dates
   * - Notification preferences (email, SMS, in-app)
   *
   * @param userId - User UUID
   * @param orgId - Organization UUID
   * @returns Promise resolving to user org access or null if not found
   *
   * @example
   * const access = await service.getUserOrgAccess(userId, orgId);
   * if (access?.accessExpirationDate) {
   *   const daysRemaining = calculateDaysRemaining(access.accessExpirationDate);
   *   if (daysRemaining < 14) {
   *     showExpirationWarning(daysRemaining);
   *   }
   * }
   */
  getUserOrgAccess(userId: string, orgId: string): Promise<UserOrgAccess | null>;

  /**
   * Retrieves user's notification preferences for the current organization
   *
   * Uses the dedicated notification preferences projection table for reads.
   * Returns defaults if no preferences have been set.
   *
   * @param userId - User UUID
   * @returns Promise resolving to notification preferences
   *
   * @example
   * const prefs = await service.getUserNotificationPreferences(userId);
   * if (prefs.sms.enabled && prefs.sms.phoneId) {
   *   await sendSmsNotification(prefs.sms.phoneId, message);
   * }
   */
  getUserNotificationPreferences(userId: string): Promise<NotificationPreferences>;
}
