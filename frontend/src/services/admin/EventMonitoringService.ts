/**
 * Event Monitoring Service
 *
 * Service for monitoring and managing failed domain events.
 * Platform-owner only - requires super_admin role in the Analytics4Change organization.
 *
 * This service interacts with the following RPC functions:
 * - api.get_failed_events() - Query events with processing errors
 * - api.retry_failed_event() - Clear error and re-process an event
 * - api.get_event_processing_stats() - Get aggregate statistics
 *
 * @see infrastructure/supabase/supabase/migrations/20260107002820_event_processing_observability.sql
 * @see documentation/infrastructure/guides/event-observability.md
 */

import type {
  FailedEvent,
  FailedEventsQueryOptions,
  FailedEventsResult,
  RetryEventResult,
  EventProcessingStats,
  EventMonitoringOperationResult,
  TracedEvent,
  TracedEventsResult,
  TraceSpan,
  TraceTimelineResult,
  EventStreamType,
} from '@/types/event-monitoring.types';
import { supabaseService } from '@/services/auth/supabase.service';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

/**
 * RPC response types (internal)
 */
interface GetFailedEventsRpcResponse {
  id: string;
  stream_id: string;
  stream_type: string;
  event_type: string;
  event_data: Record<string, unknown>;
  event_metadata: Record<string, unknown>;
  processing_error: string;
  created_at: string;
  processed_at: string | null;
}

interface RetryEventRpcResponse {
  success: boolean;
  event_id: string;
  new_error: string | null;
  retried_at: string;
}

interface GetStatsRpcResponse {
  total_failed: number;
  failed_last_24h: number;
  failed_last_7d: number;
  by_event_type: Array<{ event_type: string; count: number }>;
  by_stream_type: Array<{ stream_type: string; count: number }>;
}

interface TracedEventRpcResponse {
  id: string;
  event_type: string;
  stream_id: string;
  stream_type: string;
  event_data: Record<string, unknown>;
  event_metadata: Record<string, unknown>;
  correlation_id: string | null;
  session_id: string | null;
  trace_id: string | null;
  span_id: string | null;
  parent_span_id: string | null;
  created_at: string;
}

interface TraceSpanRpcResponse {
  id: string;
  event_type: string;
  stream_id: string;
  stream_type: string;
  span_id: string | null;
  parent_span_id: string | null;
  service_name: string | null;
  operation_name: string | null;
  duration_ms: number | null;
  status: string | null;
  created_at: string;
  depth: number;
}

/**
 * Event Monitoring Service
 *
 * Provides methods for platform administrators to monitor and manage
 * failed domain event processing.
 */
export class EventMonitoringService {
  /**
   * Get failed events from the database.
   *
   * Returns events where `processing_error IS NOT NULL`, indicating
   * the event trigger processing failed after the event was inserted.
   *
   * @param options - Query options (limit, filters)
   * @returns Promise with list of failed events
   *
   * @example
   * ```typescript
   * const result = await eventMonitoringService.getFailedEvents({
   *   limit: 20,
   *   eventType: 'user.created',
   * });
   * if (result.success) {
   *   console.log(`Found ${result.data.totalCount} failed events`);
   * }
   * ```
   */
  async getFailedEvents(
    options: FailedEventsQueryOptions = {}
  ): Promise<EventMonitoringOperationResult<FailedEventsResult>> {
    try {
      log.info('Fetching failed events', options);

      const { data, error } = await supabaseService.apiRpc<GetFailedEventsRpcResponse[]>(
        'get_failed_events',
        {
          p_limit: options.limit ?? 50,
          p_event_type: options.eventType ?? null,
          p_stream_type: options.streamType ?? null,
          p_since: options.since ?? null,
        }
      );

      if (error) {
        log.error('Failed to fetch failed events', error);

        // Handle permission errors
        if (error.code === '42501' || error.message?.includes('permission denied')) {
          return {
            success: false,
            error: 'Access denied. Platform administrator access required.',
            errorCode: 'FORBIDDEN',
          };
        }

        return {
          success: false,
          error: `Failed to fetch failed events: ${error.message}`,
          errorCode: 'RPC_ERROR',
        };
      }

      const events: FailedEvent[] = (data ?? []).map((row) => ({
        id: row.id,
        stream_id: row.stream_id,
        stream_type: row.stream_type as FailedEvent['stream_type'],
        event_type: row.event_type,
        event_data: row.event_data,
        event_metadata: row.event_metadata as FailedEvent['event_metadata'],
        processing_error: row.processing_error,
        created_at: row.created_at,
        processed_at: row.processed_at,
      }));

      log.info(`Fetched ${events.length} failed events`);

      return {
        success: true,
        data: {
          events,
          totalCount: events.length,
        },
      };
    } catch (error) {
      log.error('Unexpected error fetching failed events', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: 'UNKNOWN',
      };
    }
  }

