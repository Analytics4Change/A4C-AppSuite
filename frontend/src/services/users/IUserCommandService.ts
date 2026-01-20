/**
 * User Command Service Interface
 *
 * Provides write operations for user and invitation management.
 * All operations emit domain events for CQRS consistency.
 *
 * Security Model:
 * - All operations scoped to current organization (via JWT org_id claim)
 * - Role assignments subject to subset-only delegation rule
 * - Scope hierarchy enforced (can only assign roles within your scope)
 * - Permissions checked server-side via Edge Functions
 *
 * Required Permissions:
 * - user.create: Invite users
 * - user.update: Update user profiles
 * - user.delete: Deactivate/reactivate users
 * - user.role_assign: Assign/revoke roles
 *
 * @see documentation/architecture/authorization/rbac-architecture.md
 * @see dev/active/user-management-context.md
 */

import type {
  InviteUserRequest,
  UpdateUserRequest,
  ModifyRolesRequest,
  UserOperationResult,
  AddUserAddressRequest,
  UpdateUserAddressRequest,
  RemoveUserAddressRequest,
  AddUserPhoneRequest,
  UpdateUserPhoneRequest,
  RemoveUserPhoneRequest,
  UpdateAccessDatesRequest,
  UpdateNotificationPreferencesRequest,
} from '@/types/user.types';

export interface IUserCommandService {
  /**
   * Invites a new user to the organization
   *
   * Creates an invitation with the specified roles. The invitation
   * is sent via email and expires after 7 days (default).
   *
   * Events emitted:
   * - user.invited: When invitation is created and email sent
   *
   * Security:
   * - Roles must pass subset-only delegation check
   * - Roles must be within inviter's scope hierarchy
   * - Email is validated for format
   *
   * @param request - Invitation details including email, name, and roles
   * @returns Promise resolving to operation result with invitation
   *
   * @example
   * const result = await service.inviteUser({
   *   email: 'newuser@example.com',
   *   firstName: 'Jane',
   *   lastName: 'Doe',
   *   roles: [{ roleId: 'role-uuid', roleName: 'Clinician' }]
   * });
   *
   * if (result.success) {
   *   showSuccess(`Invitation sent to ${result.invitation.email}`);
   * } else if (result.errorDetails?.code === 'SUBSET_ONLY_VIOLATION') {
   *   showError('Cannot assign roles with permissions you do not have');
   * }
   */
  inviteUser(request: InviteUserRequest): Promise<UserOperationResult>;

  /**
   * Resends an existing invitation
   *
   * Revokes the old invitation and creates a new one with the same
   * details but fresh token and expiration.
   *
   * Events emitted:
   * - invitation.revoked: For the old invitation
   * - user.invited: For the new invitation
   *
   * @param invitationId - ID of the invitation to resend
   * @returns Promise resolving to operation result with new invitation
   *
   * @example
   * const result = await service.resendInvitation(existingInvitationId);
   * if (result.success) {
   *   showSuccess('Invitation resent');
   * }
   */
  resendInvitation(invitationId: string): Promise<UserOperationResult>;

  /**
   * Revokes a pending invitation
   *
   * Cancels the invitation, preventing the user from accepting it.
   *
   * Events emitted:
   * - invitation.revoked: With reason 'manual_revocation'
   *
   * @param invitationId - ID of the invitation to revoke
   * @returns Promise resolving to operation result
   *
   * @example
   * const result = await service.revokeInvitation(invitationId);
   * if (result.success) {
   *   showSuccess('Invitation cancelled');
   * }
   */
  revokeInvitation(invitationId: string): Promise<UserOperationResult>;

  /**
   * Deactivates a user account
   *
   * Prevents the user from logging in by banning them via Supabase Auth.
   * The user's data is preserved and they can be reactivated later.
   *
   * Events emitted:
   * - user.deactivated
   *
   * @param userId - ID of the user to deactivate
   * @returns Promise resolving to operation result
   *
   * @example
   * const result = await service.deactivateUser(userId);
   * if (result.success) {
   *   showSuccess('User deactivated');
   * } else if (result.errorDetails?.code === 'ALREADY_INACTIVE') {
   *   showError('User is already deactivated');
   * }
   */
  deactivateUser(userId: string): Promise<UserOperationResult>;

  /**
   * Reactivates a deactivated user account
   *
   * Removes the ban from Supabase Auth, allowing the user to log in again.
   *
   * Events emitted:
   * - user.reactivated
   *
   * @param userId - ID of the user to reactivate
   * @returns Promise resolving to operation result
   *
   * @example
   * const result = await service.reactivateUser(userId);
   * if (result.success) {
   *   showSuccess('User reactivated');
   * } else if (result.errorDetails?.code === 'ALREADY_ACTIVE') {
   *   showError('User is already active');
   * }
   */
  reactivateUser(userId: string): Promise<UserOperationResult>;

