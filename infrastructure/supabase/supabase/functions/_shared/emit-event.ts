/**
 * Domain Event Emission Helper - Edge Functions
 *
 * Provides standardized domain event emission with automatic tracing context.
 * All events emitted through this module include correlation_id, session_id,
 * and W3C trace context for end-to-end request tracing.
 *
 * Features:
 * - Automatic tracing context injection
 * - Client IP and User-Agent extraction for audit
 * - Safe wrapper that never throws (tracing is non-critical)
 * - Span ID generation for event causation chain
 *
 * Usage:
 *   import { emitDomainEvent, safeEmitEvent } from '../_shared/emit-event.ts';
 *   import { extractTracingContext, createSpan, endSpan } from '../_shared/tracing-context.ts';
 *
 *   const context = extractTracingContext(req);
 *   const span = createSpan(context, 'invite-user');
 *
 *   // Emit event with full tracing
 *   const { eventId, error } = await emitDomainEvent(supabase, {
 *     streamId: userId,
 *     streamType: 'user',
 *     eventType: 'user.created',
 *     eventData: { user_id: userId, email },
 *   }, context, req);
 *
 *   // Or use safe wrapper (never throws)
 *   const eventId = await safeEmitEvent(supabase, params, context, req);
 *
 * @see _shared/tracing-context.ts - Tracing context extraction and span management
 * @see documentation/infrastructure/guides/event-observability.md
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { TracingContext, Span } from './tracing-context.ts';
import { generateSpanId } from './tracing-context.ts';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for emitting a domain event.
 */
export interface EmitEventParams {
  /** UUID of the aggregate (e.g., user_id, role_id) */
  streamId: string;

  /** Type of aggregate (e.g., 'user', 'role', 'invitation') */
  streamType: string;

  /** Event type following AsyncAPI contract (e.g., 'user.created') */
  eventType: string;

  /** Event payload (business data) */
  eventData: Record<string, unknown>;

  /** Additional metadata (merged with tracing context) */
  additionalMetadata?: Record<string, unknown>;
}

/**
 * Result of emitting a domain event.
 */
export interface EmitEventResult {
  /** Event ID if successful, null if failed */
  eventId: string | null;

  /** Error if failed, null if successful */
  error: Error | null;

  /** The span ID generated for this event */
  spanId: string;
}

/**
 * Client information extracted from request for audit context.
 */
export interface ClientInfo {
  ipAddress: string | null;
  userAgent: string | null;
}

// =============================================================================
// Client Info Extraction
// =============================================================================

/**
 * Extract client information from HTTP request for audit context.
 * Includes IP address and User-Agent from headers.
 *
 * @param req - HTTP request
 * @returns Client info object
 */
export function extractClientInfo(req: Request): ClientInfo {
  return {
    ipAddress:
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      null,
    userAgent: req.headers.get('user-agent') || null,
  };
}

// =============================================================================
// Event Emission
// =============================================================================

/**
 * Emit a domain event with full tracing context.
 *
 * This function:
 * 1. Generates a new span ID for this event
 * 2. Builds metadata with tracing fields
 * 3. Includes client IP and User-Agent for audit
 * 4. Calls api.emit_domain_event RPC
 *
 * @param supabase - Supabase client (must use 'api' schema)
 * @param params - Event parameters
 * @param context - Tracing context from extractTracingContext()
 * @param req - Original HTTP request (for client info extraction)
 * @returns Result with eventId or error
 */
