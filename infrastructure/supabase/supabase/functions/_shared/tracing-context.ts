/**
 * Tracing Context Module - Edge Functions
 *
 * Provides W3C Trace Context compatible distributed tracing for Edge Functions.
 * Supports both W3C standard headers (traceparent) and custom headers for
 * backward compatibility.
 *
 * Features:
 * - W3C Trace Context (traceparent) parsing and generation
 * - Custom header fallback (X-Correlation-ID, X-Session-ID)
 * - Span lifecycle management with timing
 * - Parent-child span relationships
 *
 * Usage:
 *   import { extractTracingContext, createSpan, endSpan } from '../_shared/tracing-context.ts';
 *
 *   const context = extractTracingContext(req);
 *   const span = createSpan(context, 'invite-user');
 *
 *   try {
 *     // ... business logic ...
 *     endSpan(span, 'ok');
 *   } catch (error) {
 *     endSpan(span, 'error');
 *     throw error;
 *   }
 *
 * @see https://www.w3.org/TR/trace-context/
 * @see documentation/infrastructure/guides/event-observability.md
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Tracing context extracted from request headers.
 * Contains both W3C-compatible trace IDs and business-level correlation.
 */
export interface TracingContext {
  /** Business-level request correlation ID (UUID v4) */
  correlationId: string;

  /** User's auth session ID from Supabase JWT */
  sessionId: string | null;

  /** W3C Trace Context trace ID (32 hex chars) */
  traceId: string;

  /** W3C Trace Context span ID for this operation (16 hex chars) */
  spanId: string;

  /** Parent span ID from incoming request (16 hex chars or null) */
  parentSpanId: string | null;

  /** Whether this trace is sampled (from traceparent flags) */
  sampled: boolean;
}

/**
 * Span represents a single operation with timing information.
 */
export interface Span {
  /** W3C Trace Context trace ID */
  traceId: string;

  /** This span's ID */
  spanId: string;

  /** Parent span ID (from incoming context) */
  parentSpanId: string | null;

  /** Operation name (e.g., 'invite-user', 'emit-event') */
  operationName: string;

  /** Service name (e.g., 'edge-function', 'temporal-worker') */
  serviceName: string;

  /** Start timestamp (ms since epoch) */
  startTime: number;

  /** End timestamp (ms since epoch, set when span ends) */
  endTime?: number;

  /** Duration in milliseconds (calculated when span ends) */
  durationMs?: number;

  /** Status: 'ok' or 'error' */
  status: 'ok' | 'error';

  /** Additional attributes */
  attributes: Record<string, string | number | boolean>;

  /** Business correlation (for database storage) */
  correlationId: string;

  /** User session (for database storage) */
  sessionId: string | null;
}

// =============================================================================
// W3C Trace Context Helpers
// =============================================================================

/**
 * Generate a W3C-compatible trace ID (32 hex characters, 128 bits).
 * Format: lowercase hex string without hyphens.
 */
export function generateTraceId(): string {
  const uuid = crypto.randomUUID();
  return uuid.replace(/-/g, '');
}

/**
 * Generate a W3C-compatible span ID (16 hex characters, 64 bits).
 * Format: lowercase hex string.
 */
export function generateSpanId(): string {
  const uuid = crypto.randomUUID();
  return uuid.replace(/-/g, '').substring(0, 16);
}

/**
 * Parse W3C traceparent header.
 * Format: {version}-{trace-id}-{parent-id}-{trace-flags}
 * Example: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
 *
 * @param traceparent - The traceparent header value
 * @returns Parsed components or null if invalid
 */
export function parseTraceparent(
  traceparent: string | null
): { traceId: string; parentSpanId: string; sampled: boolean } | null {
  if (!traceparent) return null;

  // Validate format: version-traceid-parentid-flags
  const parts = traceparent.split('-');
  if (parts.length !== 4) return null;

  const [version, traceId, parentId, flags] = parts;

  // Version must be '00' (current version)
  if (version !== '00') return null;

  // Trace ID must be 32 hex chars and not all zeros
  if (!/^[0-9a-f]{32}$/i.test(traceId)) return null;
  if (traceId === '00000000000000000000000000000000') return null;

  // Parent ID must be 16 hex chars and not all zeros
  if (!/^[0-9a-f]{16}$/i.test(parentId)) return null;
  if (parentId === '0000000000000000') return null;

  // Flags must be 2 hex chars
  if (!/^[0-9a-f]{2}$/i.test(flags)) return null;

  // Parse sampled flag (bit 0 of flags)
  const sampled = (parseInt(flags, 16) & 0x01) === 1;

  return {
    traceId: traceId.toLowerCase(),
    parentSpanId: parentId.toLowerCase(),
    sampled,
  };
}

