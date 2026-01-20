/**
 * Mock User Command Service
 *
 * Development/testing implementation of IUserCommandService.
 * Uses MockUserQueryService for data persistence.
 * Simulates all user management operations with realistic behavior.
 *
 * Features:
 * - Invitation creation with subset-only validation simulation
 * - User lifecycle management (activate/deactivate)
 * - Role assignment with security checks
 * - Multi-organization user support
 *
 * @see IUserCommandService for interface documentation
 */

import { Logger } from '@/utils/logger';
import type {
  InviteUserRequest,
  UpdateUserRequest,
  ModifyRolesRequest,
  UserOperationResult,
  User,
  Invitation,
  AddUserAddressRequest,
  UpdateUserAddressRequest,
  RemoveUserAddressRequest,
  AddUserPhoneRequest,
  UpdateUserPhoneRequest,
  RemoveUserPhoneRequest,
  UpdateAccessDatesRequest,
  UpdateNotificationPreferencesRequest,
  UserAddress,
  UserPhone,
} from '@/types/user.types';
import {
  validateAccessDates,
  validatePhoneNumber,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from '@/types/user.types';
import type { Role } from '@/types/role.types';
import type { IUserCommandService } from './IUserCommandService';
import type { MockUserQueryService } from './MockUserQueryService';

const log = Logger.getLogger('api');

/**
 * Generate a mock UUID
 */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate a secure-looking token
 */
function generateToken(): string {
  return Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}

/**
 * Mock roles available for assignment
 */
const MOCK_ROLES: Role[] = [
  {
    id: 'role-org-admin',
    name: 'Organization Admin',
    description: 'Full administrative access',
    organizationId: 'org-acme-healthcare',
    orgHierarchyScope: 'root.provider.acme_healthcare',
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    permissionCount: 18,
    userCount: 2,
  },
  {
    id: 'role-clinician',
    name: 'Clinician',
    description: 'Clinical staff with patient care responsibilities',
    organizationId: 'org-acme-healthcare',
    orgHierarchyScope: 'root.provider.acme_healthcare',
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    permissionCount: 8,
    userCount: 15,
  },
  {
    id: 'role-med-viewer',
    name: 'Medication Viewer',
    description: 'Read-only access to medication records',
    organizationId: 'org-acme-healthcare',
    orgHierarchyScope: 'root.provider.acme_healthcare.main_campus',
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    permissionCount: 3,
    userCount: 5,
  },
];

export class MockUserCommandService implements IUserCommandService {
  private queryService: MockUserQueryService;

  constructor(queryService: MockUserQueryService) {
    this.queryService = queryService;
    log.info('MockUserCommandService initialized');
  }

  /**
   * Simulate network delay
   */
  private async simulateDelay(): Promise<void> {
    if (import.meta.env.MODE === 'test') return;
    const delay = Math.random() * 300 + 150;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Validate email format
   */
  private validateEmail(email: string): string | null {
    const trimmed = email.trim();
    if (!trimmed) return 'Email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'Invalid email format';
    return null;
  }

  async inviteUser(request: InviteUserRequest): Promise<UserOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Inviting user', { email: request.email });

    // Validate email
    const emailError = this.validateEmail(request.email);
    if (emailError) {
      return {
        success: false,
        error: emailError,
        errorDetails: { code: 'VALIDATION_ERROR', message: emailError },
      };
    }

    // Check if email already exists
    const emailStatus = await this.queryService.checkEmailStatus(request.email);
    if (emailStatus.status === 'active_member') {
      return {
        success: false,
        error: 'User is already a member of this organization',
        errorDetails: { code: 'ALREADY_MEMBER', message: 'User already has access' },
      };
    }

    if (emailStatus.status === 'pending') {
      return {
        success: false,
        error: 'An invitation is already pending for this email',
        errorDetails: {
          code: 'ALREADY_EXISTS',
          message: 'Use resend invitation instead',
          context: { invitationId: emailStatus.invitationId },
        },
      };
    }

    // Roles are optional - empty array means user has no permissions until assigned
    // Simulate subset-only validation (mock always passes for known roles)
    const knownRoleIds = MOCK_ROLES.map((r) => r.id);
    const unknownRoles = (request.roles || []).filter((r) => !knownRoleIds.includes(r.roleId));
    if (unknownRoles.length > 0) {
      return {
        success: false,
        error: 'Cannot assign unknown roles',
        errorDetails: {
          code: 'SUBSET_ONLY_VIOLATION',
          message: `Unknown role: ${unknownRoles[0].roleName}`,
        },
      };
    }

    // Create invitation
    const now = new Date();
    const expirationDays = request.expirationDays || 7;
    const expiresAt = new Date(now.getTime() + expirationDays * 24 * 60 * 60 * 1000);

    const invitation: Invitation = {
      id: generateId(),
      invitationId: generateId(),
      organizationId: 'org-acme-healthcare',
      email: request.email.trim().toLowerCase(),
      firstName: request.firstName.trim(),
      lastName: request.lastName.trim(),
      roles: request.roles,
      token: generateToken(),
      expiresAt,
      status: 'pending',
      acceptedAt: null,
      createdAt: now,
      updatedAt: now,
      // Extended data collection fields (Phase 0A)
      accessStartDate: request.accessStartDate || null,
      accessExpirationDate: request.accessExpirationDate || null,
      notificationPreferences: request.notificationPreferences || DEFAULT_NOTIFICATION_PREFERENCES,
    };

    this.queryService.addInvitation(invitation);
    log.info('Mock: Created invitation', { invitationId: invitation.id, email: invitation.email });

    return { success: true, invitation };
  }

  async resendInvitation(invitationId: string): Promise<UserOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Resending invitation', { invitationId });

    const existingInvitation = await this.queryService.getInvitationById(invitationId);
    if (!existingInvitation) {
      return {
        success: false,
        error: 'Invitation not found',
        errorDetails: { code: 'NOT_FOUND', message: 'Invitation not found' },
      };
    }

    if (existingInvitation.status !== 'pending') {
      return {
        success: false,
        error: 'Cannot resend a non-pending invitation',
        errorDetails: { code: 'INVITATION_REVOKED', message: 'Invitation is not active' },
      };
    }

    // Revoke old invitation
    this.queryService.updateInvitation(invitationId, {
      status: 'revoked',
      updatedAt: new Date(),
    });

    // Create new invitation with same details
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const newInvitation: Invitation = {
      ...existingInvitation,
      id: generateId(),
      invitationId: generateId(),
      token: generateToken(),
      expiresAt,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    this.queryService.addInvitation(newInvitation);
    log.info('Mock: Resent invitation', {
      oldId: invitationId,
      newId: newInvitation.id,
      email: newInvitation.email,
    });

    return { success: true, invitation: newInvitation };
  }

  async revokeInvitation(invitationId: string): Promise<UserOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Revoking invitation', { invitationId });

    const invitation = await this.queryService.getInvitationById(invitationId);
    if (!invitation) {
      return {
        success: false,
        error: 'Invitation not found',
        errorDetails: { code: 'NOT_FOUND', message: 'Invitation not found' },
      };
    }

    if (invitation.status !== 'pending') {
      return {
        success: false,
        error: 'Cannot revoke a non-pending invitation',
        errorDetails: { code: 'INVITATION_REVOKED', message: 'Invitation is not active' },
      };
    }

    this.queryService.updateInvitation(invitationId, {
      status: 'revoked',
      updatedAt: new Date(),
    });

    log.info('Mock: Revoked invitation', { invitationId, email: invitation.email });
    return { success: true };
  }

  async deactivateUser(userId: string): Promise<UserOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Deactivating user', { userId });

    const result = await this.queryService.getUserById(userId);
    if (!result.user) {
      return {
        success: false,
        error: 'User not found',
        errorDetails: { code: 'NOT_FOUND', message: 'User not found' },
      };
    }

    if (!result.user.isActive) {
      return {
        success: false,
        error: 'User is already deactivated',
        errorDetails: { code: 'ALREADY_INACTIVE', message: 'User is already deactivated' },
      };
    }

    this.queryService.updateUser(userId, {
      isActive: false,
      updatedAt: new Date(),
    });

    log.info('Mock: Deactivated user', { userId, email: result.user.email });
    return { success: true };
  }

  async reactivateUser(userId: string): Promise<UserOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Reactivating user', { userId });

    const result = await this.queryService.getUserById(userId);
    if (!result.user) {
      return {
        success: false,
        error: 'User not found',
        errorDetails: { code: 'NOT_FOUND', message: 'User not found' },
      };
    }

    if (result.user.isActive) {
      return {
        success: false,
        error: 'User is already active',
        errorDetails: { code: 'ALREADY_ACTIVE', message: 'User is already active' },
      };
    }

    this.queryService.updateUser(userId, {
      isActive: true,
      updatedAt: new Date(),
    });

    log.info('Mock: Reactivated user', { userId, email: result.user.email });
    return { success: true };
  }

  async deleteUser(userId: string, reason?: string): Promise<UserOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Deleting user', { userId, reason });

    const result = await this.queryService.getUserById(userId);
    if (!result.user) {
      return {
        success: false,
        error: 'User not found',
        errorDetails: { code: 'NOT_FOUND', message: 'User not found' },
      };
    }

    if (result.user.isActive) {
      return {
        success: false,
        error: 'Cannot delete active user. Deactivate first.',
        errorDetails: { code: 'USER_ACTIVE', message: 'User must be deactivated before deletion' },
      };
    }

    // Soft delete - remove from mock data
    this.queryService.deleteUser(userId);

    log.info('Mock: Deleted user', { userId, email: result.user.email, reason });
    return { success: true };
  }

  async updateUser(request: UpdateUserRequest): Promise<UserOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Updating user', { userId: request.userId });

    const result = await this.queryService.getUserById(request.userId);
    if (!result.user) {
      return {
        success: false,
        error: 'User not found',
        errorDetails: { code: 'NOT_FOUND', message: 'User not found' },
      };
    }

    const updates: Partial<User> = {
      updatedAt: new Date(),
    };

    if (request.firstName !== undefined) {
      updates.firstName = request.firstName.trim();
    }
    if (request.lastName !== undefined) {
      updates.lastName = request.lastName.trim();
    }

    // Update concatenated name if either name part changed
    if (updates.firstName !== undefined || updates.lastName !== undefined) {
      const firstName = updates.firstName ?? result.user.firstName ?? '';
      const lastName = updates.lastName ?? result.user.lastName ?? '';
      updates.name = `${firstName} ${lastName}`.trim() || null;
    }

    this.queryService.updateUser(request.userId, updates);
    log.info('Mock: Updated user', { userId: request.userId });

    return { success: true };
  }

  async modifyRoles(request: ModifyRolesRequest): Promise<UserOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Modifying roles', { userId: request.userId });

    const result = await this.queryService.getUserById(request.userId);
    if (!result.user) {
      return {
        success: false,
        error: 'User not found',
        errorDetails: { code: 'NOT_FOUND', message: 'User not found' },
      };
    }

    // Get current roles
    const currentRoles = this.queryService.getUserRoles(request.userId);
    const currentRoleIds = currentRoles.map((r) => r.id);

    // Remove roles
    let updatedRoles = currentRoles.filter(
      (r) => !request.roleIdsToRemove.includes(r.id)
    );

    // Add roles (with validation)
    for (const roleId of request.roleIdsToAdd) {
      if (currentRoleIds.includes(roleId)) {
        continue; // Already has this role
      }

      const roleToAdd = MOCK_ROLES.find((r) => r.id === roleId);
      if (!roleToAdd) {
        return {
          success: false,
          error: 'Cannot assign unknown role',
          errorDetails: {
            code: 'SUBSET_ONLY_VIOLATION',
            message: `Role ${roleId} not found`,
          },
        };
      }

      updatedRoles.push(roleToAdd);
    }

    // Zero roles is allowed per design decision
    this.queryService.setUserRoles(request.userId, updatedRoles);
    log.info('Mock: Updated user roles', {
      userId: request.userId,
      roleCount: updatedRoles.length,
    });

    return { success: true };
  }

  async addUserToOrganization(
    userId: string,
    roles: Array<{ roleId: string; roleName: string }>
  ): Promise<UserOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Adding user to organization', { userId, roles });

    // Roles are optional - empty array means user has no permissions until assigned
    // Map roles to Role objects
    const roleObjects: Role[] = [];
    for (const roleRef of roles || []) {
      const role = MOCK_ROLES.find((r) => r.id === roleRef.roleId);
      if (!role) {
        return {
          success: false,
          error: 'Cannot assign unknown role',
          errorDetails: {
            code: 'SUBSET_ONLY_VIOLATION',
            message: `Role ${roleRef.roleName} not found`,
          },
        };
      }
      roleObjects.push(role);
    }

    // In mock mode, simulate adding existing user to this org
    this.queryService.setUserRoles(userId, roleObjects);
    log.info('Mock: Added user to organization', { userId, roleCount: roles.length });

    return { success: true };
  }

  async switchOrganization(organizationId: string): Promise<UserOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Switching organization', { organizationId });

    // Simulate org switch - in mock mode, just log and succeed
    log.info('Mock: Switched organization', { organizationId });

    return { success: true };
  }

  async resetPassword(email: string): Promise<UserOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Resetting password', { email });

    const emailError = this.validateEmail(email);
    if (emailError) {
      return {
        success: false,
        error: emailError,
        errorDetails: { code: 'VALIDATION_ERROR', message: emailError },
      };
    }

    // In mock mode, just log and succeed
    log.info('Mock: Password reset email sent (simulated)', { email });

    return { success: true };
  }

  // ============================================================================
  // Extended Data Collection Command Methods (Phase 0A)
  // ============================================================================

  async addUserAddress(request: AddUserAddressRequest): Promise<UserOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Adding user address', { userId: request.userId, label: request.label });

    // Validate required fields
    if (!request.street1?.trim()) {
      return {
        success: false,
        error: 'Street address is required',
        errorDetails: { code: 'VALIDATION_ERROR', message: 'Street address is required' },
      };
    }

    if (!request.city?.trim() || !request.state?.trim() || !request.zipCode?.trim()) {
      return {
        success: false,
        error: 'City, state, and zip code are required',
        errorDetails: { code: 'VALIDATION_ERROR', message: 'Complete address required' },
      };
    }

    const now = new Date();
    const address: UserAddress = {
      id: generateId(),
      userId: request.userId,
      orgId: request.orgId || null,
      label: request.label,
      type: request.type,
      street1: request.street1.trim(),
      street2: request.street2?.trim() || null,
      city: request.city.trim(),
      state: request.state.trim(),
      zipCode: request.zipCode.trim(),
      country: request.country || 'USA',
      isPrimary: request.isPrimary || false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    this.queryService.addAddress(address);
    log.info('Mock: Added user address', { addressId: address.id, userId: request.userId });

    return { success: true };
  }

  async updateUserAddress(request: UpdateUserAddressRequest): Promise<UserOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Updating user address', { addressId: request.addressId });

    const existingAddress = this.queryService.getAddressById(request.addressId);
    if (!existingAddress) {
      return {
        success: false,
        error: 'Address not found',
        errorDetails: { code: 'NOT_FOUND', message: 'Address not found' },
      };
    }

    const { updates } = request;
    const addressUpdates: Partial<UserAddress> = {
      updatedAt: new Date(),
    };

    if (updates.label !== undefined) addressUpdates.label = updates.label;
    if (updates.type !== undefined) addressUpdates.type = updates.type;
    if (updates.street1 !== undefined) addressUpdates.street1 = updates.street1.trim();
    if (updates.street2 !== undefined) addressUpdates.street2 = updates.street2?.trim() || null;
    if (updates.city !== undefined) addressUpdates.city = updates.city.trim();
    if (updates.state !== undefined) addressUpdates.state = updates.state.trim();
    if (updates.zipCode !== undefined) addressUpdates.zipCode = updates.zipCode.trim();
    if (updates.country !== undefined) addressUpdates.country = updates.country;
    if (updates.isPrimary !== undefined) addressUpdates.isPrimary = updates.isPrimary;

    this.queryService.updateAddress(request.addressId, addressUpdates);
    log.info('Mock: Updated user address', { addressId: request.addressId });

    return { success: true };
  }

  async removeUserAddress(request: RemoveUserAddressRequest): Promise<UserOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Removing user address', { addressId: request.addressId });

    const existingAddress = this.queryService.getAddressById(request.addressId);
    if (!existingAddress) {
      return {
        success: false,
        error: 'Address not found',
        errorDetails: { code: 'NOT_FOUND', message: 'Address not found' },
      };
    }

    // Soft delete - set isActive to false
    this.queryService.updateAddress(request.addressId, {
      isActive: false,
      updatedAt: new Date(),
    });

    log.info('Mock: Removed user address', { addressId: request.addressId });
    return { success: true };
  }

  async addUserPhone(request: AddUserPhoneRequest): Promise<UserOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Adding user phone', { userId: request.userId, label: request.label });

    // Validate phone number
    const phoneError = validatePhoneNumber(request.number);
    if (phoneError) {
      return {
        success: false,
        error: phoneError,
        errorDetails: { code: 'VALIDATION_ERROR', message: phoneError },
      };
    }

    const now = new Date();
    const phone: UserPhone = {
      id: generateId(),
      userId: request.userId,
      orgId: request.orgId || null,
      label: request.label,
      type: request.type,
      number: request.number.trim(),
      extension: request.extension?.trim() || null,
      countryCode: request.countryCode || '+1',
      isPrimary: request.isPrimary || false,
      isActive: true,
      smsCapable: request.smsCapable || false,
      createdAt: now,
      updatedAt: now,
    };

    this.queryService.addPhone(phone);
    log.info('Mock: Added user phone', { phoneId: phone.id, userId: request.userId });

    return { success: true };
  }

  async updateUserPhone(request: UpdateUserPhoneRequest): Promise<UserOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Updating user phone', { phoneId: request.phoneId });

    const existingPhone = this.queryService.getPhoneById(request.phoneId);
    if (!existingPhone) {
      return {
        success: false,
        error: 'Phone not found',
        errorDetails: { code: 'NOT_FOUND', message: 'Phone not found' },
      };
    }

    const { updates } = request;

    // Validate phone number if provided
    if (updates.number !== undefined) {
      const phoneError = validatePhoneNumber(updates.number);
      if (phoneError) {
        return {
          success: false,
          error: phoneError,
          errorDetails: { code: 'VALIDATION_ERROR', message: phoneError },
        };
      }
    }

    const phoneUpdates: Partial<UserPhone> = {
      updatedAt: new Date(),
    };

    if (updates.label !== undefined) phoneUpdates.label = updates.label;
    if (updates.type !== undefined) phoneUpdates.type = updates.type;
    if (updates.number !== undefined) phoneUpdates.number = updates.number.trim();
    if (updates.extension !== undefined) phoneUpdates.extension = updates.extension?.trim() || null;
    if (updates.countryCode !== undefined) phoneUpdates.countryCode = updates.countryCode;
    if (updates.isPrimary !== undefined) phoneUpdates.isPrimary = updates.isPrimary;
    if (updates.smsCapable !== undefined) phoneUpdates.smsCapable = updates.smsCapable;

    this.queryService.updatePhone(request.phoneId, phoneUpdates);
    log.info('Mock: Updated user phone', { phoneId: request.phoneId });

    return { success: true };
  }

  async removeUserPhone(request: RemoveUserPhoneRequest): Promise<UserOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Removing user phone', { phoneId: request.phoneId });

    const existingPhone = this.queryService.getPhoneById(request.phoneId);
    if (!existingPhone) {
      return {
        success: false,
        error: 'Phone not found',
        errorDetails: { code: 'NOT_FOUND', message: 'Phone not found' },
      };
    }

    // Soft delete - set isActive to false
    this.queryService.updatePhone(request.phoneId, {
      isActive: false,
      updatedAt: new Date(),
    });

    log.info('Mock: Removed user phone', { phoneId: request.phoneId });
    return { success: true };
  }

  async updateAccessDates(request: UpdateAccessDatesRequest): Promise<UserOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Updating access dates', { userId: request.userId, orgId: request.orgId });

    // Validate access dates
    const dateErrors = validateAccessDates(request.accessStartDate, request.accessExpirationDate);
    if (dateErrors) {
      const errorMessage = Object.values(dateErrors).join('; ');
      return {
        success: false,
        error: errorMessage,
        errorDetails: { code: 'VALIDATION_ERROR', message: errorMessage },
      };
    }

    this.queryService.updateUserOrgAccess(request.userId, request.orgId, {
      accessStartDate: request.accessStartDate || null,
      accessExpirationDate: request.accessExpirationDate || null,
      updatedAt: new Date(),
    });

    log.info('Mock: Updated access dates', {
      userId: request.userId,
      orgId: request.orgId,
      hasStart: !!request.accessStartDate,
      hasExpiration: !!request.accessExpirationDate,
    });

    return { success: true };
  }

  async updateNotificationPreferences(
    request: UpdateNotificationPreferencesRequest
  ): Promise<UserOperationResult> {
    await this.simulateDelay();
    log.debug('Mock: Updating notification preferences', { userId: request.userId, orgId: request.orgId });

    // Validate SMS phone exists if SMS is enabled
    if (request.notificationPreferences.sms.enabled && request.notificationPreferences.sms.phoneId) {
      const phone = this.queryService.getPhoneById(request.notificationPreferences.sms.phoneId);
      if (!phone) {
        return {
          success: false,
          error: 'Selected SMS phone not found',
          errorDetails: { code: 'NOT_FOUND', message: 'SMS phone not found' },
        };
      }
      if (!phone.smsCapable) {
        return {
          success: false,
          error: 'Selected phone is not SMS capable',
          errorDetails: { code: 'VALIDATION_ERROR', message: 'Phone is not SMS capable' },
        };
      }
    }

    this.queryService.updateUserOrgAccess(request.userId, request.orgId, {
      notificationPreferences: request.notificationPreferences,
      updatedAt: new Date(),
    });

    log.info('Mock: Updated notification preferences', {
      userId: request.userId,
      orgId: request.orgId,
      email: request.notificationPreferences.email,
      smsEnabled: request.notificationPreferences.sms.enabled,
      inApp: request.notificationPreferences.inApp,
    });

    return { success: true };
  }
}
