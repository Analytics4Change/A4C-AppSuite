/**
 * Frontend Tracing Utilities
 *
 * Provides W3C Trace Context compatible tracing for end-to-end request correlation.
 * These utilities generate tracing headers that are sent to Edge Functions and
 * propagated through the entire request lifecycle.
 *
 * W3C Trace Context: https://www.w3.org/TR/trace-context/
 *
 * Header Format:
 * - traceparent: 00-{trace_id}-{span_id}-{flags}
 * - X-Correlation-ID: Business correlation (fallback)
 * - X-Session-ID: User auth session
 *
 * @module utils/tracing
 */

import { supabaseService } from '@/services/auth/supabase.service';

/**
 * Tracing context containing all IDs for request correlation
 */
export interface TracingContext {
  /** Business correlation ID (UUID format) */
  correlationId: string;
  /** User auth session ID from JWT (null if not authenticated) */
  sessionId: string | null;
  /** W3C trace ID (32 hex chars) */
  traceId: string;
  /** Operation span ID (16 hex chars) */
  spanId: string;
}

/**
 * Parsed traceparent header components
 */
export interface TraceparentComponents {
  version: string;
  traceId: string;
  spanId: string;
  flags: string;
}

/**
 * Generate a UUID v4 correlation ID
 *
 * Uses crypto.randomUUID() for secure random generation.
 * Falls back to manual generation if not available.
 *
 * @returns UUID v4 string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export function generateCorrelationId(): string {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate a W3C-compatible trace ID (32 hex characters)
 *
 * Trace IDs uniquely identify a distributed trace across all services.
 * Format: 32 lowercase hex characters (128 bits)
 *
 * @returns 32 hex character string (e.g., "550e8400e29b41d4a716446655440000")
 */
export function generateTraceId(): string {
  // Use UUID without dashes for W3C compatibility
  const uuid = generateCorrelationId();
  return uuid.replace(/-/g, '');
}

/**
 * Generate a W3C-compatible span ID (16 hex characters)
 *
 * Span IDs uniquely identify a single operation within a trace.
 * Format: 16 lowercase hex characters (64 bits)
 *
 * @returns 16 hex character string (e.g., "a716446655440000")
 */
