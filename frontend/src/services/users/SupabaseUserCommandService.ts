/**
 * Supabase User Command Service
 *
 * Production implementation of IUserCommandService using Supabase Edge Functions
 * for write operations. All operations emit domain events via the Edge Functions.
 *
 * Architecture:
 * Frontend → Supabase Edge Function → Event Emission → PostgreSQL Triggers → Projections
 *
 * Edge Functions:
 * - invite-user: Create invitation and send email
 * - manage-user: Deactivate/reactivate users
 *
 * @see IUserCommandService for interface documentation
 */

import type { IUserCommandService } from './IUserCommandService';
import type {
  InviteUserRequest,
  UpdateUserRequest,
  AssignRolesRequest,
  UserOperationResult,
  AddUserAddressRequest,
  UpdateUserAddressRequest,
  RemoveUserAddressRequest,
  AddUserPhoneRequest,
  UpdateUserPhoneRequest,
  RemoveUserPhoneRequest,
  UpdateAccessDatesRequest,
  UpdateNotificationPreferencesRequest,
  RoleReference,
} from '@/types/user.types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/types/user.types';
import { supabaseService } from '@/services/auth/supabase.service';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

/**
 * Edge Function endpoints
 */
const EDGE_FUNCTIONS = {
  INVITE_USER: 'invite-user',
  MANAGE_USER: 'manage-user',
} as const;

/**
 * Supabase User Command Service Implementation
 */
