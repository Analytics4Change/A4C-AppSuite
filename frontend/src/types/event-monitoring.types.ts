/**
 * Event Monitoring Type Definitions
 *
 * Types for the admin event monitoring dashboard that displays
 * failed domain events and provides retry capabilities.
 *
 * These types align with the RPC functions:
 * - api.get_failed_events()
 * - api.retry_failed_event()
 * - api.get_event_processing_stats()
 *
 * @see infrastructure/supabase/supabase/migrations/20260107002820_event_processing_observability.sql
 */

/**
 * Stream types that domain events can belong to.
 * Matches the stream_type column in domain_events table.
 */
export type EventStreamType =
  | 'organization'
  | 'user'
  | 'role'
  | 'invitation'
  | 'contact'
  | 'address'
  | 'phone'
  | 'program'
  | 'medication'
  | 'client';

/**
 * A failed domain event record from the database.
 * Returned by api.get_failed_events() RPC function.
 */
export interface FailedEvent {
  /** Unique event ID (UUID) */
  id: string;
  /** Stream/aggregate ID this event belongs to */
  stream_id: string;
  /** Type of stream (e.g., 'organization', 'user', 'invitation') */
  stream_type: EventStreamType;
  /** Event type (e.g., 'user.created', 'invitation.accepted') */
  event_type: string;
  /** Event payload data (JSON) */
  event_data: Record<string, unknown>;
  /** Event metadata including correlation_id, user_id, etc. */
  event_metadata: FailedEventMetadata;
  /** Error message from processing failure */
  processing_error: string;
  /** When the event was created */
  created_at: string;
  /** When processing was last attempted (null if never processed) */
  processed_at: string | null;
  /** When the event was dismissed (null if not dismissed) */
  dismissed_at: string | null;
  /** User ID who dismissed the event (null if not dismissed) */
  dismissed_by: string | null;
  /** Reason for dismissal (null if not dismissed or no reason provided) */
  dismiss_reason: string | null;
}

/**
 * Metadata attached to domain events.
 * Contains tracing information and audit context.
 */
export interface FailedEventMetadata {
  /** Correlation ID for request tracing across services */
  correlation_id?: string;
  /** User ID who initiated the action */
  user_id?: string;
  /** Organization ID context */
  organization_id?: string;
  /** Session ID from browser */
  session_id?: string;
  /** Source function/service that emitted the event */
  source_function?: string;
  /** IP address of the client (Edge Functions only) */
  ip_address?: string;
  /** User agent string (Edge Functions only) */
  user_agent?: string;
  /** Reason for the action */
  reason?: string;
  /** Whether this was an automated action */
  automated?: boolean;
  /** Additional metadata fields */
  [key: string]: unknown;
}

/**
 * Result of a retry operation.
 * Returned by api.retry_failed_event() RPC function.
 */
export interface RetryEventResult {
  /** Whether the retry was successful */
  success: boolean;
  /** Event ID that was retried */
  event_id: string;
  /** New processing error if retry failed, null if successful */
  new_error: string | null;
  /** Timestamp of the retry attempt */
  retried_at: string;
}

/**
 * Result of a dismiss/undismiss operation.
 * Returned by api.dismiss_failed_event() and api.undismiss_failed_event() RPC functions.
 */