  /**
   * Retry a failed event by clearing its error and re-triggering processing.
   *
   * This operation:
   * 1. Clears the `processing_error` and `processed_at` columns
   * 2. Updates `event_metadata` with retry info
   * 3. Triggers the event processing trigger via an UPDATE
   *
   * @param eventId - UUID of the event to retry
   * @returns Promise with retry result
   *
   * @example
   * ```typescript
   * const result = await eventMonitoringService.retryFailedEvent(eventId);
   * if (result.success && result.data.success) {
   *   console.log('Event reprocessed successfully');
   * } else {
   *   console.log('Retry failed:', result.data?.new_error);
   * }
   * ```
   */
  async retryFailedEvent(
    eventId: string
  ): Promise<EventMonitoringOperationResult<RetryEventResult>> {
    try {
      log.info('Retrying failed event', { eventId });

      const { data, error } = await supabaseService.apiRpc<RetryEventRpcResponse>(
        'retry_failed_event',
        {
          p_event_id: eventId,
        }
      );

      if (error) {
        log.error('Failed to retry event', { eventId, error });

        // Handle permission errors
        if (error.code === '42501' || error.message?.includes('permission denied')) {
          return {
            success: false,
            error: 'Access denied. Platform administrator access required.',
            errorCode: 'FORBIDDEN',
          };
        }

        // Handle not found
        if (error.code === 'P0002' || error.message?.includes('not found')) {
          return {
            success: false,
            error: 'Event not found or has no processing error.',
            errorCode: 'NOT_FOUND',
          };
        }

        return {
          success: false,
          error: `Failed to retry event: ${error.message}`,
          errorCode: 'RPC_ERROR',
        };
      }

      if (!data) {
        return {
          success: false,
          error: 'No response from retry operation',
          errorCode: 'RPC_ERROR',
        };
      }

      log.info('Event retry completed', {
        eventId,
        success: data.success,
        newError: data.new_error,
      });

      return {
        success: true,
        data: {
          success: data.success,
          event_id: data.event_id,
          new_error: data.new_error,
          retried_at: data.retried_at,
        },
      };
    } catch (error) {
      log.error('Unexpected error retrying event', { eventId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: 'UNKNOWN',
      };
    }
  }

  /**
   * Get event processing statistics.
   *
   * Returns aggregate statistics about failed events including:
   * - Total count of failed events
   * - Failed events in last 24 hours and 7 days
   * - Breakdown by event type
   * - Breakdown by stream type
   *
   * @returns Promise with processing statistics
   *
   * @example
   * ```typescript
   * const result = await eventMonitoringService.getProcessingStats();
   * if (result.success) {
   *   console.log(`Total failed: ${result.data.total_failed}`);
   *   console.log(`Last 24h: ${result.data.failed_last_24h}`);
   * }
   * ```
   */
  async getProcessingStats(): Promise<EventMonitoringOperationResult<EventProcessingStats>> {
    try {
      log.info('Fetching event processing stats');

      const { data, error } = await supabaseService.apiRpc<GetStatsRpcResponse>(
        'get_event_processing_stats',
        {}
      );

      if (error) {
        log.error('Failed to fetch processing stats', error);

        // Handle permission errors
        if (error.code === '42501' || error.message?.includes('permission denied')) {
          return {
            success: false,
            error: 'Access denied. Platform administrator access required.',
            errorCode: 'FORBIDDEN',
          };
        }

        return {
          success: false,
          error: `Failed to fetch stats: ${error.message}`,
          errorCode: 'RPC_ERROR',
        };
      }

      if (!data) {
        // Return empty stats if no data (might be single-row response issue)
        return {
          success: true,
          data: {
            total_failed: 0,
            failed_last_24h: 0,
            failed_last_7d: 0,
            by_event_type: [],
            by_stream_type: [],
          },
        };
      }

      log.info('Processing stats fetched', {
        total: data.total_failed,
        last24h: data.failed_last_24h,
      });

      return {
        success: true,
        data: {
          total_failed: data.total_failed,
          failed_last_24h: data.failed_last_24h,
          failed_last_7d: data.failed_last_7d,
          by_event_type: data.by_event_type ?? [],
          by_stream_type: (data.by_stream_type ?? []).map((s) => ({
            stream_type: s.stream_type as EventProcessingStats['by_stream_type'][0]['stream_type'],
            count: s.count,
          })),
        },
      };
    } catch (error) {
      log.error('Unexpected error fetching processing stats', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: 'UNKNOWN',
      };
    }
  }

  /**
   * Search failed events by correlation ID (legacy client-side filtering).
   *
   * @deprecated Use getEventsByCorrelation() for proper RPC-based search
   * @param correlationId - The correlation ID to search for
   * @returns Promise with matching failed events
   */
  async searchByCorrelationId(
    correlationId: string
  ): Promise<EventMonitoringOperationResult<FailedEventsResult>> {
    try {
      log.info('Searching failed events by correlation ID', { correlationId });

      // Use the main get_failed_events RPC but filter client-side
      const result = await this.getFailedEvents({ limit: 100 });

      if (!result.success || !result.data) {
        return result;
      }

      // Filter by correlation ID in metadata
      const filteredEvents = result.data.events.filter(
        (event) => event.event_metadata?.correlation_id === correlationId
      );

      return {
        success: true,
        data: {
          events: filteredEvents,
          totalCount: filteredEvents.length,
        },
      };
    } catch (error) {
      log.error('Unexpected error searching by correlation ID', { correlationId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: 'UNKNOWN',
      };
    }
  }

  // ============================================================================
  // Tracing Methods (Added Phase 5 - Event Tracing)
  // ============================================================================

  /**
   * Get all events for a specific session.
   *
   * Returns all domain events associated with a user session,
   * useful for debugging user-reported issues.
   *
   * @param sessionId - The session ID (UUID from Supabase Auth JWT)
   * @param limit - Maximum number of events to return (default: 100)
   * @returns Promise with list of traced events
   *
   * @example
   * ```typescript
   * const result = await eventMonitoringService.getEventsBySession(sessionId);
   * if (result.success) {
   *   console.log(`Found ${result.data.totalCount} events for session`);
   * }
   * ```
   */
  async getEventsBySession(
    sessionId: string,
    limit: number = 100
  ): Promise<EventMonitoringOperationResult<TracedEventsResult>> {
    try {
      log.info('Fetching events by session ID', { sessionId, limit });

      const { data, error } = await supabaseService.apiRpc<TracedEventRpcResponse[]>(
        'get_events_by_session',
        {
          p_session_id: sessionId,
          p_limit: limit,
        }
      );

      if (error) {
        log.error('Failed to fetch events by session', { sessionId, error });

        if (error.code === '42501' || error.message?.includes('permission denied')) {
          return {
            success: false,
            error: 'Access denied. Platform administrator access required.',
            errorCode: 'FORBIDDEN',
          };
        }

        return {
          success: false,
          error: `Failed to fetch events: ${error.message}`,
          errorCode: 'RPC_ERROR',
        };
      }

      const events: TracedEvent[] = (data ?? []).map((row) => ({
        id: row.id,
        event_type: row.event_type,
        stream_id: row.stream_id,
        stream_type: row.stream_type as EventStreamType,
        event_data: row.event_data,
        event_metadata: row.event_metadata as TracedEvent['event_metadata'],
        correlation_id: row.correlation_id,
        session_id: row.session_id,
        trace_id: row.trace_id,
        span_id: row.span_id,
        parent_span_id: row.parent_span_id,
        created_at: row.created_at,
      }));

      log.info(`Fetched ${events.length} events for session`, { sessionId });

      return {
        success: true,
        data: {
          events,
          totalCount: events.length,
        },
      };
    } catch (error) {
      log.error('Unexpected error fetching events by session', { sessionId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: 'UNKNOWN',
      };
    }
  }

  /**
   * Get all events for a specific correlation ID.
   *
   * Returns all domain events associated with a single request,
   * useful for tracing a request across services.
   *
   * @param correlationId - The correlation ID (UUID)
   * @param limit - Maximum number of events to return (default: 100)
   * @returns Promise with list of traced events
   *
   * @example
   * ```typescript
   * const result = await eventMonitoringService.getEventsByCorrelation(correlationId);
   * if (result.success) {
   *   console.log(`Found ${result.data.totalCount} events for correlation`);
   * }
   * ```
   */
  async getEventsByCorrelation(
    correlationId: string,
    limit: number = 100
  ): Promise<EventMonitoringOperationResult<TracedEventsResult>> {
    try {
      log.info('Fetching events by correlation ID', { correlationId, limit });

      const { data, error } = await supabaseService.apiRpc<TracedEventRpcResponse[]>(
        'get_events_by_correlation',
        {
          p_correlation_id: correlationId,
          p_limit: limit,
        }
      );

      if (error) {
        log.error('Failed to fetch events by correlation', { correlationId, error });

        if (error.code === '42501' || error.message?.includes('permission denied')) {
          return {
            success: false,
            error: 'Access denied. Platform administrator access required.',
            errorCode: 'FORBIDDEN',
          };
        }

        return {
          success: false,
          error: `Failed to fetch events: ${error.message}`,
          errorCode: 'RPC_ERROR',
        };
      }

      const events: TracedEvent[] = (data ?? []).map((row) => ({
        id: row.id,
        event_type: row.event_type,
        stream_id: row.stream_id,
        stream_type: row.stream_type as EventStreamType,
        event_data: row.event_data,
        event_metadata: row.event_metadata as TracedEvent['event_metadata'],
        correlation_id: row.correlation_id,
        session_id: row.session_id,
        trace_id: row.trace_id,
        span_id: row.span_id,
        parent_span_id: row.parent_span_id,
        created_at: row.created_at,
      }));

      log.info(`Fetched ${events.length} events for correlation`, { correlationId });

      return {
        success: true,
        data: {
          events,
          totalCount: events.length,
        },
      };
    } catch (error) {
      log.error('Unexpected error fetching events by correlation', { correlationId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: 'UNKNOWN',
      };
    }
  }

  /**
   * Get a trace timeline for a specific trace ID.
   *
   * Returns all spans in a distributed trace, ordered by creation time
   * and depth in the span hierarchy. Useful for visualizing the full
   * execution path of a request.
   *
   * @param traceId - The trace ID (32 hex chars, W3C format)
   * @returns Promise with trace timeline containing ordered spans
   *
   * @example
   * ```typescript
   * const result = await eventMonitoringService.getTraceTimeline(traceId);
   * if (result.success) {
   *   result.data.spans.forEach(span => {
   *     const indent = '  '.repeat(span.depth);
   *     console.log(`${indent}${span.operation_name} (${span.duration_ms}ms)`);
   *   });
   * }
   * ```
   */
  async getTraceTimeline(
    traceId: string
  ): Promise<EventMonitoringOperationResult<TraceTimelineResult>> {
    try {
      log.info('Fetching trace timeline', { traceId });

      const { data, error } = await supabaseService.apiRpc<TraceSpanRpcResponse[]>(
        'get_trace_timeline',
        {
          p_trace_id: traceId,
        }
      );

      if (error) {
        log.error('Failed to fetch trace timeline', { traceId, error });

        if (error.code === '42501' || error.message?.includes('permission denied')) {
          return {
            success: false,
            error: 'Access denied. Platform administrator access required.',
            errorCode: 'FORBIDDEN',
          };
        }

        return {
          success: false,
          error: `Failed to fetch trace: ${error.message}`,
          errorCode: 'RPC_ERROR',
        };
      }

      const spans: TraceSpan[] = (data ?? []).map((row) => ({
        id: row.id,
        event_type: row.event_type,
        stream_id: row.stream_id,
        stream_type: row.stream_type as EventStreamType,
        span_id: row.span_id,
        parent_span_id: row.parent_span_id,
        service_name: row.service_name,
        operation_name: row.operation_name,
        duration_ms: row.duration_ms,
        status: row.status as TraceSpan['status'],
        created_at: row.created_at,
        depth: row.depth,
      }));

      log.info(`Fetched ${spans.length} spans for trace`, { traceId });

      return {
        success: true,
        data: {
          trace_id: traceId,
          spans,
          totalSpans: spans.length,
        },
      };
    } catch (error) {
      log.error('Unexpected error fetching trace timeline', { traceId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: 'UNKNOWN',
      };
    }
  }
}

// Export singleton instance
export const eventMonitoringService = new EventMonitoringService();