export class SupabaseUserCommandService implements IUserCommandService {
  /**
   * Invite a new user to the organization
   *
   * Calls the invite-user Edge Function which:
   * 1. Validates permissions (user.create)
   * 2. Checks email status (smart lookup)
   * 3. Creates invitation token
   * 4. Emits user.invited event
   * 5. Sends invitation email via Resend
   */
  async inviteUser(request: InviteUserRequest): Promise<UserOperationResult> {
    try {
      log.info('Inviting user', { email: request.email });

      const client = supabaseService.getClient();
      const { data, error } = await client.functions.invoke(
        EDGE_FUNCTIONS.INVITE_USER,
        {
          body: {
            operation: 'invite',
            email: request.email,
            firstName: request.firstName,
            lastName: request.lastName,
            roles: request.roles,
            accessStartDate: request.accessStartDate,
            accessExpirationDate: request.accessExpirationDate,
            notificationPreferences: request.notificationPreferences,
          },
        }
      );

      if (error) {
        log.error('Failed to invite user', error);
        return {
          success: false,
          error: `Failed to invite user: ${error.message}`,
          errorDetails: {
            code: 'UNKNOWN',
            message: error.message,
          },
        };
      }

      if (!data?.success) {
        return {
          success: false,
          error: data?.error ?? 'Unknown error',
          errorDetails: data?.errorDetails,
        };
      }

      log.info('User invited successfully', { invitationId: data.invitationId });

      return {
        success: true,
        invitation: {
          id: data.invitationId,
          invitationId: data.invitationId,
          email: request.email,
          firstName: request.firstName,
          lastName: request.lastName,
          organizationId: data.orgId,
          roles: request.roles as RoleReference[],
          token: data.token ?? '',
          status: 'pending',
          expiresAt: new Date(data.expiresAt),
          accessStartDate: request.accessStartDate ?? null,
          accessExpirationDate: request.accessExpirationDate ?? null,
          notificationPreferences:
            request.notificationPreferences ?? DEFAULT_NOTIFICATION_PREFERENCES,
          acceptedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };
    } catch (error) {
      log.error('Error in inviteUser', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorDetails: {
          code: 'UNKNOWN',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Resend an existing invitation
   *
   * Calls the invite-user Edge Function with resend operation
   */
  async resendInvitation(invitationId: string): Promise<UserOperationResult> {
    try {
      log.info('Resending invitation', { invitationId });

      const client = supabaseService.getClient();
      const { data, error } = await client.functions.invoke(
        EDGE_FUNCTIONS.INVITE_USER,
        {
          body: {
            operation: 'resend',
            invitationId,
          },
        }
      );

      if (error) {
        log.error('Failed to resend invitation', error);
        return {
          success: false,
          error: `Failed to resend invitation: ${error.message}`,
        };
      }

      if (!data?.success) {
        return {
          success: false,
          error: data?.error ?? 'Failed to resend invitation',
        };
      }

      log.info('Invitation resent successfully', { invitationId });
      return { success: true };
    } catch (error) {
      log.error('Error in resendInvitation', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Revoke a pending invitation
   *
   * Calls the invite-user Edge Function with revoke operation
   */
  async revokeInvitation(invitationId: string): Promise<UserOperationResult> {
    try {
      log.info('Revoking invitation', { invitationId });

      const client = supabaseService.getClient();
      const { data, error } = await client.functions.invoke(
        EDGE_FUNCTIONS.INVITE_USER,
        {
          body: {
            operation: 'revoke',
            invitationId,
          },
        }
      );

      if (error) {
        log.error('Failed to revoke invitation', error);
        return {
          success: false,
          error: `Failed to revoke invitation: ${error.message}`,
        };
      }

      if (!data?.success) {
        return {
          success: false,
          error: data?.error ?? 'Failed to revoke invitation',
        };
      }

      log.info('Invitation revoked successfully', { invitationId });
      return { success: true };
    } catch (error) {
      log.error('Error in revokeInvitation', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Deactivate a user account
   *
   * Calls the manage-user Edge Function which:
   * 1. Validates permissions (user.update)
   * 2. Checks user exists in org
   * 3. Emits user.deactivated event
   */
  async deactivateUser(userId: string): Promise<UserOperationResult> {
    try {
      log.info('Deactivating user', { userId });

      const client = supabaseService.getClient();
      const { data, error } = await client.functions.invoke(
        EDGE_FUNCTIONS.MANAGE_USER,
        {
          body: {
            operation: 'deactivate',
            userId,
          },
        }
      );

      if (error) {
        log.error('Failed to deactivate user', error);
        return {
          success: false,
          error: `Failed to deactivate user: ${error.message}`,
        };
      }

      if (!data?.success) {
        return {
          success: false,
          error: data?.error ?? 'Failed to deactivate user',
          errorDetails: {
            code: data?.error?.includes('already')
              ? 'ALREADY_INACTIVE'
              : 'UNKNOWN',
            message: data?.error ?? 'Unknown error',
          },
        };
      }

      log.info('User deactivated successfully', { userId });
      return { success: true };
    } catch (error) {
      log.error('Error in deactivateUser', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Reactivate a deactivated user account
   *
   * Calls the manage-user Edge Function which:
   * 1. Validates permissions (user.update)
   * 2. Checks user exists in org
   * 3. Emits user.reactivated event
   */
  async reactivateUser(userId: string): Promise<UserOperationResult> {
    try {
      log.info('Reactivating user', { userId });

      const client = supabaseService.getClient();
      const { data, error } = await client.functions.invoke(
        EDGE_FUNCTIONS.MANAGE_USER,
        {
          body: {
            operation: 'reactivate',
            userId,
          },
        }
      );

      if (error) {
        log.error('Failed to reactivate user', error);
        return {
          success: false,
          error: `Failed to reactivate user: ${error.message}`,
        };
      }

      if (!data?.success) {
        return {
          success: false,
          error: data?.error ?? 'Failed to reactivate user',
          errorDetails: {
            code: data?.error?.includes('already')
              ? 'ALREADY_ACTIVE'
              : 'UNKNOWN',
            message: data?.error ?? 'Unknown error',
          },
        };
      }

      log.info('User reactivated successfully', { userId });
      return { success: true };
    } catch (error) {
      log.error('Error in reactivateUser', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Update user profile
   *
   * TODO: Implement via RPC function when available
   */
  async updateUser(request: UpdateUserRequest): Promise<UserOperationResult> {
    log.warn('updateUser not yet implemented for Supabase');
    return {
      success: false,
      error: 'updateUser not yet implemented',
      errorDetails: {
        code: 'UNKNOWN',
        message: 'This feature is not yet available',
      },
    };
  }

  /**
   * Assign or revoke roles for a user
   *
   * TODO: Implement via RPC function when available
   */
  async assignRoles(request: AssignRolesRequest): Promise<UserOperationResult> {
    log.warn('assignRoles not yet implemented for Supabase');
    return {
      success: false,
      error: 'assignRoles not yet implemented',
      errorDetails: {
        code: 'UNKNOWN',
        message: 'This feature is not yet available',
      },
    };
  }

  /**
   * Add existing user to organization
   *
   * TODO: Implement via Edge Function or RPC when available
   */
  async addUserToOrganization(
    userId: string,
    roles: Array<{ roleId: string; roleName: string }>
  ): Promise<UserOperationResult> {
    log.warn('addUserToOrganization not yet implemented for Supabase');
    return {
      success: false,
      error: 'addUserToOrganization not yet implemented',
      errorDetails: {
        code: 'UNKNOWN',
        message: 'This feature is not yet available',
      },
    };
  }

  /**
   * Switch user's active organization
   *
   * TODO: Implement org context switching
   */
  async switchOrganization(
    organizationId: string
  ): Promise<UserOperationResult> {
    log.warn('switchOrganization not yet implemented for Supabase');
    return {
      success: false,
      error: 'switchOrganization not yet implemented',
      errorDetails: {
        code: 'UNKNOWN',
        message: 'This feature is not yet available',
      },
    };
  }

  /**
   * Reset user password
   *
   * Uses Supabase Auth's built-in password reset
   */
  async resetPassword(email: string): Promise<UserOperationResult> {
    try {
      log.info('Sending password reset', { email });

      const client = supabaseService.getClient();
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });

      if (error) {
        log.error('Failed to send password reset', error);
        return {
          success: false,
          error: `Failed to send password reset: ${error.message}`,
        };
      }

      log.info('Password reset email sent', { email });
      return { success: true };
    } catch (error) {
      log.error('Error in resetPassword', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ============================================================================
  // Extended Data Collection Methods - Placeholder Implementations
  // ============================================================================

  async addUserAddress(
    request: AddUserAddressRequest
  ): Promise<UserOperationResult> {
    log.warn('addUserAddress not yet implemented for Supabase');
    return {
      success: false,
      error: 'addUserAddress not yet implemented',
      errorDetails: { code: 'UNKNOWN', message: 'Coming soon' },
    };
  }

  async updateUserAddress(
    request: UpdateUserAddressRequest
  ): Promise<UserOperationResult> {
    log.warn('updateUserAddress not yet implemented for Supabase');
    return {
      success: false,
      error: 'updateUserAddress not yet implemented',
      errorDetails: { code: 'UNKNOWN', message: 'Coming soon' },
    };
  }

  async removeUserAddress(
    request: RemoveUserAddressRequest
  ): Promise<UserOperationResult> {
    log.warn('removeUserAddress not yet implemented for Supabase');
    return {
      success: false,
      error: 'removeUserAddress not yet implemented',
      errorDetails: { code: 'UNKNOWN', message: 'Coming soon' },
    };
  }

  async addUserPhone(
    request: AddUserPhoneRequest
  ): Promise<UserOperationResult> {
    log.warn('addUserPhone not yet implemented for Supabase');
    return {
      success: false,
      error: 'addUserPhone not yet implemented',
      errorDetails: { code: 'UNKNOWN', message: 'Coming soon' },
    };
  }

  async updateUserPhone(
    request: UpdateUserPhoneRequest
  ): Promise<UserOperationResult> {
    log.warn('updateUserPhone not yet implemented for Supabase');
    return {
      success: false,
      error: 'updateUserPhone not yet implemented',
      errorDetails: { code: 'UNKNOWN', message: 'Coming soon' },
    };
  }

  async removeUserPhone(
    request: RemoveUserPhoneRequest
  ): Promise<UserOperationResult> {
    log.warn('removeUserPhone not yet implemented for Supabase');
    return {
      success: false,
      error: 'removeUserPhone not yet implemented',
      errorDetails: { code: 'UNKNOWN', message: 'Coming soon' },
    };
  }

  /**
   * Update user's access dates for the organization
   *
   * Uses api.update_user_access_dates RPC which emits a domain event
   * and updates the user_organizations_projection.
   */
  async updateAccessDates(
    request: UpdateAccessDatesRequest
  ): Promise<UserOperationResult> {
    try {
      log.info('Updating user access dates', {
        userId: request.userId,
        orgId: request.orgId,
      });

      const client = supabaseService.getClient();

      // Use RPC function to update access dates (emits domain event)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (client as any).schema('api').rpc(
        'update_user_access_dates',
        {
          p_user_id: request.userId,
          p_org_id: request.orgId,
          p_access_start_date: request.accessStartDate ?? null,
          p_access_expiration_date: request.accessExpirationDate ?? null,
        }
      );

      if (error) {
        log.error('Failed to update access dates via RPC', error);

        // Handle specific error codes
        if (error.code === '42501') {
          return {
            success: false,
            error: 'Access denied - insufficient permissions',
            errorDetails: { code: 'FORBIDDEN', message: error.message },
          };
        }
        if (error.code === 'P0002') {
          return {
            success: false,
            error: 'User organization access record not found',
            errorDetails: { code: 'NOT_FOUND', message: error.message },
          };
        }
        if (error.code === '22023') {
          return {
            success: false,
            error: 'Start date must be before expiration date',
            errorDetails: { code: 'INVALID_DATES', message: error.message },
          };
        }

        return {
          success: false,
          error: `Failed to update access dates: ${error.message}`,
          errorDetails: { code: 'UNKNOWN', message: error.message },
        };
      }

      log.info('Access dates updated successfully', {
        userId: request.userId,
        orgId: request.orgId,
      });

      return { success: true };
    } catch (error) {
      log.error('Error in updateAccessDates', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorDetails: {
          code: 'UNKNOWN',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Update user's notification preferences for the organization
   *
   * Uses api.update_user_notification_preferences RPC to update
   * the user_organizations_projection directly.
   */
  async updateNotificationPreferences(
    request: UpdateNotificationPreferencesRequest
  ): Promise<UserOperationResult> {
    try {
      log.info('Updating user notification preferences', {
        userId: request.userId,
        orgId: request.orgId,
      });

      const client = supabaseService.getClient();

      // Use RPC function to update notification preferences
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (client as any).schema('api').rpc(
        'update_user_notification_preferences',
        {
          p_user_id: request.userId,
          p_org_id: request.orgId,
          p_notification_preferences: request.notificationPreferences,
        }
      );

      if (error) {
        log.error('Failed to update notification preferences via RPC', error);

        // Handle specific error codes
        if (error.code === '42501') {
          return {
            success: false,
            error: 'Access denied - insufficient permissions',
            errorDetails: { code: 'FORBIDDEN', message: error.message },
          };
        }
        if (error.code === 'P0002') {
          return {
            success: false,
            error: 'User organization access record not found',
            errorDetails: { code: 'NOT_FOUND', message: error.message },
          };
        }

        return {
          success: false,
          error: `Failed to update notification preferences: ${error.message}`,
          errorDetails: { code: 'UNKNOWN', message: error.message },
        };
      }

      log.info('Notification preferences updated successfully', {
        userId: request.userId,
        orgId: request.orgId,
      });

      return { success: true };
    } catch (error) {
      log.error('Error in updateNotificationPreferences', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorDetails: {
          code: 'UNKNOWN',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
}
