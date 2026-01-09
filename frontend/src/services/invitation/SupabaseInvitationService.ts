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
import { buildHeadersFromContext, createTracingContext } from '@/utils/tracing';

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
 * Result from extracting Edge Function errors
 */
interface EdgeFunctionErrorResult {
  message: string;
  details?: string;
  /** Correlation ID from response headers for support tickets */
  correlationId?: string;
}

/**
 * Extract detailed error from Supabase Edge Function error response.
 *
 * When Edge Functions return non-2xx status codes, the Supabase SDK wraps
 * the response in a FunctionsHttpError. The actual error message from the
 * Edge Function is accessible via `error.context.json()`.
 *
 * Also extracts the X-Correlation-ID header if present for support tickets.
 *
 * @param error - The error from functions.invoke()
 * @param operation - Human-readable operation name for fallback messages
 * @returns Object with error message, optional details, and correlation ID
 */
async function extractEdgeFunctionError(
  error: unknown,
  operation: string
): Promise<EdgeFunctionErrorResult> {
  if (error instanceof FunctionsHttpError) {
    // Try to extract correlation ID from response headers
    const correlationId = error.context.headers.get('x-correlation-id') ?? undefined;

    try {
      const body = await error.context.json();
      log.error(`Edge Function HTTP error for ${operation}`, {
        status: error.context.status,
        correlationId,
        body,
      });
      return {
        message: body?.message ?? body?.error ?? `${operation} failed`,
        details: body?.details,
        correlationId,
      };
    } catch {
      // Response body wasn't JSON - use status code
      log.error(`Edge Function error (non-JSON response) for ${operation}`, {
        status: error.context.status,
        correlationId,
      });
      return {
        message: `${operation} failed (HTTP ${error.context.status})`,
        correlationId,
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
    // Set up tracing context for this operation
    const tracingContext = await createTracingContext();
    Logger.pushTracingContext(tracingContext);

    try {
      log.debug('Validating invitation token', { token });

      const client = supabaseService.getClient();
      const headers = buildHeadersFromContext(tracingContext);
      const { data, error } = await client.functions.invoke(
        EDGE_FUNCTIONS.VALIDATE,
        {
          body: { token },
          headers,
        }
      );

      if (error) {
        const extracted = await extractEdgeFunctionError(error, 'Validate invitation');
        const errorWithRef = extracted.correlationId
          ? `${extracted.message} (Ref: ${extracted.correlationId})`
          : extracted.message;
        throw new Error(errorWithRef);
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
    } finally {
      Logger.popTracingContext();
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
    // Set up tracing context for this operation
    const tracingContext = await createTracingContext();
    Logger.pushTracingContext(tracingContext);

    try {
      log.info('Accepting invitation', {
        token,
        authMethod: credentials.authMethod?.type || 'email_password'
      });

      const client = supabaseService.getClient();
      const headers = buildHeadersFromContext(tracingContext);
      const { data, error } = await client.functions.invoke(
        EDGE_FUNCTIONS.ACCEPT,
        {
          body: {
            token,
            credentials
          },
          headers,
        }
      );

      if (error) {
        const extracted = await extractEdgeFunctionError(error, 'Accept invitation');
        const errorWithRef = extracted.correlationId
          ? `${extracted.message} (Ref: ${extracted.correlationId})`
          : extracted.message;
        throw new Error(errorWithRef);
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
    } finally {
      Logger.popTracingContext();
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
    // Set up tracing context for this operation
    const tracingContext = await createTracingContext();
    Logger.pushTracingContext(tracingContext);

    try {
      log.info('Resending invitation', { invitationId });

      const client = supabaseService.getClient();
      const headers = buildHeadersFromContext(tracingContext);
      const { data, error } = await client.functions.invoke(
        EDGE_FUNCTIONS.RESEND,
        {
          body: { invitationId },
          headers,
        }
      );

      if (error) {
        const extracted = await extractEdgeFunctionError(error, 'Resend invitation');
        const errorWithRef = extracted.correlationId
          ? `${extracted.message} (Ref: ${extracted.correlationId})`
          : extracted.message;
        throw new Error(errorWithRef);
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
    } finally {
      Logger.popTracingContext();
    }
  }
}