export interface DismissEventResult {
  /** Whether the operation was successful */
  success: boolean;
  /** Success or error message */
  message?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Event processing statistics.
 * Returned by api.get_event_processing_stats() RPC function.
 */
export interface EventProcessingStats {
  /** Total count of failed events (not dismissed) */
  total_failed: number;
  /** Count of failed events in the last 24 hours (not dismissed) */
  failed_last_24h: number;
  /** Count of failed events in the last 7 days */
  failed_last_7d: number;
  /** Total count of dismissed events */
  dismissed_count: number;
  /** Count of events dismissed in the last 24 hours */
  dismissed_last_24h: number;
  /** Breakdown by event type */
  by_event_type: EventTypeStats[];
  /** Breakdown by stream type */
  by_stream_type: StreamTypeStats[];
}

/**
 * Failed event count by event type.
 */
export interface EventTypeStats {
  /** Event type (e.g., 'user.created') */
  event_type: string;
  /** Count of failed events of this type */
  count: number;
}

/**
 * Failed event count by stream type.
 */
export interface StreamTypeStats {
  /** Stream type (e.g., 'organization') */
  stream_type: EventStreamType;
  /** Count of failed events of this stream type */
  count: number;
}

/**
 * Sort column options for failed events.
 */
export type FailedEventsSortBy = 'created_at' | 'event_type';

/**
 * Sort direction options.
 */
export type SortOrder = 'asc' | 'desc';

/**
 * Query options for fetching failed events.
 */
export interface FailedEventsQueryOptions {
  /** Maximum number of events to return (default: 25) */
  limit?: number;
  /** Pagination offset (default: 0) */
  offset?: number;
  /** Filter by specific event type */
  eventType?: string;
  /** Filter by specific stream type */
  streamType?: EventStreamType;
  /** Only return events created after this timestamp */
  since?: string;
  /** Include dismissed events (default: false) */
  includeDismissed?: boolean;
  /** Sort column (default: 'created_at') */
  sortBy?: FailedEventsSortBy;
  /** Sort direction (default: 'desc') */
  sortOrder?: SortOrder;
  /** Search by correlation ID */
  correlationId?: string;
}

/**
 * Result of fetching failed events with pagination info.
 */
export interface FailedEventsResult {
  /** List of failed events */
  events: FailedEvent[];
  /** Total count of matching events (for pagination) */
  totalCount: number;
}

/**
 * Error codes specific to event monitoring operations.
 */
export type EventMonitoringErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RPC_ERROR'
  | 'UNKNOWN';

/**
 * Result of an event monitoring operation.
 */
export interface EventMonitoringOperationResult<T = void> {
  /** Whether the operation succeeded */
  success: boolean;
  /** Result data (if successful) */
  data?: T;
  /** Error message (if failed) */
  error?: string;
  /** Error code for programmatic handling */
  errorCode?: EventMonitoringErrorCode;
}

// ============================================================================
// Tracing Types (Added Phase 5 - Event Tracing)
// ============================================================================

/**
 * A domain event with tracing information.
 * Returned by api.get_events_by_session() and api.get_events_by_correlation() RPC functions.
 */
export interface TracedEvent {
  /** Unique event ID (UUID) */
  id: string;
  /** Event type (e.g., 'user.created', 'invitation.accepted') */
  event_type: string;
  /** Stream/aggregate ID this event belongs to */
  stream_id: string;
  /** Type of stream (e.g., 'organization', 'user', 'invitation') */
  stream_type: EventStreamType;
  /** Event payload data (JSON) */
  event_data: Record<string, unknown>;
  /** Event metadata including correlation_id, user_id, etc. */
  event_metadata: FailedEventMetadata;
  /** Correlation ID for request tracing across services (UUID) */
  correlation_id: string | null;
  /** Session ID from browser/auth (UUID) */
  session_id: string | null;
  /** W3C trace ID (32 hex chars) */
  trace_id: string | null;
  /** Span ID for this operation (16 hex chars) */
  span_id: string | null;
  /** Parent span ID for causation chain (16 hex chars) */
  parent_span_id: string | null;
  /** When the event was created */
  created_at: string;
}

/**
 * Result of fetching traced events.
 */
export interface TracedEventsResult {
  /** List of traced events */
  events: TracedEvent[];
  /** Total count of matching events */
  totalCount: number;
}

/**
 * A span in a trace timeline.
 * Returned by api.get_trace_timeline() RPC function.
 * Represents a single operation within a distributed trace.
 */
export interface TraceSpan {
  /** Unique event ID (UUID) */
  id: string;
  /** Event type (e.g., 'organization.created') */
  event_type: string;
  /** Stream/aggregate ID */
  stream_id: string;
  /** Type of stream */
  stream_type: EventStreamType;
  /** Span ID for this operation (16 hex chars) */
  span_id: string | null;
  /** Parent span ID (16 hex chars) */
  parent_span_id: string | null;
  /** Service that generated this span (e.g., 'temporal-worker', 'edge-function') */
  service_name: string | null;
  /** Operation name (e.g., 'createOrganization', 'configureDNS') */
  operation_name: string | null;
  /** Duration of the operation in milliseconds */
  duration_ms: number | null;
  /** Span status ('ok', 'error') */
  status: 'ok' | 'error' | null;
  /** When the span was created */
  created_at: string;
  /** Depth in the trace tree (0 = root, 1 = child of root, etc.) */
  depth: number;
}

/**
 * Result of fetching a trace timeline.
 */
export interface TraceTimelineResult {
  /** Trace ID (32 hex chars) */
  trace_id: string;
  /** Ordered list of spans in the trace */
  spans: TraceSpan[];
  /** Total span count */
  totalSpans: number;
}
