/**
 * Standardized Error Response Utilities - Edge Functions
 *
 * This module provides consistent error response formatting across all Edge Functions.
 * All error responses follow the EdgeFunctionErrorResponse interface, which is compatible
 * with the frontend's extractEdgeFunctionError() pattern.
 *
 * Key Features:
 * - Standard error response structure with correlation_id for tracing
 * - Detection of event processing failures (Phase 2 error propagation)
 * - Machine-readable error codes for programmatic handling
 * - User-friendly error messages for UI display
 *
 * Usage in Edge Functions:
 *   import { createErrorResponse, handleRpcError, generateCorrelationId } from '../_shared/error-response.ts';
 *
 *   // Generate correlation ID at request start
 *   const correlationId = generateCorrelationId();
 *
 *   // Handle RPC errors with standard format
 *   const { data, error } = await supabase.rpc('emit_domain_event', {...});
 *   if (error) {
 *     return handleRpcError(error, correlationId, corsHeaders);
 *   }
 *
 * @see frontend/src/services/users/SupabaseUserCommandService.ts - extractEdgeFunctionError()
 * @see documentation/infrastructure/guides/event-observability.md
 */

/**
 * Standard error response structure for all Edge Functions.
 * Compatible with frontend's extractEdgeFunctionError() pattern.
 */
export interface EdgeFunctionErrorResponse {
  /** User-friendly error message for UI display */
  error: string;

  /** Machine-readable error code for programmatic handling */
  code: string;

  /** Technical details for debugging (from RPC error, etc.) */
  details?: string;

  /** Correlation ID for tracing across services */
  correlation_id?: string;

  /** Additional context (optional, function-specific) */
  context?: Record<string, unknown>;
}

/**
 * Standard error codes for Edge Function errors.
 * These codes help the frontend handle errors appropriately.
 */
export const ErrorCodes = {
  // Event Processing Errors (Phase 2)
  EVENT_PROCESSING_FAILED: 'EVENT_PROCESSING_FAILED',

  // RPC/Database Errors
  RPC_ERROR: 'RPC_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',

  // Validation Errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',

  // Auth/Permission Errors
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_TOKEN: 'INVALID_TOKEN',

  // Resource Errors
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  EXPIRED: 'EXPIRED',

  // Server Errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Generate a unique correlation ID for request tracing.
 * Format: UUID v4
 *
 * @returns A new UUID for correlation
 */
export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Create a standardized error response.
 *
 * @param params Error response parameters
 * @param corsHeaders CORS headers to include
 * @returns Response object with standard error format
 */
export function createErrorResponse(
  params: {
    error: string;
    code: ErrorCode | string;
    status: number;
    details?: string;
    correlationId?: string;
    context?: Record<string, unknown>;
  },
  corsHeaders: Record<string, string>
): Response {
  const body: EdgeFunctionErrorResponse = {
    error: params.error,
    code: params.code,
  };

  if (params.details) {
    body.details = params.details;
  }

  if (params.correlationId) {
    body.correlation_id = params.correlationId;
  }

  if (params.context) {
    body.context = params.context;
  }

  return new Response(JSON.stringify(body), {
    status: params.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Check if an RPC error is an event processing failure.
 * Event processing failures are propagated from api.emit_domain_event()
 * when a critical event's trigger processing fails.
 *
 * @param errorMessage The error message from RPC
 * @returns true if this is an event processing error
 */
export function isEventProcessingError(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return false;
  return errorMessage.includes('Event processing failed');
}

/**
 * Handle RPC errors with standardized response format.
 * Automatically detects event processing failures and returns appropriate error codes.
 *
 * @param rpcError The error from Supabase RPC call
 * @param correlationId Correlation ID for tracing
 * @param corsHeaders CORS headers
 * @param operation Optional operation name for context
 * @returns Response with standard error format
 */
export function handleRpcError(
  rpcError: { message: string; code?: string; details?: string },
  correlationId: string,
  corsHeaders: Record<string, string>,
  operation?: string
): Response {
  const isProcessingError = isEventProcessingError(rpcError.message);

  const userMessage = isProcessingError
    ? 'Failed to complete operation. Please try again or contact support.'
    : operation
      ? `${operation} failed: ${rpcError.message}`
      : rpcError.message;

  const code = isProcessingError
    ? ErrorCodes.EVENT_PROCESSING_FAILED
    : ErrorCodes.RPC_ERROR;

  const status = isProcessingError ? 500 : 400;

  return createErrorResponse(
    {
      error: userMessage,
      code,
      status,
      details: rpcError.message,
      correlationId,
    },
    corsHeaders
  );
}

/**
 * Create a validation error response.
 *
 * @param message User-friendly error message
 * @param correlationId Correlation ID for tracing
 * @param corsHeaders CORS headers
 * @param field Optional field name that failed validation
 * @returns Response with standard error format
 */
export function createValidationError(
  message: string,
  correlationId: string,
  corsHeaders: Record<string, string>,
  field?: string
): Response {
  return createErrorResponse(
    {
      error: message,
      code: field ? ErrorCodes.MISSING_REQUIRED_FIELD : ErrorCodes.VALIDATION_ERROR,
      status: 400,
      correlationId,
      context: field ? { field } : undefined,
    },
    corsHeaders
  );
}

/**
 * Create a not found error response.
 *
 * @param resource Resource type that was not found (e.g., 'invitation', 'user')
 * @param correlationId Correlation ID for tracing
 * @param corsHeaders CORS headers
 * @returns Response with standard error format
 */
export function createNotFoundError(
  resource: string,
  correlationId: string,
  corsHeaders: Record<string, string>
): Response {
  return createErrorResponse(
    {
      error: `${resource} not found`,
      code: ErrorCodes.NOT_FOUND,
      status: 404,
      correlationId,
    },
    corsHeaders
  );
}

/**
 * Create an unauthorized error response.
 *
 * @param message Optional custom message
 * @param correlationId Correlation ID for tracing
 * @param corsHeaders CORS headers
 * @returns Response with standard error format
 */
export function createUnauthorizedError(
  correlationId: string,
  corsHeaders: Record<string, string>,
  message = 'Authentication required'
): Response {
  return createErrorResponse(
    {
      error: message,
      code: ErrorCodes.UNAUTHORIZED,
      status: 401,
      correlationId,
    },
    corsHeaders
  );
}

/**
 * Create an internal server error response.
 *
 * @param correlationId Correlation ID for tracing
 * @param corsHeaders CORS headers
 * @param details Optional technical details (not shown to user)
 * @returns Response with standard error format
 */
export function createInternalError(
  correlationId: string,
  corsHeaders: Record<string, string>,
  details?: string
): Response {
  return createErrorResponse(
    {
      error: 'Internal server error',
      code: ErrorCodes.INTERNAL_ERROR,
      status: 500,
      correlationId,
      details,
    },
    corsHeaders
  );
}

/**
 * Standard CORS headers for Edge Functions.
 * Import and use these in all Edge Functions for consistency.
 */
export const standardCorsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Create a CORS preflight response.
 *
 * @param corsHeaders Optional custom CORS headers
 * @returns Response for OPTIONS requests
 */
export function createCorsPreflightResponse(
  corsHeaders: Record<string, string> = standardCorsHeaders
): Response {
  return new Response('ok', { headers: corsHeaders });
}