export async function emitDomainEvent(
  supabase: SupabaseClient,
  params: EmitEventParams,
  context: TracingContext,
  req?: Request
): Promise<EmitEventResult> {
  // Generate new span ID for this specific event
  const eventSpanId = generateSpanId();

  // Extract client info for audit trail
  const clientInfo = req ? extractClientInfo(req) : { ipAddress: null, userAgent: null };

  // Build comprehensive metadata
  const eventMetadata: Record<string, unknown> = {
    // Tracing context (extracted to columns by emit_domain_event)
    correlation_id: context.correlationId,
    session_id: context.sessionId,
    trace_id: context.traceId,
    span_id: eventSpanId,
    parent_span_id: context.spanId, // Current span becomes parent

    // Audit context
    ip_address: clientInfo.ipAddress,
    user_agent: clientInfo.userAgent,

    // Service identification
    service_name: 'edge-function',
    operation_name: params.eventType,

    // Merge additional metadata
    ...params.additionalMetadata,
  };

  try {
    const { data: eventId, error } = await supabase.rpc('emit_domain_event', {
      p_stream_id: params.streamId,
      p_stream_type: params.streamType,
      p_event_type: params.eventType,
      p_event_data: params.eventData,
      p_event_metadata: eventMetadata,
    });

    if (error) {
      console.error(
        `[emit-event] Failed to emit ${params.eventType}:`,
        error,
        `correlation_id=${context.correlationId}`
      );
      return {
        eventId: null,
        error: new Error(error.message),
        spanId: eventSpanId,
      };
    }

    console.log(
      `[emit-event] ✓ ${params.eventType} emitted:`,
      `event_id=${eventId}`,
      `stream_id=${params.streamId}`,
      `correlation_id=${context.correlationId}`,
      `trace_id=${context.traceId}`
    );

    return {
      eventId: eventId as string,
      error: null,
      spanId: eventSpanId,
    };
  } catch (err) {
    console.error(
      `[emit-event] Exception emitting ${params.eventType}:`,
      err,
      `correlation_id=${context.correlationId}`
    );
    return {
      eventId: null,
      error: err instanceof Error ? err : new Error(String(err)),
      spanId: eventSpanId,
    };
  }
}

/**
 * Safely emit a domain event without throwing.
 * Use this when event emission is non-critical and shouldn't fail the request.
 *
 * @param supabase - Supabase client (must use 'api' schema)
 * @param params - Event parameters
 * @param context - Tracing context from extractTracingContext()
 * @param req - Original HTTP request (for client info extraction)
 * @returns Event ID if successful, null if failed
 */
export async function safeEmitEvent(
  supabase: SupabaseClient,
  params: EmitEventParams,
  context: TracingContext,
  req?: Request
): Promise<string | null> {
  try {
    const result = await emitDomainEvent(supabase, params, context, req);
    return result.eventId;
  } catch (err) {
    console.error(
      `[emit-event] safeEmitEvent caught exception for ${params.eventType}:`,
      err,
      `correlation_id=${context.correlationId}`
    );
    return null;
  }
}

/**
 * Emit multiple domain events in sequence.
 * Useful for workflows that emit several related events.
 *
 * @param supabase - Supabase client (must use 'api' schema)
 * @param events - Array of event parameters
 * @param context - Tracing context from extractTracingContext()
 * @param req - Original HTTP request (for client info extraction)
 * @returns Array of results, one per event
 */
export async function emitMultipleEvents(
  supabase: SupabaseClient,
  events: EmitEventParams[],
  context: TracingContext,
  req?: Request
): Promise<EmitEventResult[]> {
  const results: EmitEventResult[] = [];

  for (const params of events) {
    const result = await emitDomainEvent(supabase, params, context, req);
    results.push(result);

    // If an event fails, continue with others but log warning
    if (result.error) {
      console.warn(
        `[emit-event] Event ${params.eventType} failed, continuing with remaining events`
      );
    }
  }

  return results;
}

/**
 * Build metadata object for manual RPC calls.
 * Use this if you need to call emit_domain_event directly with custom parameters.
 *
 * @param context - Tracing context
 * @param operationName - Name of the operation (usually event type)
 * @param req - Optional request for client info
 * @param additionalMetadata - Additional fields to include
 * @returns Metadata object ready for emit_domain_event
 */
export function buildEventMetadata(
  context: TracingContext,
  operationName: string,
  req?: Request,
  additionalMetadata?: Record<string, unknown>
): Record<string, unknown> {
  const clientInfo = req ? extractClientInfo(req) : { ipAddress: null, userAgent: null };

  return {
    correlation_id: context.correlationId,
    session_id: context.sessionId,
    trace_id: context.traceId,
    span_id: generateSpanId(),
    parent_span_id: context.spanId,
    ip_address: clientInfo.ipAddress,
    user_agent: clientInfo.userAgent,
    service_name: 'edge-function',
    operation_name: operationName,
    ...additionalMetadata,
  };
}
