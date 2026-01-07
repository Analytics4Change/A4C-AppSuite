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
   * Search failed events by correlation ID.
   *
   * Useful for tracing a specific request across services when
   * debugging failures.
   *
   * @param correlationId - The correlation ID to search for
   * @returns Promise with matching failed events
   */
  async searchByCorrelationId(
    correlationId: string
  ): Promise<EventMonitoringOperationResult<FailedEventsResult>> {
    try {
      log.info('Searching failed events by correlation ID', { correlationId });

      // Use the main get_failed_events RPC but filter client-side
      // In a future enhancement, we could add p_correlation_id parameter to RPC
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
}

// Export singleton instance
export const eventMonitoringService = new EventMonitoringService();