  /**
   * Permanently deletes a deactivated user from the organization
   *
   * This is a soft-delete operation: sets deleted_at timestamp, removes
   * the user from organization projections and role assignments.
   * The Supabase Auth user is NOT deleted (user may belong to other orgs).
   *
   * Precondition: User must be deactivated before deletion.
   *
   * Events emitted:
   * - user.deleted
   *
   * @param userId - ID of the user to delete
   * @param reason - Optional reason for deletion (stored in event metadata)
   * @returns Promise resolving to operation result
   *
   * @example
   * const result = await service.deleteUser(userId, 'User requested account removal');
   * if (result.success) {
   *   showSuccess('User deleted');
   * } else if (result.errorDetails?.code === 'USER_ACTIVE') {
   *   showError('Cannot delete active user. Deactivate first.');
   * }
   */
  deleteUser(userId: string, reason?: string): Promise<UserOperationResult>;

  /**
   * Updates a user's profile information
   *
   * Updates first name and/or last name. Email changes are not supported
   * through this method (would require email verification flow).
   *
   * Events emitted:
   * - user.updated
   *
   * @param request - Update details
   * @returns Promise resolving to operation result
   *
   * @example
   * const result = await service.updateUser({
   *   userId: user.id,
   *   firstName: 'Jane',
   *   lastName: 'Smith'
   * });
   */
  updateUser(request: UpdateUserRequest): Promise<UserOperationResult>;

  /**
   * Modifies roles for a user (add and/or remove)
   *
   * Modifies the user's role assignments within the organization.
   * Role assignments are subject to subset-only delegation rule.
   *
   * Events emitted:
   * - user.role.revoked: For each role removed
   * - user.role.assigned: For each role added
   *
   * Security:
   * - Can only assign roles with permissions you possess
   * - Can only assign roles within your scope hierarchy
   * - Service role bypasses these checks (for bootstrap workflow)
   *
   * @param request - Role changes
   * @returns Promise resolving to operation result
   *
   * @example
   * const result = await service.modifyRoles({
   *   userId: user.id,
   *   roleIdsToAdd: ['role-uuid-1'],
   *   roleIdsToRemove: ['role-uuid-2']
   * });
   *
   * if (result.errorDetails?.code === 'SCOPE_VIOLATION') {
   *   showError('Cannot assign role outside your organizational scope');
   * }
   */
  modifyRoles(request: ModifyRolesRequest): Promise<UserOperationResult>;

  /**
   * Adds an existing user to the current organization
   *
   * Used for the "Sally scenario" where a user already exists in
   * another organization and needs access to this one.
   *
   * Events emitted:
   * - user.role.assigned: For each role granted
   *
   * @param userId - ID of the existing user
   * @param roles - Roles to assign in this organization
   * @returns Promise resolving to operation result
   *
   * @example
   * // User exists in system but not in current org
   * const result = await service.addUserToOrganization(
   *   existingUserId,
   *   [{ roleId: 'role-uuid', roleName: 'Clinician' }]
   * );
   */
  addUserToOrganization(
    userId: string,
    roles: Array<{ roleId: string; roleName: string }>
  ): Promise<UserOperationResult>;

  /**
   * Switches the current user's active organization
   *
   * Updates the user's preferred organization and triggers a token refresh
   * to update JWT claims with the new org context.
   *
   * Events emitted:
   * - user.organization_switched
   *
   * @param organizationId - ID of the organization to switch to
   * @returns Promise resolving to operation result
   *
   * @example
   * const result = await service.switchOrganization(newOrgId);
   * if (result.success) {
   *   // Token will be refreshed with new org_id claim
   *   await refreshSession();
   * }
   */
  switchOrganization(organizationId: string): Promise<UserOperationResult>;

  /**
   * Triggers password reset for a user
   *
   * Sends a password reset email via Supabase Auth's built-in
   * resetPasswordForEmail() functionality.
   *
   * @param email - Email address of the user
   * @returns Promise resolving to operation result
   *
   * @example
   * const result = await service.resetPassword(user.email);
   * if (result.success) {
   *   showSuccess('Password reset email sent');
   * }
   */
  resetPassword(email: string): Promise<UserOperationResult>;

  // ============================================================================
  // Extended Data Collection Methods (Phase 0A)
  // ============================================================================

