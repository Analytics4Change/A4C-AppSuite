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

import {
  FunctionsHttpError,
  FunctionsRelayError,
  FunctionsFetchError,
} from '@supabase/supabase-js';
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
  UserOperationErrorCode,
} from '@/types/user.types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/types/user.types';
import { supabaseService } from '@/services/auth/supabase.service';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

/**
 * Edge Function error extraction result
 */
interface EdgeFunctionErrorResult {
  message: string;
  code: UserOperationErrorCode;
  details?: string;
  /** Full errorDetails object from Edge Function response (for role validation errors, etc.) */
  errorDetails?: Record<string, unknown>;
}

/**
 * Extract detailed error from Supabase Edge Function error response.
 *
 * When Edge Functions return non-2xx status codes, the Supabase SDK wraps
 * the response in a FunctionsHttpError. The actual error message from the
 * Edge Function is accessible via `error.context.json()`.
 *
 * @param error - The error from functions.invoke()
 * @param operation - Human-readable operation name for fallback messages
 * @returns Object with error message, code, details, and full errorDetails object
 */
async function extractEdgeFunctionError(
  error: unknown,
  operation: string
): Promise<EdgeFunctionErrorResult> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      log.error(`Edge Function HTTP error for ${operation}`, {
        status: error.context.status,
        body,
      });
      return {
        message: body?.error ?? `${operation} failed`,
        // Extract code from errorDetails if present, otherwise from top-level
        code: (body?.errorDetails?.code as UserOperationErrorCode)
          ?? (body?.code as UserOperationErrorCode)
          ?? 'HTTP_ERROR',
        details: body?.details,
        // Pass through the full errorDetails object for rich error information
        errorDetails: body?.errorDetails,
      };
    } catch {
      // Response body wasn't JSON - use status code
      log.error(`Edge Function error (non-JSON response) for ${operation}`, {
        status: error.context.status,
      });
      return {
        message: `${operation} failed (HTTP ${error.context.status})`,
        code: 'HTTP_ERROR',
      };
    }
  }

  if (error instanceof FunctionsRelayError) {
    log.error(`Edge Function relay error for ${operation}`, error);
    return {
      message: `Network error: ${error.message}`,
      code: 'RELAY_ERROR',
    };
  }

  if (error instanceof FunctionsFetchError) {
    log.error(`Edge Function fetch error for ${operation}`, error);
    return {
      message: `Connection error: ${error.message}`,
      code: 'FETCH_ERROR',
    };
  }

  // Unknown error type
  const msg = error instanceof Error ? error.message : 'Unknown error';
  log.error(`Unknown error type for ${operation}`, error);
  return {
    message: `${operation} failed: ${msg}`,
    code: 'UNKNOWN',
  };
}

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
        const errorInfo = await extractEdgeFunctionError(error, 'Invite user');
        return {
          success: false,
          error: errorInfo.message,
          errorDetails: {
            code: errorInfo.code,
            message: errorInfo.message,
            // Pass through full errorDetails from Edge Function for rich error display
            context: errorInfo.errorDetails ?? (errorInfo.details ? { details: errorInfo.details } : undefined),
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
        const errorInfo = await extractEdgeFunctionError(error, 'Resend invitation');
        return {
          success: false,
          error: errorInfo.message,
          errorDetails: {
            code: errorInfo.code,
            message: errorInfo.message,
            context: errorInfo.details ? { details: errorInfo.details } : undefined,
          },
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
        const errorInfo = await extractEdgeFunctionError(error, 'Revoke invitation');
        return {
          success: false,
          error: errorInfo.message,
          errorDetails: {
            code: errorInfo.code,
            message: errorInfo.message,
            context: errorInfo.details ? { details: errorInfo.details } : undefined,
          },
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
        const errorInfo = await extractEdgeFunctionError(error, 'Deactivate user');
        return {
          success: false,
          error: errorInfo.message,
          errorDetails: {
            code: errorInfo.code,
            message: errorInfo.message,
            context: errorInfo.details ? { details: errorInfo.details } : undefined,
          },
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
        const errorInfo = await extractEdgeFunctionError(error, 'Reactivate user');
        return {
          success: false,
          error: errorInfo.message,
          errorDetails: {
            code: errorInfo.code,
            message: errorInfo.message,
            context: errorInfo.details ? { details: errorInfo.details } : undefined,
          },
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

      // Use RPC function to update access dates (emits domain event)
      const { error } = await supabaseService.apiRpc<void>(
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

      // Use RPC function to update notification preferences
      const { error } = await supabaseService.apiRpc<void>(
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
