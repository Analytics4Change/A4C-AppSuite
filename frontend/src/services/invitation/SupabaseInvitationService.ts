/**
 * Supabase Invitation Service Implementation
 *
 * Production invitation service that uses Supabase Edge Functions for invitation operations.
 * All user creation and invitation acceptance goes through authenticated Edge Functions
 * that emit domain events.
 *
 * Architecture:
 * Frontend → Supabase Edge Function → Auth API / Event Emission → PostgreSQL Triggers
 *
 * Edge Functions:
 * - /validate-invitation: Validate token and get details
 * - /accept-invitation: Create user and accept invitation
 * - /resend-invitation: Resend invitation email
 *
 * All operations are event-driven - NO direct database writes.
 */

import {
  FunctionsHttpError,
  FunctionsRelayError,
  FunctionsFetchError,
} from '@supabase/supabase-js';
import type { IInvitationService } from './IInvitationService';
import type {
  InvitationDetails,
  UserCredentials,
  AcceptInvitationResult
} from '@/types/organization.types';
import { supabaseService } from '@/services/auth/supabase.service';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('invitation');

/**
 * Supabase Edge Function endpoints for invitation operations
 */
const EDGE_FUNCTIONS = {
  VALIDATE: 'validate-invitation',
  ACCEPT: 'accept-invitation',
  RESEND: 'resend-invitation'
} as const;

/**
 * Extract detailed error from Supabase Edge Function error response.
 *
 * When Edge Functions return non-2xx status codes, the Supabase SDK wraps
 * the response in a FunctionsHttpError. The actual error message from the
 * Edge Function is accessible via `error.context.json()`.
 *
 * @param error - The error from functions.invoke()
 * @param operation - Human-readable operation name for fallback messages
 * @returns Object with error message and optional details
 */
async function extractEdgeFunctionError(
  error: unknown,
  operation: string
): Promise<{ message: string; details?: string }> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      log.error(`Edge Function HTTP error for ${operation}`, {
        status: error.context.status,
        body,
      });
      return {
        message: body?.message ?? body?.error ?? `${operation} failed`,
        details: body?.details,
      };
    } catch {
      // Response body wasn't JSON - use status code
      log.error(`Edge Function error (non-JSON response) for ${operation}`, {
        status: error.context.status,
      });
      return {
        message: `${operation} failed (HTTP ${error.context.status})`,
      };
    }
  }

  if (error instanceof FunctionsRelayError) {
    log.error(`Edge Function relay error for ${operation}`, error);
    return {
      message: `Network error: ${error.message}`,
    };
  }

  if (error instanceof FunctionsFetchError) {
    log.error(`Edge Function fetch error for ${operation}`, error);
    return {
      message: `Connection error: ${error.message}`,
    };
  }

  // Unknown error type
  log.error(`Unknown error for ${operation}`, error);
  return {
    message: error instanceof Error ? error.message : 'Unknown error',
  };
}

/**
 * Production invitation service using Supabase Edge Functions
 *
 * Event-Driven Architecture:
 * - NO direct database inserts/updates
 * - All state changes via domain events
 * - PostgreSQL triggers update CQRS projections
 */
export class SupabaseInvitationService implements IInvitationService {
  /**
   * Validate invitation token and get details
   *
   * Calls Edge Function to validate token against database.
   * Edge Function queries invitation projections (read-only).
   *
   * @param token - Invitation token from URL
   * @returns Invitation details
   * @throws Error if token invalid, expired, or already accepted
   */
  async validateInvitation(token: string): Promise<InvitationDetails> {
    try {
      log.debug('Validating invitation token', { token });

      const client = supabaseService.getClient();
      const { data, error } = await client.functions.invoke(
        EDGE_FUNCTIONS.VALIDATE,
        {
          body: { token }
        }
      );

      if (error) {
        const extracted = await extractEdgeFunctionError(error, 'Validate invitation');
        throw new Error(extracted.message);
      }

      if (!data?.orgName || !data?.role) {
        throw new Error('Invalid invitation response');
      }

      log.info('Invitation validated', {
        orgName: data.orgName,
        role: data.role
      });

      return {
        orgName: data.orgName,
        role: data.role,
        inviterName: data.inviterName,
        expiresAt: new Date(data.expiresAt),
        email: data.email
      };
    } catch (error) {
      log.error('Error validating invitation', error);
      throw error;
    }
  }

  /**
   * Accept invitation and create user account
   *
   * Flow:
   * 1. Call Edge Function with token and credentials
   * 2. Edge Function validates token
   * 3. Edge Function creates Supabase Auth user (email/password or OAuth)
   * 4. Edge Function emits UserCreated event
   * 5. Edge Function emits UserInvitationAccepted event
   * 6. PostgreSQL triggers update projections
   * 7. Edge Function returns userId, orgId, redirect URL
   *
   * Events Emitted (by Edge Function):
   * - UserCreated: Creates user projection
   * - UserInvitationAccepted: Marks invitation as used
   * - UserRoleAssigned: Links user to organization with role
   *
   * @param token - Invitation token
   * @param credentials - User credentials (email/password or OAuth)
   * @returns Result with userId, orgId, redirect URL
   * @throws Error if invitation invalid or user creation fails
   */
  async acceptInvitation(
    token: string,
    credentials: UserCredentials
  ): Promise<AcceptInvitationResult> {
    try {
      log.info('Accepting invitation', {
        token,
        authMethod: credentials.oauth ? 'oauth' : 'email/password'
      });

      const client = supabaseService.getClient();
      const { data, error } = await client.functions.invoke(
        EDGE_FUNCTIONS.ACCEPT,
        {
          body: {
            token,
            credentials
          }
        }
      );

      if (error) {
        const extracted = await extractEdgeFunctionError(error, 'Accept invitation');
        throw new Error(extracted.message);
      }

      if (!data?.userId || !data?.orgId || !data?.redirectUrl) {
        throw new Error('Invalid invitation acceptance response');
      }

      // Enhanced logging for redirect debugging
      log.info('Edge function response received', {
        success: data.success,
        userId: data.userId,
        orgId: data.orgId,
        redirectUrl: data.redirectUrl,
        isAbsoluteUrl: data.redirectUrl?.startsWith('http'),
        isSubdomainRedirect: data.redirectUrl?.includes('.firstovertheline.com'),
      });

      return {
        userId: data.userId,
        orgId: data.orgId,
        redirectUrl: data.redirectUrl
      };
    } catch (error) {
      log.error('Error accepting invitation', error);
      throw error;
    }
  }

  /**
   * Resend invitation email
   *
   * Calls Edge Function to resend invitation email.
   * Edge Function emits InvitationResent event.
   *
   * @param invitationId - Invitation identifier
   * @returns True if email sent successfully
   * @throws Error if invitation not found or already accepted
   */
  async resendInvitation(invitationId: string): Promise<boolean> {
    try {
      log.info('Resending invitation', { invitationId });

      const client = supabaseService.getClient();
      const { data, error } = await client.functions.invoke(
        EDGE_FUNCTIONS.RESEND,
        {
          body: { invitationId }
        }
      );

      if (error) {
        const extracted = await extractEdgeFunctionError(error, 'Resend invitation');
        throw new Error(extracted.message);
      }

      const success = data?.sent === true;
      log.info(
        success ? 'Invitation resent' : 'Failed to resend invitation',
        { invitationId }
      );

      return success;
    } catch (error) {
      log.error('Error resending invitation', error);
      throw error;
    }
  }
}