/**
 * Build a W3C traceparent header value.
 *
 * @param traceId - 32 hex character trace ID
 * @param spanId - 16 hex character span ID
 * @param sampled - Whether the trace is sampled
 * @returns traceparent header value
 */
export function buildTraceparent(
  traceId: string,
  spanId: string,
  sampled: boolean = true
): string {
  const flags = sampled ? '01' : '00';
  return `00-${traceId}-${spanId}-${flags}`;
}

// =============================================================================
// Context Extraction
// =============================================================================

/**
 * Extract tracing context from HTTP request headers.
 *
 * Priority:
 * 1. W3C traceparent header (preferred, enables APM interoperability)
 * 2. Custom X-Correlation-ID header (fallback for legacy clients)
 * 3. Generate new trace IDs if no headers present
 *
 * @param req - Incoming HTTP request
 * @returns Tracing context with all IDs populated
 */
export function extractTracingContext(req: Request): TracingContext {
  // Try W3C traceparent first
  const traceparent = req.headers.get('traceparent');
  const parsed = parseTraceparent(traceparent);

  let traceId: string;
  let parentSpanId: string | null;
  let sampled: boolean;

  if (parsed) {
    // Use W3C trace context
    traceId = parsed.traceId;
    parentSpanId = parsed.parentSpanId;
    sampled = parsed.sampled;
  } else {
    // Fallback: generate new trace, no parent
    traceId = generateTraceId();
    parentSpanId = null;
    sampled = true; // Default to sampled
  }

  // Generate new span ID for this operation
  const spanId = generateSpanId();

  // Get business correlation ID (prefer header, fallback to trace ID)
  const correlationId =
    req.headers.get('x-correlation-id') || crypto.randomUUID();

  // Get session ID from header (frontend extracts from JWT)
  const sessionId = req.headers.get('x-session-id') || null;

  return {
    correlationId,
    sessionId,
    traceId,
    spanId,
    parentSpanId,
    sampled,
  };
}

// =============================================================================
// Span Management
// =============================================================================

/**
 * Create a new span for an operation.
 *
 * @param context - Tracing context from extractTracingContext()
 * @param operationName - Name of the operation (e.g., 'invite-user')
 * @param serviceName - Service name (default: 'edge-function')
 * @returns New span with start time recorded
 */
export function createSpan(
  context: TracingContext,
  operationName: string,
  serviceName: string = 'edge-function'
): Span {
  return {
    traceId: context.traceId,
    spanId: context.spanId,
    parentSpanId: context.parentSpanId,
    operationName,
    serviceName,
    startTime: Date.now(),
    status: 'ok',
    attributes: {},
    correlationId: context.correlationId,
    sessionId: context.sessionId,
  };
}

/**
 * End a span, recording end time, duration, and status.
 *
 * @param span - The span to end
 * @param status - Final status ('ok' or 'error')
 * @returns The updated span with timing information
 */
export function endSpan(span: Span, status: 'ok' | 'error' = 'ok'): Span {
  const endTime = Date.now();
  return {
    ...span,
    endTime,
    durationMs: endTime - span.startTime,
    status,
  };
}

/**
 * Add an attribute to a span.
 *
 * @param span - The span to add attribute to
 * @param key - Attribute key
 * @param value - Attribute value
 */
export function addSpanAttribute(
  span: Span,
  key: string,
  value: string | number | boolean
): void {
  span.attributes[key] = value;
}

// =============================================================================
// Header Building (for downstream propagation)
// =============================================================================

/**
 * Build headers for downstream request propagation.
 * Use this when calling Backend API or other services.
 *
 * @param context - Tracing context to propagate
 * @returns Headers object for fetch() calls
 */
export function buildTracingHeaders(
  context: TracingContext
): Record<string, string> {
  const headers: Record<string, string> = {
    // W3C standard header (for APM tools)
    traceparent: buildTraceparent(context.traceId, context.spanId, context.sampled),

    // Custom headers (for business correlation)
    'x-correlation-id': context.correlationId,
  };

  // Only include session ID if present
  if (context.sessionId) {
    headers['x-session-id'] = context.sessionId;
  }

  return headers;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Validate a correlation ID is a valid UUID.
 * If invalid, generates a new one.
 *
 * @param correlationId - ID to validate
 * @returns Valid UUID (original if valid, new if invalid)
 */
export function validateCorrelationId(correlationId: string | null): string {
  if (!correlationId) return crypto.randomUUID();

  // UUID regex
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (uuidRegex.test(correlationId)) {
    return correlationId;
  }

  console.warn(
    `[tracing-context] Invalid correlation_id format: ${correlationId}, generating new one`
  );
  return crypto.randomUUID();
}

/**
 * Extract client information from request for audit context.
 *
 * @param req - HTTP request
 * @returns Object with ip_address and user_agent
 */
export function extractClientInfo(req: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  return {
    ipAddress:
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      null,
    userAgent: req.headers.get('user-agent') || null,
  };
}
