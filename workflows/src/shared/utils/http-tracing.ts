/**
 * HTTP Request Tracing Utilities
 *
 * Extracts tracing context from HTTP request headers for workflow propagation.
 * Compatible with W3C Trace Context (traceparent) and custom A4C headers.
 *
 * Header Format:
 * - x-correlation-id: Business request correlation ID (UUID)
 * - x-session-id: User auth session ID from Supabase JWT
 * - traceparent: W3C Trace Context format "00-<trace_id>-<span_id>-<flags>"
 *
 * Usage in workflow API:
 * ```typescript
 * import { extractTracingFromHeaders } from '@shared/utils/http-tracing.js';
 *
 * const tracing = extractTracingFromHeaders(request.headers);
 * await client.workflow.start('organizationBootstrapWorkflow', {
 *   args: [{ ...params, tracing }]
 * });
 * ```
 */

import { randomBytes, randomUUID } from 'crypto';
import type { WorkflowTracingParams } from '../types/index.js';

/**
 * Generic headers type that works with Fastify, Express, and raw Node.js
 */
type Headers = Record<string, string | string[] | undefined>;

/**
 * Extract a single header value from headers object
 * Handles both string and string[] values (Fastify uses string, Node.js uses string[])
 */
function getHeader(headers: Headers, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Generate a W3C compatible trace ID (32 hex characters)
 * Used when no trace context is provided in request
 */
export function generateTraceId(): string {
  return randomUUID().replace(/-/g, '');
}

/**
 * Generate a W3C compatible span ID (16 hex characters)
 * Used to identify individual operations within a trace
 */
export function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Extract tracing context from HTTP request headers
 *
 * Extracts tracing context for workflow propagation. If correlation_id is missing,
 * generates a new tracing context to ensure all workflow events are traceable.
 *
 * @param headers - HTTP request headers (Fastify, Express, or Node.js format)
 * @returns WorkflowTracingParams for passing to workflow
 *
 * @example
 * ```typescript
 * // In Fastify route handler
 * const tracing = extractTracingFromHeaders(request.headers);
 *
 * await client.workflow.start('organizationBootstrapWorkflow', {
 *   args: [{
 *     organizationId,
 *     subdomain,
 *     tracing,  // Propagate tracing to workflow
 *   }]
 * });
 * ```
 */
export function extractTracingFromHeaders(
  headers: Headers
): WorkflowTracingParams {
  // Extract custom A4C headers
  const correlationId = getHeader(headers, 'x-correlation-id');
  const sessionId = getHeader(headers, 'x-session-id');
  const traceparent = getHeader(headers, 'traceparent');

  // Parse W3C traceparent: "00-<trace_id>-<span_id>-<flags>"
  let traceId: string = generateTraceId();
  let parentSpanId: string = generateSpanId();

  if (traceparent) {
    const parts = traceparent.split('-');
    if (parts.length >= 3 && parts[1] && parts[2]) {
      traceId = parts[1];
      parentSpanId = parts[2];
    }
    // If invalid format, keep the generated defaults
  }

  return {
    // Use provided correlation ID or generate a new UUID
    correlationId: correlationId || randomUUID(),
    sessionId: sessionId || null,
    traceId,
    parentSpanId,
  };
}

/**
 * Build traceparent header from tracing params
 *
 * Useful for propagating trace context to downstream services.
 *
 * @param tracing - Workflow tracing params
 * @param spanId - Current span ID (optional, generates new if not provided)
 * @returns W3C traceparent header value
 */
export function buildTraceparentHeader(
  tracing: WorkflowTracingParams,
  spanId?: string
): string {
  const currentSpanId = spanId || generateSpanId();
  return `00-${tracing.traceId}-${currentSpanId}-01`;
}