  /**
   * Adds a new address for a user
   *
   * Creates either a global address (if no orgId) or an org-specific
   * override address (if orgId is provided).
   *
   * Events emitted:
   * - user.address.added
   *
   * @param request - Address details
   * @returns Promise resolving to operation result
   *
   * @example
   * // Add global address
   * const result = await service.addUserAddress({
   *   userId: user.id,
   *   label: 'Home',
   *   type: 'physical',
   *   street1: '123 Main St',
   *   city: 'Springfield',
   *   state: 'IL',
   *   zipCode: '62701',
   *   isPrimary: true
   * });
   *
   * @example
   * // Add org-specific override
   * const result = await service.addUserAddress({
   *   userId: user.id,
   *   orgId: currentOrgId,
   *   label: 'Work Location',
   *   type: 'physical',
   *   street1: '456 Office Dr',
   *   city: 'Chicago',
   *   state: 'IL',
   *   zipCode: '60601'
   * });
   */
  addUserAddress(request: AddUserAddressRequest): Promise<UserOperationResult>;

  /**
   * Updates an existing user address
   *
   * Can update both global addresses and org-specific overrides.
   *
   * Events emitted:
   * - user.address.updated
   *
   * @param request - Address update details
   * @returns Promise resolving to operation result
   */
  updateUserAddress(request: UpdateUserAddressRequest): Promise<UserOperationResult>;

  /**
   * Removes (deactivates) a user address
   *
   * Sets is_active=false rather than deleting. Address history is preserved.
   *
   * Events emitted:
   * - user.address.removed
   *
   * @param request - Address removal details
   * @returns Promise resolving to operation result
   */
  removeUserAddress(request: RemoveUserAddressRequest): Promise<UserOperationResult>;

  /**
   * Adds a new phone number for a user
   *
   * Creates either a global phone (if no orgId) or an org-specific
   * override phone (if orgId is provided).
   *
   * Events emitted:
   * - user.phone.added
   *
   * @param request - Phone details
   * @returns Promise resolving to operation result
   *
   * @example
   * const result = await service.addUserPhone({
   *   userId: user.id,
   *   label: 'Mobile',
   *   type: 'mobile',
   *   number: '555-123-4567',
   *   countryCode: '+1',
   *   smsCapable: true,
   *   isPrimary: true
   * });
   */
  addUserPhone(request: AddUserPhoneRequest): Promise<UserOperationResult>;

  /**
   * Updates an existing user phone
   *
   * Can update both global phones and org-specific overrides.
   *
   * Events emitted:
   * - user.phone.updated
   *
   * @param request - Phone update details
   * @returns Promise resolving to operation result
   */
  updateUserPhone(request: UpdateUserPhoneRequest): Promise<UserOperationResult>;

  /**
   * Removes (deactivates) a user phone
   *
   * Sets is_active=false rather than deleting. Phone history is preserved.
   *
   * Events emitted:
   * - user.phone.removed
   *
   * @param request - Phone removal details
   * @returns Promise resolving to operation result
   */
  removeUserPhone(request: RemoveUserPhoneRequest): Promise<UserOperationResult>;

  /**
   * Updates access dates for a user in an organization
   *
   * Sets when the user can start accessing the organization and when
   * their access expires. These dates are enforced in the JWT custom
   * claims hook.
   *
   * Events emitted:
   * - user.access_dates.updated
   *
   * @param request - Access date update details
   * @returns Promise resolving to operation result
   *
   * @example
   * // Set access window for a seasonal employee
   * const result = await service.updateAccessDates({
   *   userId: user.id,
   *   orgId: currentOrgId,
   *   accessStartDate: '2025-06-01',
   *   accessExpirationDate: '2025-09-01'
   * });
   */
  updateAccessDates(request: UpdateAccessDatesRequest): Promise<UserOperationResult>;

  /**
   * Updates notification preferences for a user in an organization
   *
   * Each organization can have different notification settings.
   * SMS requires a valid phone_id pointing to an SMS-capable phone.
   *
   * Events emitted:
   * - user.notification_preferences.updated
   *
   * @param request - Notification preferences update details
   * @returns Promise resolving to operation result
   *
   * @example
   * const result = await service.updateNotificationPreferences({
   *   userId: user.id,
   *   orgId: currentOrgId,
   *   notificationPreferences: {
   *     email: true,
   *     sms: { enabled: true, phoneId: smsPhoneId },
   *     inApp: false
   *   }
   * });
   */
  updateNotificationPreferences(
    request: UpdateNotificationPreferencesRequest
  ): Promise<UserOperationResult>;
}
