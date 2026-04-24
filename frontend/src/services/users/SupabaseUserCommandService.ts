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
  ModifyRolesRequest,
  InviteUserResult,
  UpdateUserResult,
  UserPhoneResult,
  UpdateNotificationPreferencesResult,
  UserVoidResult,
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
  PhoneType,
  NotificationPreferences,
} from '@/types/user.types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/types/user.types';
import { supabaseService } from '@/services/auth/supabase.service';
import { Logger } from '@/utils/logger';
import { buildHeadersFromContext, createTracingContext } from '@/utils/tracing';
import { decodeJWT } from '@/utils/jwt';
import { extractEdgeFunctionError } from '@/utils/edge-function-errors';

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
  async inviteUser(request: InviteUserRequest): Promise<InviteUserResult> {
    // Set up tracing context for this operation
    const tracingContext = await createTracingContext();
    Logger.pushTracingContext(tracingContext);

    try {
      log.info('Inviting user', { email: request.email });

      const client = supabaseService.getClient();
      const headers = buildHeadersFromContext(tracingContext);
      const { data, error } = await client.functions.invoke(EDGE_FUNCTIONS.INVITE_USER, {
        body: {
          operation: 'invite',
          email: request.email,
          firstName: request.firstName,
          lastName: request.lastName,
          // Transform camelCase to snake_case for Edge Function contract
          roles: request.roles?.map((r) => ({
            role_id: r.roleId,
            role_name: r.roleName,
            org_hierarchy_scope: r.orgHierarchyScope,
          })),
          accessStartDate: request.accessStartDate,
          accessExpirationDate: request.accessExpirationDate,
          notificationPreferences: request.notificationPreferences,
          // Phase 6: Include phones if provided
          phones: request.phones,
        },
        headers,
      });

      if (error) {
        const errorInfo = await extractEdgeFunctionError(error, 'Invite user');
        const errorMessage = errorInfo.correlationId
          ? `${errorInfo.message} (Ref: ${errorInfo.correlationId})`
          : errorInfo.message;
        return {
          success: false,
          error: errorMessage,
          errorDetails: {
            code: (errorInfo.code ?? 'UNKNOWN') as UserOperationErrorCode,
            message: errorInfo.message,
            // Pass through full errorDetails from Edge Function for rich error display
            context:
              errorInfo.errorDetails ??
              (errorInfo.details ? { details: errorInfo.details } : undefined),
            correlationId: errorInfo.correlationId,
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
    } finally {
      Logger.popTracingContext();
    }
  }

  /**
   * Resend an existing invitation
   *
   * Calls the invite-user Edge Function with resend operation
   */
  async resendInvitation(invitationId: string): Promise<UserVoidResult> {
    // Set up tracing context for this operation
    const tracingContext = await createTracingContext();
    Logger.pushTracingContext(tracingContext);

    try {
      log.info('Resending invitation', { invitationId });

      const client = supabaseService.getClient();
      const headers = buildHeadersFromContext(tracingContext);
      const { data, error } = await client.functions.invoke(EDGE_FUNCTIONS.INVITE_USER, {
        body: {
          operation: 'resend',
          invitationId,
        },
        headers,
      });

      if (error) {
        const errorInfo = await extractEdgeFunctionError(error, 'Resend invitation');
        const errorMessage = errorInfo.correlationId
          ? `${errorInfo.message} (Ref: ${errorInfo.correlationId})`
          : errorInfo.message;
        return {
          success: false,
          error: errorMessage,
          errorDetails: {
            code: (errorInfo.code ?? 'UNKNOWN') as UserOperationErrorCode,
            message: errorInfo.message,
            context: errorInfo.details ? { details: errorInfo.details } : undefined,
            correlationId: errorInfo.correlationId,
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
    } finally {
      Logger.popTracingContext();
    }
  }

  /**
   * Revoke a pending invitation
   *
   * Calls the invite-user Edge Function with revoke operation
   */
  async revokeInvitation(invitationId: string): Promise<UserVoidResult> {
    // Set up tracing context for this operation
    const tracingContext = await createTracingContext();
    Logger.pushTracingContext(tracingContext);

    try {
      log.info('Revoking invitation', { invitationId });

      const client = supabaseService.getClient();
      const headers = buildHeadersFromContext(tracingContext);
      const { data, error } = await client.functions.invoke(EDGE_FUNCTIONS.INVITE_USER, {
        body: {
          operation: 'revoke',
          invitationId,
        },
        headers,
      });

      if (error) {
        const errorInfo = await extractEdgeFunctionError(error, 'Revoke invitation');
        const errorMessage = errorInfo.correlationId
          ? `${errorInfo.message} (Ref: ${errorInfo.correlationId})`
          : errorInfo.message;
        return {
          success: false,
          error: errorMessage,
          errorDetails: {
            code: (errorInfo.code ?? 'UNKNOWN') as UserOperationErrorCode,
            message: errorInfo.message,
            context: errorInfo.details ? { details: errorInfo.details } : undefined,
            correlationId: errorInfo.correlationId,
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
    } finally {
      Logger.popTracingContext();
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
  async deactivateUser(userId: string): Promise<UserVoidResult> {
    // Set up tracing context for this operation
    const tracingContext = await createTracingContext();
    Logger.pushTracingContext(tracingContext);

    try {
      log.info('Deactivating user', { userId });

      const client = supabaseService.getClient();
      const headers = buildHeadersFromContext(tracingContext);
      const { data, error } = await client.functions.invoke(EDGE_FUNCTIONS.MANAGE_USER, {
        body: {
          operation: 'deactivate',
          userId,
        },
        headers,
      });

      if (error) {
        const errorInfo = await extractEdgeFunctionError(error, 'Deactivate user');
        const errorMessage = errorInfo.correlationId
          ? `${errorInfo.message} (Ref: ${errorInfo.correlationId})`
          : errorInfo.message;
        return {
          success: false,
          error: errorMessage,
          errorDetails: {
            code: (errorInfo.code ?? 'UNKNOWN') as UserOperationErrorCode,
            message: errorInfo.message,
            context: errorInfo.details ? { details: errorInfo.details } : undefined,
            correlationId: errorInfo.correlationId,
          },
        };
      }

      if (!data?.success) {
        return {
          success: false,
          error: data?.error ?? 'Failed to deactivate user',
          errorDetails: {
            code: data?.error?.includes('already') ? 'ALREADY_INACTIVE' : 'UNKNOWN',
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
    } finally {
      Logger.popTracingContext();
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
  async reactivateUser(userId: string): Promise<UserVoidResult> {
    // Set up tracing context for this operation
    const tracingContext = await createTracingContext();
    Logger.pushTracingContext(tracingContext);

    try {
      log.info('Reactivating user', { userId });

      const client = supabaseService.getClient();
      const headers = buildHeadersFromContext(tracingContext);
      const { data, error } = await client.functions.invoke(EDGE_FUNCTIONS.MANAGE_USER, {
        body: {
          operation: 'reactivate',
          userId,
        },
        headers,
      });

      if (error) {
        const errorInfo = await extractEdgeFunctionError(error, 'Reactivate user');
        const errorMessage = errorInfo.correlationId
          ? `${errorInfo.message} (Ref: ${errorInfo.correlationId})`
          : errorInfo.message;
        return {
          success: false,
          error: errorMessage,
          errorDetails: {
            code: (errorInfo.code ?? 'UNKNOWN') as UserOperationErrorCode,
            message: errorInfo.message,
            context: errorInfo.details ? { details: errorInfo.details } : undefined,
            correlationId: errorInfo.correlationId,
          },
        };
      }

      if (!data?.success) {
        return {
          success: false,
          error: data?.error ?? 'Failed to reactivate user',
          errorDetails: {
            code: data?.error?.includes('already') ? 'ALREADY_ACTIVE' : 'UNKNOWN',
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
    } finally {
      Logger.popTracingContext();
    }
  }

  /**
   * Permanently delete a deactivated user from the organization
   *
   * Calls the manage-user Edge Function which:
   * 1. Validates permissions (user.delete)
   * 2. Checks user is deactivated
   * 3. Emits user.deleted event
   */
  async deleteUser(userId: string, reason?: string): Promise<UserVoidResult> {
    // Set up tracing context for this operation
    const tracingContext = await createTracingContext();
    Logger.pushTracingContext(tracingContext);

    try {
      log.info('Deleting user', { userId, reason });

      const client = supabaseService.getClient();
      const headers = buildHeadersFromContext(tracingContext);
      const { data, error } = await client.functions.invoke(EDGE_FUNCTIONS.MANAGE_USER, {
        body: {
          operation: 'delete',
          userId,
          reason,
        },
        headers,
      });

      if (error) {
        const errorInfo = await extractEdgeFunctionError(error, 'Delete user');
        const errorMessage = errorInfo.correlationId
          ? `${errorInfo.message} (Ref: ${errorInfo.correlationId})`
          : errorInfo.message;
        return {
          success: false,
          error: errorMessage,
          errorDetails: {
            code: (errorInfo.code ?? 'UNKNOWN') as UserOperationErrorCode,
            message: errorInfo.message,
            context: errorInfo.details ? { details: errorInfo.details } : undefined,
            correlationId: errorInfo.correlationId,
          },
        };
      }

      if (!data?.success) {
        return {
          success: false,
          error: data?.error ?? 'Failed to delete user',
          errorDetails: {
            code: data?.error?.includes('active') ? 'USER_ACTIVE' : 'UNKNOWN',
            message: data?.error ?? 'Unknown error',
          },
        };
      }

      log.info('User deleted successfully', { userId });
      return { success: true };
    } catch (error) {
      log.error('Error in deleteUser', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      Logger.popTracingContext();
    }
  }

  /**
   * Update user profile (first_name, last_name)
   *
   * Calls api.update_user() RPC which:
   * 1. Validates user belongs to org
   * 2. Emits user.profile.updated event
   * 3. Event processor updates users table
   */
  async updateUser(request: UpdateUserRequest): Promise<UpdateUserResult> {
    try {
      log.info('Updating user profile', { userId: request.userId });

      const client = supabaseService.getClient();

      // Get session directly from Supabase - it manages auth state automatically
      const {
        data: { session },
      } = await client.auth.getSession();
      if (!session) {
        log.error('No authenticated session for updateUser');
        return {
          success: false,
          error: 'Not authenticated',
          errorDetails: { code: 'AUTH_ERROR', message: 'No active session' },
        };
      }

      // Decode JWT to extract custom claims (org_id)
      const claims = decodeJWT(session.access_token);
      if (!claims.org_id) {
        log.error('No organization context in JWT claims');
        return {
          success: false,
          error: 'No organization context',
          errorDetails: { code: 'AUTH_ERROR', message: 'Missing org_id in JWT' },
        };
      }

      // Pattern A v2: api.update_user already returns the refreshed user
      // row (snake_case via row_to_json(v_row)::jsonb). Map to camelCase
      // `User` so VMs can patch in place. Baseline_v4 handler path:
      //   emit user.profile.updated → handle_user_profile_updated
      //   → UPDATE public.users → read-back here.
      const { data, error } = await supabaseService.apiRpc<{
        success: boolean;
        error?: string;
        event_id?: string;
        user?: {
          id: string;
          email: string;
          first_name: string | null;
          last_name: string | null;
          name: string | null;
          current_organization_id: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          last_login_at: string | null;
        };
      }>('update_user', {
        p_user_id: request.userId,
        p_org_id: claims.org_id,
        p_first_name: request.firstName ?? null,
        p_last_name: request.lastName ?? null,
      });

      if (error) {
        log.error('RPC error updating user', { error });
        return {
          success: false,
          error: error.message,
          errorDetails: { code: 'RPC_ERROR', message: error.message },
        };
      }

      // RPC returns {success, error?, event_id?, user?}
      if (!data?.success) {
        log.warn('User update failed', { error: data?.error });
        return {
          success: false,
          error: data?.error || 'Update failed',
          errorDetails: {
            code: 'UPDATE_FAILED',
            message: data?.error || 'Unknown error',
          },
        };
      }

      log.info('User profile updated successfully', {
        userId: request.userId,
        eventId: data.event_id,
      });

      // Map snake_case row → camelCase User
      const user = data.user
        ? {
            id: data.user.id,
            email: data.user.email,
            firstName: data.user.first_name,
            lastName: data.user.last_name,
            name: data.user.name,
            currentOrganizationId: data.user.current_organization_id,
            isActive: data.user.is_active,
            createdAt: new Date(data.user.created_at),
            updatedAt: new Date(data.user.updated_at),
            lastLoginAt: data.user.last_login_at ? new Date(data.user.last_login_at) : null,
          }
        : undefined;

      return { success: true, user };
    } catch (err) {
      log.error('Error updating user profile', err);
      const message = err instanceof Error ? err.message : 'Failed to update user';
      return {
        success: false,
        error: message,
        errorDetails: { code: 'UNKNOWN', message },
      };
    }
  }

  /**
   * Modify roles for a user (add and/or remove)
   *
   * Calls manage-user Edge Function with modify_roles operation.
   * Emits user.role.assigned for each added role and user.role.revoked for each removed role.
   */
  async modifyRoles(request: ModifyRolesRequest): Promise<UserVoidResult> {
    const client = supabaseService.getClient();
    const tracingContext = await createTracingContext();
    const headers = buildHeadersFromContext(tracingContext);

    log.debug('Modifying user roles', {
      userId: request.userId,
      toAdd: request.roleIdsToAdd.length,
      toRemove: request.roleIdsToRemove.length,
    });

    try {
      const { data, error } = await client.functions.invoke(EDGE_FUNCTIONS.MANAGE_USER, {
        body: {
          operation: 'modify_roles',
          userId: request.userId,
          roleIdsToAdd: request.roleIdsToAdd,
          roleIdsToRemove: request.roleIdsToRemove,
        },
        headers,
      });

      if (error) {
        const errorInfo = await extractEdgeFunctionError(error, 'Modify roles');
        const errorMessage = errorInfo.correlationId
          ? `${errorInfo.message} (Ref: ${errorInfo.correlationId})`
          : errorInfo.message;
        return {
          success: false,
          error: errorMessage,
          errorDetails: {
            code: (errorInfo.code ?? 'UNKNOWN') as UserOperationErrorCode,
            message: errorInfo.message,
            context:
              errorInfo.errorDetails ??
              (errorInfo.details ? { details: errorInfo.details } : undefined),
            correlationId: errorInfo.correlationId,
          },
        };
      }

      if (!data?.success) {
        return {
          success: false,
          error: data?.error ?? 'Failed to modify roles',
          errorDetails: {
            code: (data?.errorDetails?.code as UserOperationErrorCode) ?? 'UNKNOWN',
            message: data?.error ?? 'Unknown error',
            context: data?.errorDetails,
          },
        };
      }

      log.info('User roles modified successfully', {
        userId: request.userId,
        rolesAdded: request.roleIdsToAdd.length,
        rolesRemoved: request.roleIdsToRemove.length,
      });

      return { success: true };
    } catch (err) {
      log.error('Unexpected error modifying user roles', { error: err });
      return {
        success: false,
        error: 'An unexpected error occurred while modifying roles',
        errorDetails: {
          code: 'UNKNOWN' as UserOperationErrorCode,
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Add existing user to organization
   *
   * TODO: Implement via Edge Function or RPC when available
   */
  async addUserToOrganization(
    _userId: string,
    _roles: Array<{ roleId: string; roleName: string }>
  ): Promise<UserVoidResult> {
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
  async switchOrganization(_organizationId: string): Promise<UserVoidResult> {
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
  async resetPassword(email: string): Promise<UserVoidResult> {
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

  async addUserAddress(_request: AddUserAddressRequest): Promise<UserVoidResult> {
    log.warn('addUserAddress not yet implemented for Supabase');
    return {
      success: false,
      error: 'addUserAddress not yet implemented',
      errorDetails: { code: 'UNKNOWN', message: 'Coming soon' },
    };
  }

  async updateUserAddress(_request: UpdateUserAddressRequest): Promise<UserVoidResult> {
    log.warn('updateUserAddress not yet implemented for Supabase');
    return {
      success: false,
      error: 'updateUserAddress not yet implemented',
      errorDetails: { code: 'UNKNOWN', message: 'Coming soon' },
    };
  }

  async removeUserAddress(_request: RemoveUserAddressRequest): Promise<UserVoidResult> {
    log.warn('removeUserAddress not yet implemented for Supabase');
    return {
      success: false,
      error: 'removeUserAddress not yet implemented',
      errorDetails: { code: 'UNKNOWN', message: 'Coming soon' },
    };
  }

  /**
   * Add a phone number for a user
   *
   * Calls api.add_user_phone RPC which emits user.phone.added event.
   * If orgId is null, creates a global phone. If set, creates org-specific phone.
   */
  async addUserPhone(request: AddUserPhoneRequest): Promise<UserPhoneResult> {
    try {
      log.info('Adding user phone', {
        userId: request.userId,
        label: request.label,
        orgId: request.orgId,
      });

      // Pattern A v2 (migration 20260423232531): api.add_user_phone returns
      // the full phone entity in camelCase (jsonb_build_object with explicit
      // keys) so no adapter step is needed.
      const { data, error } = await supabaseService.apiRpc<{
        success: boolean;
        phoneId: string;
        eventId: string;
        phone?: {
          id: string;
          userId: string;
          orgId: string | null;
          label: string;
          type: PhoneType;
          number: string;
          extension: string | null;
          countryCode: string;
          isPrimary: boolean;
          smsCapable: boolean;
          isActive: boolean;
          createdAt: string;
          updatedAt: string;
        };
        error?: string;
      }>('add_user_phone', {
        p_user_id: request.userId,
        p_label: request.label,
        p_type: request.type,
        p_number: request.number,
        p_extension: request.extension ?? null,
        p_country_code: request.countryCode ?? '+1',
        p_is_primary: request.isPrimary ?? false,
        p_sms_capable: request.smsCapable ?? false,
        p_org_id: request.orgId ?? null,
        p_reason: request.reason ?? null,
      });

      if (error) {
        log.error('Failed to add user phone via RPC', error);

        if (error.code === '42501') {
          return {
            success: false,
            error: 'Access denied - insufficient permissions',
            errorDetails: { code: 'FORBIDDEN', message: error.message },
          };
        }

        return {
          success: false,
          error: `Failed to add phone: ${error.message}`,
          errorDetails: { code: 'UNKNOWN', message: error.message },
        };
      }

      // Pattern A v2 read-back failure envelope
      if (data && data.success === false) {
        return {
          success: false,
          error: data.error ?? 'Event processing failed',
          errorDetails: {
            code: 'UNKNOWN',
            message: data.error ?? 'Event processing failed',
          },
        };
      }

      log.info('User phone added successfully', {
        userId: request.userId,
        phoneId: data?.phoneId,
      });

      // Migration returns camelCase already; parse date strings to Date.
      const phone = data?.phone
        ? {
            ...data.phone,
            createdAt: new Date(data.phone.createdAt),
            updatedAt: new Date(data.phone.updatedAt),
          }
        : undefined;

      return { success: true, phoneId: data?.phoneId, phone };
    } catch (error) {
      log.error('Error in addUserPhone', error);
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
   * Update an existing user phone
   *
   * Calls api.update_user_phone RPC which emits user.phone.updated event.
   */
  async updateUserPhone(request: UpdateUserPhoneRequest): Promise<UserPhoneResult> {
    try {
      log.info('Updating user phone', {
        phoneId: request.phoneId,
        orgId: request.orgId,
      });

      // Pattern A v2: api.update_user_phone already returns the refreshed
      // phone row (baseline_v4 L6585, `row_to_json(v_row)::jsonb` — snake_case).
      // We map it to the camelCase `UserPhone` type before handing to consumers
      // so VMs can patch their list in place without a shape-normalizer step.
      const { data, error } = await supabaseService.apiRpc<{
        success: boolean;
        phoneId: string;
        eventId: string;
        phone?: {
          id: string;
          user_id: string;
          org_id: string | null;
          label: string;
          type: PhoneType;
          number: string;
          extension: string | null;
          country_code: string;
          is_primary: boolean;
          sms_capable: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        error?: string;
      }>('update_user_phone', {
        p_phone_id: request.phoneId,
        p_label: request.updates.label ?? null,
        p_type: request.updates.type ?? null,
        p_number: request.updates.number ?? null,
        p_extension: request.updates.extension ?? null,
        p_country_code: request.updates.countryCode ?? null,
        p_is_primary: request.updates.isPrimary ?? null,
        p_sms_capable: request.updates.smsCapable ?? null,
        p_org_id: request.orgId ?? null,
        p_reason: request.reason ?? null,
      });

      if (error) {
        log.error('Failed to update user phone via RPC', error);

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
            error: 'Phone not found',
            errorDetails: { code: 'NOT_FOUND', message: error.message },
          };
        }

        return {
          success: false,
          error: `Failed to update phone: ${error.message}`,
          errorDetails: { code: 'UNKNOWN', message: error.message },
        };
      }

      // Pattern A v2 read-back: handler-driven failure path surfaces the
      // `processing_error` via a `{success: false}` envelope. Propagate.
      if (data && data.success === false) {
        return {
          success: false,
          error: data.error ?? 'Event processing failed',
          errorDetails: {
            code: 'UNKNOWN',
            message: data.error ?? 'Event processing failed',
          },
        };
      }

      log.info('User phone updated successfully', { phoneId: request.phoneId });

      // Map snake_case row → camelCase UserPhone for consumer VMs.
      const phone = data?.phone
        ? {
            id: data.phone.id,
            userId: data.phone.user_id,
            orgId: data.phone.org_id,
            label: data.phone.label,
            type: data.phone.type,
            number: data.phone.number,
            extension: data.phone.extension,
            countryCode: data.phone.country_code,
            isPrimary: data.phone.is_primary,
            smsCapable: data.phone.sms_capable,
            isActive: data.phone.is_active,
            createdAt: new Date(data.phone.created_at),
            updatedAt: new Date(data.phone.updated_at),
          }
        : undefined;

      return { success: true, phoneId: request.phoneId, phone };
    } catch (error) {
      log.error('Error in updateUserPhone', error);
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
   * Remove (soft or hard delete) a user phone
   *
   * Calls api.remove_user_phone RPC which emits user.phone.removed event.
   */
  async removeUserPhone(request: RemoveUserPhoneRequest): Promise<UserVoidResult> {
    try {
      log.info('Removing user phone', {
        phoneId: request.phoneId,
        hardDelete: request.hardDelete,
        orgId: request.orgId,
      });

      const { data: _removeData, error } = await supabaseService.apiRpc<{
        success: boolean;
        phoneId: string;
        eventId: string;
      }>('remove_user_phone', {
        p_phone_id: request.phoneId,
        p_org_id: request.orgId ?? null,
        p_hard_delete: request.hardDelete ?? false,
        p_reason: request.reason ?? null,
      });

      if (error) {
        log.error('Failed to remove user phone via RPC', error);

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
            error: 'Phone not found',
            errorDetails: { code: 'NOT_FOUND', message: error.message },
          };
        }

        return {
          success: false,
          error: `Failed to remove phone: ${error.message}`,
          errorDetails: { code: 'UNKNOWN', message: error.message },
        };
      }

      log.info('User phone removed successfully', { phoneId: request.phoneId });

      return { success: true };
    } catch (error) {
      log.error('Error in removeUserPhone', error);
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
   * Update user's access dates for the organization
   *
   * Uses api.update_user_access_dates RPC which emits a domain event
   * and updates the user_organizations_projection.
   */
  async updateAccessDates(request: UpdateAccessDatesRequest): Promise<UserVoidResult> {
    try {
      log.info('Updating user access dates', {
        userId: request.userId,
        orgId: request.orgId,
      });

      // Use RPC function to update access dates (emits domain event)
      const { error } = await supabaseService.apiRpc<void>('update_user_access_dates', {
        p_user_id: request.userId,
        p_org_id: request.orgId,
        p_access_start_date: request.accessStartDate ?? null,
        p_access_expiration_date: request.accessExpirationDate ?? null,
      });

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
   * Calls the manage-user Edge Function with update_notification_preferences operation.
   * This provides full tracing context (correlation_id, trace_id, etc.) for observability.
   *
   * Phase 6.4: Migrated from RPC to Edge Function pattern for architectural consistency.
   */
  async updateNotificationPreferences(
    request: UpdateNotificationPreferencesRequest
  ): Promise<UpdateNotificationPreferencesResult> {
    // Set up tracing context for this operation
    const tracingContext = await createTracingContext();
    Logger.pushTracingContext(tracingContext);

    try {
      log.info('Updating user notification preferences', { userId: request.userId });

      // Transform request to AsyncAPI snake_case shape for the RPC payload.
      // RPC emits the domain event with this shape (event_data parity).
      const asyncApiPreferences = {
        email: request.notificationPreferences.email,
        sms: {
          enabled: request.notificationPreferences.sms.enabled,
          phone_id: request.notificationPreferences.sms.phoneId,
        },
        in_app: request.notificationPreferences.inApp,
      };

      // api.update_user_notification_preferences (Pattern A v2 RPC, extracted
      // from manage-user Edge Function per adr-edge-function-vs-sql-rpc.md).
      // org_id sourced from JWT inside the RPC; never passed from the client.
      const { data, error } = await supabaseService.apiRpc<{
        success: boolean;
        error?: string;
        eventId?: string;
        notificationPreferences?: {
          email: boolean;
          sms: { enabled: boolean; phone_id: string | null };
          in_app: boolean;
        };
      }>('update_user_notification_preferences', {
        p_user_id: request.userId,
        p_notification_preferences: asyncApiPreferences,
        p_reason: request.reason,
      });

      if (error) {
        log.error('RPC error in updateNotificationPreferences', { error });
        return {
          success: false,
          error: error.message,
          errorDetails: {
            code: 'UNKNOWN',
            message: error.message,
            context: { postgresCode: error.code, hint: error.hint },
          },
        };
      }

      if (!data?.success) {
        return {
          success: false,
          error: data?.error ?? 'Failed to update notification preferences',
          errorDetails: {
            code: 'UNKNOWN',
            message: data?.error ?? 'Unknown error',
          },
        };
      }

      log.info('Notification preferences updated successfully', {
        userId: request.userId,
        eventId: data.eventId,
      });

      // Map RPC's AsyncAPI snake_case response → frontend camelCase
      // NotificationPreferences shape. Contract: RPC always includes the
      // notificationPreferences field on success (Pattern A v2 readback).
      let notificationPreferences: NotificationPreferences | undefined;
      if (data.notificationPreferences) {
        const p = data.notificationPreferences;
        notificationPreferences = {
          email: p.email,
          sms: {
            enabled: p.sms?.enabled ?? false,
            phoneId: p.sms?.phone_id ?? null,
          },
          inApp: p.in_app,
        };
      }

      return { success: true, notificationPreferences };
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
    } finally {
      Logger.popTracingContext();
    }
  }
}