export function generateSpanId(): string {
  // Generate 16 hex characters (64 bits)
  const bytes = new Uint8Array(8);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Fallback
    for (let i = 0; i < 8; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a W3C traceparent header value
 *
 * Format: {version}-{trace_id}-{span_id}-{flags}
 * - version: "00" (current version)
 * - trace_id: 32 hex chars (128 bits)
 * - span_id: 16 hex chars (64 bits)
 * - flags: "01" (sampled)
 *
 * @param traceId - Optional existing trace ID (generates new if not provided)
 * @param spanId - Optional existing span ID (generates new if not provided)
 * @returns traceparent header value and components
 *
 * @example
 * const { header, traceId, spanId } = generateTraceparent();
 * // header: "00-550e8400e29b41d4a716446655440000-a716446655440000-01"
 */
export function generateTraceparent(
  traceId?: string,
  spanId?: string
): { header: string } & TraceparentComponents {
  const version = '00';
  const actualTraceId = traceId || generateTraceId();
  const actualSpanId = spanId || generateSpanId();
  const flags = '01'; // Sampled

  const header = `${version}-${actualTraceId}-${actualSpanId}-${flags}`;

  return {
    header,
    version,
    traceId: actualTraceId,
    spanId: actualSpanId,
    flags,
  };
}

/**
 * Parse a traceparent header value into components
 *
 * @param traceparent - The traceparent header value
 * @returns Parsed components or null if invalid
 */
export function parseTraceparent(
  traceparent: string
): TraceparentComponents | null {
  const parts = traceparent.split('-');
  if (parts.length !== 4) {
    return null;
  }

  const [version, traceId, spanId, flags] = parts;

  // Validate format
  if (
    version.length !== 2 ||
    traceId.length !== 32 ||
    spanId.length !== 16 ||
    flags.length !== 2
  ) {
    return null;
  }

  // Validate hex
  const hexRegex = /^[0-9a-f]+$/i;
  if (
    !hexRegex.test(version) ||
    !hexRegex.test(traceId) ||
    !hexRegex.test(spanId) ||
    !hexRegex.test(flags)
  ) {
    return null;
  }

  return { version, traceId, spanId, flags };
}

/**
 * Get session ID from Supabase Auth JWT claims
 *
 * Extracts the session_id from the current user's JWT token.
 * This ties events to the actual auth session.
 *
 * @returns Session ID string or null if not authenticated
 */
export async function getSessionId(): Promise<string | null> {
  try {
    const client = supabaseService.getClient();
    const {
      data: { session },
    } = await client.auth.getSession();

    if (!session?.access_token) {
      return null;
    }

    // Decode JWT to extract session_id claim
    const payload = session.access_token.split('.')[1];
    if (!payload) {
      return null;
    }

    const decoded = JSON.parse(globalThis.atob(payload));
    return decoded.session_id || null;
  } catch {
    // Return null gracefully if JWT decode fails
    return null;
  }
}

/**
 * Build tracing headers from an existing TracingContext
 *
 * Use this when you already have a TracingContext (from createTracingContext())
 * to ensure the same IDs are used in headers and logs.
 *
 * @param context - Existing tracing context
 * @returns Headers object with all tracing headers
 *
 * @example
 * const context = await createTracingContext();
 * Logger.pushTracingContext(context);
 * const headers = buildHeadersFromContext(context);
 */
export function buildHeadersFromContext(
  context: TracingContext
): Record<string, string> {
  const traceparentHeader = `00-${context.traceId}-${context.spanId}-01`;

  const headers: Record<string, string> = {
    traceparent: traceparentHeader,
    'X-Correlation-ID': context.correlationId,
  };

  if (context.sessionId) {
    headers['X-Session-ID'] = context.sessionId;
  }

  return headers;
}

/**
 * Build all tracing headers for Edge Function calls
 *
 * Creates a complete set of tracing headers to send with requests.
 * Uses W3C traceparent as primary, with custom headers as fallback.
 *
 * NOTE: Prefer using createTracingContext() + buildHeadersFromContext()
 * to ensure consistent IDs between logs and headers.
 *
 * @returns Headers object with all tracing headers
 * @deprecated Use createTracingContext() + buildHeadersFromContext() instead
 *
 * @example
 * // Preferred pattern:
 * const context = await createTracingContext();
 * Logger.pushTracingContext(context);
 * const headers = buildHeadersFromContext(context);
 *
 * // Legacy pattern (generates different IDs for logs vs headers):
 * const headers = await buildTracingHeaders();
 */
export async function buildTracingHeaders(): Promise<Record<string, string>> {
  const correlationId = generateCorrelationId();
  const traceparent = generateTraceparent();
  const sessionId = await getSessionId();

  const headers: Record<string, string> = {
    traceparent: traceparent.header,
    'X-Correlation-ID': correlationId,
  };

  if (sessionId) {
    headers['X-Session-ID'] = sessionId;
  }

  return headers;
}

/**
 * Build tracing headers synchronously (when session is already known)
 *
 * Use this when you already have the session ID and don't want to
 * make an async call. For most cases, prefer buildTracingHeaders().
 *
 * @param sessionId - Optional session ID to include
 * @returns Headers object with all tracing headers
 */
export function buildTracingHeadersSync(
  sessionId?: string | null
): Record<string, string> {
  const correlationId = generateCorrelationId();
  const traceparent = generateTraceparent();

  const headers: Record<string, string> = {
    traceparent: traceparent.header,
    'X-Correlation-ID': correlationId,
  };

  if (sessionId) {
    headers['X-Session-ID'] = sessionId;
  }

  return headers;
}

/**
 * Create a full tracing context for use with logging
 *
 * Generates all tracing IDs needed for request correlation and logging.
 *
 * @returns Complete tracing context
 *
 * @example
 * const context = await createTracingContext();
 * logger.setContext({ traceId: context.traceId, spanId: context.spanId });
 */
export async function createTracingContext(): Promise<TracingContext> {
  const correlationId = generateCorrelationId();
  const traceId = generateTraceId();
  const spanId = generateSpanId();
  const sessionId = await getSessionId();

  return {
    correlationId,
    sessionId,
    traceId,
    spanId,
  };
}

/**
 * Create tracing context synchronously (when session is already known)
 *
 * @param sessionId - Optional session ID to include
 * @returns Complete tracing context
 */
export function createTracingContextSync(
  sessionId?: string | null
): TracingContext {
  return {
    correlationId: generateCorrelationId(),
    sessionId: sessionId || null,
    traceId: generateTraceId(),
    spanId: generateSpanId(),
  };
}
