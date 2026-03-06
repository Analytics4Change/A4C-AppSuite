/**
 * Shared Edge Function Error Extraction Utility
 *
 * Extracts detailed error information from Supabase Edge Function error responses.
 * When Edge Functions return non-2xx status codes, the Supabase SDK wraps
 * the response in typed error classes. This utility handles all error types
 * and extracts the actual error message, code, and correlation ID.
 *
 * Used by: SupabaseUserCommandService, SupabaseInvitationService, TemporalWorkflowClient
 *
 * @see infrastructure/supabase/supabase/functions/_shared/error-response.ts - Server-side error format
 */

import {
  FunctionsHttpError,
  FunctionsRelayError,
  FunctionsFetchError,
} from '@supabase/supabase-js';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

/**
 * Result from extracting an Edge Function error.
 * Generalized interface usable by any service.
 */
export interface EdgeFunctionErrorResult {
  /** Primary error message for display */
  message: string;
  /** Machine-readable error code (e.g., 'UNAUTHORIZED', 'VALIDATION_ERROR') */
  code?: string;
  /** Technical details for debugging */
  details?: string;
  /** Full errorDetails object from Edge Function response (for rich error display) */
  errorDetails?: Record<string, unknown>;
  /** Correlation ID from response headers for support tickets */
  correlationId?: string;
}

/**
 * Extract detailed error from Supabase Edge Function error response.
 *
 * Handles all Supabase SDK error types:
 * - FunctionsHttpError: Edge Function returned non-2xx (most common)
 * - FunctionsRelayError: Network/relay issues
 * - FunctionsFetchError: Connection failures
 * - Unknown errors: Fallback handling
 *
 * @param error - The error from functions.invoke()
 * @param operation - Human-readable operation name for fallback messages
 * @returns Object with error message, code, details, and correlation ID
 */
export async function extractEdgeFunctionError(
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
        message: body?.error ?? `${operation} failed`,
        code: body?.code ?? 'HTTP_ERROR',
        details: body?.details,
        errorDetails: body?.errorDetails,
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
        code: 'HTTP_ERROR',
        correlationId,
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
