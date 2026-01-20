/**
 * Failed Events Admin Page
 *
 * Platform-owner admin dashboard for monitoring and managing failed domain events.
 * Displays events where processing errors occurred, with retry capabilities.
 *
 * Access Control:
 * - Requires super_admin role in Analytics4Change organization
 * - RPC functions enforce platform-owner check
 *
 * Features:
 * - Stats summary (total failures, last 24h, last 7d)
 * - Filterable event list by type and stream type
 * - Search by correlation ID for request tracing
 * - Expandable event details (data, metadata, error)
 * - Retry failed events individually
 * - Auto-refresh toggle
 *
 * Route: /admin/events
 * Permission: Platform-owner only (super_admin in A4C org)
 *
 * @see services/admin/EventMonitoringService.ts
 * @see documentation/infrastructure/guides/event-observability.md
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  eventMonitoringService,
} from '@/services/admin/EventMonitoringService';
import type {
  FailedEvent,
  EventProcessingStats,
  EventStreamType,
  FailedEventsSortBy,
  SortOrder,
} from '@/types/event-monitoring.types';
import {
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronLeft,
  RotateCcw,
  Search,
  Filter,
  CheckCircle,
  XCircle,
  Clock,
  Copy,
  Link2,
  EyeOff,
  Eye,
  Archive,
  ArrowUpDown,
} from 'lucide-react';
import { Logger } from '@/utils/logger';
import { cn } from '@/components/ui/utils';

const log = Logger.getLogger('component');

/**
 * Copy button component for copying values to clipboard
 */
interface CopyButtonProps {
  value: string;
  label: string;
}

const CopyButton: React.FC<CopyButtonProps> = ({ value, label }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      log.error('Failed to copy to clipboard', { err });
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="ml-2 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
      title={`Copy ${label}`}
      aria-label={`Copy ${label} to clipboard`}
    >
      {copied ? (
        <CheckCircle className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
};

/**
 * Stat card component for displaying summary metrics
 */
interface StatCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  variant?: 'default' | 'warning' | 'danger';
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon, variant = 'default' }) => (
  <Card
    className={cn(
      'transition-colors',
      variant === 'danger' && 'border-red-300 bg-red-50',
      variant === 'warning' && 'border-yellow-300 bg-yellow-50'
    )}
  >
    <CardContent className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        <div
          className={cn(
            'p-2 rounded-full',
            variant === 'danger' && 'bg-red-100 text-red-600',
            variant === 'warning' && 'bg-yellow-100 text-yellow-600',
            variant === 'default' && 'bg-gray-100 text-gray-600'
          )}
        >
          {icon}
        </div>
      </div>
    </CardContent>
  </Card>
);

/**
 * Expandable event row component
 */
interface EventRowProps {
  event: FailedEvent;
  isExpanded: boolean;
  onToggle: () => void;
  onRetry: () => Promise<void>;
  onDismiss: (reason?: string) => Promise<void>;
  onUndismiss: () => Promise<void>;
  isRetrying: boolean;
  isDismissing: boolean;
}

const EventRow: React.FC<EventRowProps> = ({
  event,
  isExpanded,
  onToggle,
  onRetry,
  onDismiss,
  onUndismiss,
  isRetrying,
  isDismissing,
}) => {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const isDismissed = Boolean(event.dismissed_at);

  return (
    <div className={cn(
      "border-b border-gray-200 last:border-b-0",
      isDismissed && "bg-gray-50"
    )}>
      {/* Main row */}
      <div
        className={cn(
          "flex items-center px-4 py-3 cursor-pointer",
          isDismissed ? "hover:bg-gray-100" : "hover:bg-gray-50"
        )}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <div className="w-6">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-gray-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-500" />
          )}
        </div>

        <div className="flex-1 grid grid-cols-5 gap-4 items-center">
          <div className="truncate" title={event.event_type}>
            <span className={cn("font-mono text-sm", isDismissed && "text-gray-400")}>
              {event.event_type}
            </span>
            {isDismissed && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-600">
                <Archive className="h-3 w-3 mr-1" />
                Dismissed
              </span>
            )}
          </div>
          <div className={cn("text-sm", isDismissed ? "text-gray-400" : "text-gray-600")}>
            {event.stream_type}
          </div>
          <div className={cn("text-sm truncate", isDismissed ? "text-gray-400" : "text-gray-600")} title={event.stream_id}>
            {event.stream_id.slice(0, 8)}...
          </div>
          <div className={cn("text-sm", isDismissed ? "text-gray-400" : "text-gray-600")}>
            {formatDate(event.created_at)}
          </div>
          <div className={cn("text-sm truncate", isDismissed ? "text-gray-400" : "text-red-600")} title={event.processing_error}>
            {event.processing_error.slice(0, 40)}...
          </div>
        </div>

        <div className="ml-4 flex gap-2">
          {isDismissed ? (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onUndismiss();
              }}
              disabled={isDismissing}
              aria-label={`Undismiss event ${event.id}`}
            >
              {isDismissing ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
              <span className="ml-1">Restore</span>
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry();
                }}
                disabled={isRetrying}
                aria-label={`Retry event ${event.id}`}
              >
                {isRetrying ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                <span className="ml-1">Retry</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss();
                }}
                disabled={isDismissing}
                className="text-gray-500 hover:text-gray-700"
                aria-label={`Dismiss event ${event.id}`}
              >
                {isDismissing ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <EyeOff className="h-4 w-4" />
                )}
                <span className="ml-1">Dismiss</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-10 py-4 bg-gray-50 border-t border-gray-200">
          <div className="grid grid-cols-2 gap-6">
            {/* Event Info */}
            <div>
              <h4 className="font-semibold text-sm text-gray-700 mb-2">Event Info</h4>
              <div className="space-y-1 text-sm">
                <div className="flex items-center">
                  <span className="text-gray-500">ID:</span>{' '}
                  <span className="font-mono ml-1">{event.id}</span>
                  <CopyButton value={event.id} label="Event ID" />
                </div>
                <div className="flex items-center">
                  <span className="text-gray-500">Stream ID:</span>{' '}
                  <span className="font-mono ml-1">{event.stream_id}</span>
                  <CopyButton value={event.stream_id} label="Stream ID" />
                </div>
                <div>
                  <span className="text-gray-500">Processed At:</span>{' '}
                  {event.processed_at ? formatDate(event.processed_at) : 'Never'}
                </div>
              </div>
            </div>

            {/* Tracing Info */}
            <div>
              <h4 className="font-semibold text-sm text-gray-700 mb-2 flex items-center gap-1">
                <Link2 className="h-4 w-4" />
                Tracing
              </h4>
              <div className="space-y-1 text-sm">
                {event.event_metadata?.correlation_id && (
                  <div className="flex items-center">
                    <span className="text-gray-500">Correlation ID:</span>{' '}
                    <span className="font-mono ml-1 text-blue-600">
                      {String(event.event_metadata.correlation_id).slice(0, 8)}...
                    </span>
                    <CopyButton value={String(event.event_metadata.correlation_id)} label="Correlation ID" />
                  </div>
                )}
                {event.event_metadata?.session_id && (
                  <div className="flex items-center">
                    <span className="text-gray-500">Session ID:</span>{' '}
                    <span className="font-mono ml-1 text-purple-600">
                      {String(event.event_metadata.session_id).slice(0, 8)}...
                    </span>
                    <CopyButton value={String(event.event_metadata.session_id)} label="Session ID" />
                  </div>
                )}
                {Boolean(event.event_metadata?.trace_id) && (
                  <div className="flex items-center">
                    <span className="text-gray-500">Trace ID:</span>{' '}
                    <span className="font-mono ml-1 text-green-600">
                      {String(event.event_metadata.trace_id).slice(0, 8)}...
                    </span>
                    <CopyButton value={String(event.event_metadata.trace_id)} label="Trace ID" />
                  </div>
                )}
                {Boolean(event.event_metadata?.span_id) && (
                  <div className="flex items-center">
                    <span className="text-gray-500">Span ID:</span>{' '}
                    <span className="font-mono ml-1">{String(event.event_metadata.span_id)}</span>
                    <CopyButton value={String(event.event_metadata.span_id)} label="Span ID" />
                  </div>
                )}
                {Boolean(event.event_metadata?.parent_span_id) && (
                  <div className="flex items-center">
                    <span className="text-gray-500">Parent Span:</span>{' '}
                    <span className="font-mono ml-1">{String(event.event_metadata.parent_span_id)}</span>
                    <CopyButton value={String(event.event_metadata.parent_span_id)} label="Parent Span ID" />
                  </div>
                )}
                {!event.event_metadata?.correlation_id &&
                  !event.event_metadata?.session_id &&
                  !event.event_metadata?.trace_id && (
                    <p className="text-gray-400 italic">No tracing data available</p>
                  )}
              </div>
            </div>
          </div>

          {/* Audit Context */}
          <div className="mt-4">
            <h4 className="font-semibold text-sm text-gray-700 mb-2">Audit Context</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {event.event_metadata?.user_id && (
                <div className="flex items-center">
                  <span className="text-gray-500">User ID:</span>{' '}
                  <span className="font-mono ml-1">{String(event.event_metadata.user_id).slice(0, 8)}...</span>
                  <CopyButton value={String(event.event_metadata.user_id)} label="User ID" />
                </div>
              )}
              {event.event_metadata?.source_function && (
                <div>
                  <span className="text-gray-500">Source:</span>{' '}
                  <span className="ml-1">{String(event.event_metadata.source_function)}</span>
                </div>
              )}
              {event.event_metadata?.reason && (
                <div>
                  <span className="text-gray-500">Reason:</span>{' '}
                  <span className="ml-1">{String(event.event_metadata.reason)}</span>
                </div>
              )}
              {event.event_metadata?.ip_address && (
                <div>
                  <span className="text-gray-500">IP Address:</span>{' '}
                  <span className="font-mono ml-1">{String(event.event_metadata.ip_address)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Dismissed Info (if dismissed) */}
          {isDismissed && (
            <div className="mt-4">
              <h4 className="font-semibold text-sm text-gray-700 mb-2 flex items-center gap-1">
                <Archive className="h-4 w-4" />
                Dismissed
              </h4>
              <div className="p-3 bg-gray-100 rounded border text-sm">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-gray-500">Dismissed At:</span>{' '}
                    <span className="ml-1">{formatDate(event.dismissed_at!)}</span>
                  </div>
                  {event.dismissed_by && (
                    <div className="flex items-center">
                      <span className="text-gray-500">Dismissed By:</span>{' '}
                      <span className="font-mono ml-1">{event.dismissed_by.slice(0, 8)}...</span>
                      <CopyButton value={event.dismissed_by} label="Dismissed By" />
                    </div>
                  )}
                </div>
                {event.dismiss_reason && (
                  <div className="mt-2">
                    <span className="text-gray-500">Reason:</span>{' '}
                    <span className="ml-1">{event.dismiss_reason}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Processing Error */}
          <div className="mt-4">
            <h4 className="font-semibold text-sm text-gray-700 mb-2">Processing Error</h4>
            <pre className="text-sm bg-red-50 text-red-700 p-3 rounded border border-red-200 overflow-x-auto">
              {event.processing_error}
            </pre>
          </div>

          {/* Event Data */}
          <div className="mt-4">
            <h4 className="font-semibold text-sm text-gray-700 mb-2">Event Data</h4>
            <pre className="text-sm bg-gray-100 p-3 rounded border overflow-x-auto max-h-48">
              {JSON.stringify(event.event_data, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Failed Events Admin Page
 */
export const FailedEventsPage: React.FC = () => {
  // Stats state
  const [stats, setStats] = useState<EventProcessingStats | null>(null);
  const [_statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Events state
  const [events, setEvents] = useState<FailedEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);

  // Filters
  const [correlationSearch, setCorrelationSearch] = useState('');
  const [sessionSearch, setSessionSearch] = useState('');
  const [traceSearch, setTraceSearch] = useState('');
  const [searchType, setSearchType] = useState<'correlation' | 'session' | 'trace' | null>(null);
  const [eventTypeFilter, setEventTypeFilter] = useState<string | null>(null);
  const [streamTypeFilter, setStreamTypeFilter] = useState<EventStreamType | null>(null);
  const [statusFilter, setStatusFilter] = useState<'failed' | 'dismissed' | 'all'>('failed');

  // Sorting
  const [sortBy, setSortBy] = useState<FailedEventsSortBy>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Pagination
  const PAGE_SIZE = 25;
  const [offset, setOffset] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // UI state
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [retryingEventId, setRetryingEventId] = useState<string | null>(null);
  const [dismissingEventId, setDismissingEventId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Load stats
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const result = await eventMonitoringService.getProcessingStats();
      if (result.success && result.data) {
        setStats(result.data);
      } else {
        setStatsError(result.error ?? 'Failed to load stats');
      }
    } catch (error) {
      setStatsError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // Load events
  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError(null);
    try {
      // Handle search by tracing IDs
      if (searchType === 'session' && sessionSearch.trim()) {
        const result = await eventMonitoringService.getEventsBySession(sessionSearch.trim());
        if (result.success && result.data) {
          // Convert TracedEvent[] to FailedEvent[] for display
          // The service returns all events (not just failed), filter to show in list
          const failedStyleEvents: FailedEvent[] = result.data.events.map((e) => ({
            id: e.id,
            stream_id: e.stream_id,
            stream_type: e.stream_type,
            event_type: e.event_type,
            event_data: e.event_data,
            event_metadata: e.event_metadata,
            processing_error: 'N/A - Showing all events for session',
            created_at: e.created_at,
            processed_at: null,
            dismissed_at: null,
            dismissed_by: null,
            dismiss_reason: null,
          }));
          setEvents(failedStyleEvents);
        } else {
          setEventsError(result.error ?? 'Failed to search by session');
        }
      } else if (searchType === 'correlation' && correlationSearch.trim()) {
        const result = await eventMonitoringService.getEventsByCorrelation(correlationSearch.trim());
        if (result.success && result.data) {
          const failedStyleEvents: FailedEvent[] = result.data.events.map((e) => ({
            id: e.id,
            stream_id: e.stream_id,
            stream_type: e.stream_type,
            event_type: e.event_type,
            event_data: e.event_data,
            event_metadata: e.event_metadata,
            processing_error: 'N/A - Showing all events for correlation',
            created_at: e.created_at,
            processed_at: null,
            dismissed_at: null,
            dismissed_by: null,
            dismiss_reason: null,
          }));
          setEvents(failedStyleEvents);
        } else {
          setEventsError(result.error ?? 'Failed to search by correlation');
        }
      } else if (searchType === 'trace' && traceSearch.trim()) {
        const result = await eventMonitoringService.getTraceTimeline(traceSearch.trim());
        if (result.success && result.data) {
          // Convert TraceSpan[] to FailedEvent[] for display
          const failedStyleEvents: FailedEvent[] = result.data.spans.map((span) => ({
            id: span.id,
            stream_id: span.stream_id,
            stream_type: span.stream_type,
            event_type: span.event_type,
            event_data: {},
            event_metadata: {
              trace_id: result.data!.trace_id,
              span_id: span.span_id ?? undefined,
              parent_span_id: span.parent_span_id ?? undefined,
              service_name: span.service_name ?? undefined,
              operation_name: span.operation_name ?? undefined,
            },
            processing_error: span.status === 'error' ? 'Error status in trace' : 'N/A - Trace span',
            created_at: span.created_at,
            processed_at: null,
            dismissed_at: null,
            dismissed_by: null,
            dismiss_reason: null,
          }));
          setEvents(failedStyleEvents);
        } else {
          setEventsError(result.error ?? 'Failed to fetch trace');
        }
      } else {
        // Default: load failed events with filters, sorting, and pagination
        const result = await eventMonitoringService.getFailedEvents({
          limit: PAGE_SIZE,
          offset,
          eventType: eventTypeFilter ?? undefined,
          streamType: streamTypeFilter ?? undefined,
          includeDismissed: statusFilter === 'dismissed' || statusFilter === 'all',
          sortBy,
          sortOrder,
        });

        if (result.success && result.data) {
          // For "dismissed" filter, only show dismissed events
          // For "failed" filter (default), only show non-dismissed
          // For "all", show everything
          let filteredEvents = result.data.events;
          if (statusFilter === 'dismissed') {
            filteredEvents = result.data.events.filter((e) => e.dismissed_at !== null);
          } else if (statusFilter === 'failed') {
            filteredEvents = result.data.events.filter((e) => e.dismissed_at === null);
          }
          setEvents(filteredEvents);
          setTotalCount(result.data.totalCount);
        } else {
          setEventsError(result.error ?? 'Failed to load events');
        }
      }
    } catch (error) {
      setEventsError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setEventsLoading(false);
      setLastRefresh(new Date());
    }
  }, [correlationSearch, sessionSearch, traceSearch, searchType, eventTypeFilter, streamTypeFilter, statusFilter, sortBy, sortOrder, offset]);

  // Load data on mount and filter change
  useEffect(() => {
    loadStats();
    loadEvents();
  }, [loadStats, loadEvents]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadStats();
      loadEvents();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [autoRefresh, loadStats, loadEvents]);

  // Handle retry
  const handleRetry = useCallback(
    async (eventId: string) => {
      setRetryingEventId(eventId);
      try {
        const result = await eventMonitoringService.retryFailedEvent(eventId);
        if (result.success && result.data) {
          if (result.data.success) {
            // Remove from list if successful
            setEvents((prev) => prev.filter((e) => e.id !== eventId));
            log.info('Event retry successful', { eventId });
          } else {
            // Update error message
            setEvents((prev) =>
              prev.map((e) =>
                e.id === eventId
                  ? { ...e, processing_error: result.data!.new_error ?? e.processing_error }
                  : e
              )
            );
            log.warn('Event retry failed again', { eventId, error: result.data.new_error });
          }
        } else {
          log.error('Retry operation failed', { eventId, error: result.error });
        }
      } finally {
        setRetryingEventId(null);
        // Refresh stats
        loadStats();
      }
    },
    [loadStats]
  );

  // Handle dismiss
  const handleDismiss = useCallback(
    async (eventId: string, reason?: string) => {
      setDismissingEventId(eventId);
      try {
        const result = await eventMonitoringService.dismissFailedEvent(eventId, reason);
        if (result.success && result.data?.success) {
          // Update event in list with dismissed status
          setEvents((prev) =>
            prev.map((e) =>
              e.id === eventId
                ? {
                    ...e,
                    dismissed_at: new Date().toISOString(),
                    dismissed_by: 'current-user', // Will be from session in real usage
                    dismiss_reason: reason ?? null,
                  }
                : e
            )
          );
          log.info('Event dismissed', { eventId });
          // Refresh to get updated list
          loadEvents();
          loadStats();
        } else {
          log.error('Dismiss operation failed', { eventId, error: result.data?.error || result.error });
        }
      } finally {
        setDismissingEventId(null);
      }
    },
    [loadEvents, loadStats]
  );

  // Handle undismiss
  const handleUndismiss = useCallback(
    async (eventId: string) => {
      setDismissingEventId(eventId);
      try {
        const result = await eventMonitoringService.undismissFailedEvent(eventId);
        if (result.success && result.data?.success) {
          // Update event in list to remove dismissed status
          setEvents((prev) =>
            prev.map((e) =>
              e.id === eventId
                ? {
                    ...e,
                    dismissed_at: null,
                    dismissed_by: null,
                    dismiss_reason: null,
                  }
                : e
            )
          );
          log.info('Event undismissed', { eventId });
          // Refresh to get updated list
          loadEvents();
          loadStats();
        } else {
          log.error('Undismiss operation failed', { eventId, error: result.data?.error || result.error });
        }
      } finally {
        setDismissingEventId(null);
      }
    },
    [loadEvents, loadStats]
  );

  // Toggle sort column
  const toggleSort = useCallback((column: FailedEventsSortBy) => {
    if (sortBy === column) {
      // Toggle sort order
      setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      // New column, default to descending
      setSortBy(column);
      setSortOrder('desc');
    }
    // Reset to first page when sorting changes
    setOffset(0);
  }, [sortBy]);

  // Manual refresh
  const handleRefresh = () => {
    loadStats();
    loadEvents();
  };

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [eventTypeFilter, streamTypeFilter, statusFilter, searchType]);

  // Get unique event types from events for filter dropdown
  const eventTypes = [...new Set(events.map((e) => e.event_type))].sort();

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Failed Events Monitor</h1>
          <p className="text-sm text-gray-500 mt-1">
            Platform admin dashboard for event processing observability
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-300"
            />
            Auto-refresh
          </label>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className={cn('h-4 w-4 mr-2', eventsLoading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {statsError ? (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
          <AlertTriangle className="h-5 w-5" />
          <span>{statsError}</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
          <StatCard
            title="Total Failed Events"
            value={stats?.total_failed ?? 0}
            icon={<XCircle className="h-5 w-5" />}
            variant={stats?.total_failed && stats.total_failed > 0 ? 'danger' : 'default'}
          />
          <StatCard
            title="Failed (24h)"
            value={stats?.failed_last_24h ?? 0}
            icon={<Clock className="h-5 w-5" />}
            variant={stats?.failed_last_24h && stats.failed_last_24h > 0 ? 'warning' : 'default'}
          />
          <StatCard
            title="Dismissed"
            value={stats?.dismissed_count ?? 0}
            icon={<Archive className="h-5 w-5" />}
            variant="default"
          />
          <StatCard
            title="Dismissed (24h)"
            value={stats?.dismissed_last_24h ?? 0}
            icon={<EyeOff className="h-5 w-5" />}
            variant="default"
          />
          <StatCard
            title="Event Types"
            value={stats?.by_event_type?.length ?? 0}
            icon={<AlertTriangle className="h-5 w-5" />}
            variant="default"
          />
        </div>
      )}

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Search Type Selector */}
            <div className="min-w-[150px]">
              <select
                value={searchType ?? ''}
                onChange={(e) => {
                  const newType = (e.target.value || null) as typeof searchType;
                  setSearchType(newType);
                  // Clear other search fields when switching
                  if (newType !== 'correlation') setCorrelationSearch('');
                  if (newType !== 'session') setSessionSearch('');
                  if (newType !== 'trace') setTraceSearch('');
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                aria-label="Search type"
              >
                <option value="">Failed Events (default)</option>
                <option value="correlation">Search by Correlation ID</option>
                <option value="session">Search by Session ID</option>
                <option value="trace">Search by Trace ID</option>
              </select>
            </div>

            {/* Dynamic Search Input based on search type */}
            {searchType === 'correlation' && (
              <div className="flex-1 min-w-[250px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-500" />
                  <Input
                    type="text"
                    placeholder="Enter correlation ID (UUID)..."
                    value={correlationSearch}
                    onChange={(e) => setCorrelationSearch(e.target.value)}
                    className="pl-10 border-blue-300 focus:border-blue-500"
                  />
                </div>
              </div>
            )}

            {searchType === 'session' && (
              <div className="flex-1 min-w-[250px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-purple-500" />
                  <Input
                    type="text"
                    placeholder="Enter session ID (UUID)..."
                    value={sessionSearch}
                    onChange={(e) => setSessionSearch(e.target.value)}
                    className="pl-10 border-purple-300 focus:border-purple-500"
                  />
                </div>
              </div>
            )}

            {searchType === 'trace' && (
              <div className="flex-1 min-w-[250px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />
                  <Input
                    type="text"
                    placeholder="Enter trace ID (32 hex chars)..."
                    value={traceSearch}
                    onChange={(e) => setTraceSearch(e.target.value)}
                    className="pl-10 border-green-300 focus:border-green-500"
                  />
                </div>
              </div>
            )}

            {/* Show type filters only when not searching */}
            {!searchType && (
              <>
                {/* Event Type Filter */}
                <div className="min-w-[150px]">
                  <select
                    value={eventTypeFilter ?? ''}
                    onChange={(e) => setEventTypeFilter(e.target.value || null)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    aria-label="Filter by event type"
                  >
                    <option value="">All event types</option>
                    {eventTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Stream Type Filter */}
                <div className="min-w-[150px]">
                  <select
                    value={streamTypeFilter ?? ''}
                    onChange={(e) =>
                      setStreamTypeFilter((e.target.value || null) as EventStreamType | null)
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    aria-label="Filter by stream type"
                  >
                    <option value="">All stream types</option>
                    <option value="organization">organization</option>
                    <option value="user">user</option>
                    <option value="invitation">invitation</option>
                    <option value="role">role</option>
                    <option value="contact">contact</option>
                  </select>
                </div>

                {/* Status Filter (Failed vs Dismissed) */}
                <div className="min-w-[150px]">
                  <select
                    value={statusFilter}
                    onChange={(e) =>
                      setStatusFilter(e.target.value as 'failed' | 'dismissed' | 'all')
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    aria-label="Filter by status"
                  >
                    <option value="failed">Failed (not dismissed)</option>
                    <option value="dismissed">Dismissed</option>
                    <option value="all">All events</option>
                  </select>
                </div>
              </>
            )}

            <div className="text-sm text-gray-500">
              Last refreshed: {lastRefresh.toLocaleTimeString()}
            </div>
          </div>

          {/* Search info banner */}
          {searchType && (
            <div className={cn(
              'mt-3 px-3 py-2 rounded-md text-sm flex items-center gap-2',
              searchType === 'correlation' && 'bg-blue-50 text-blue-700',
              searchType === 'session' && 'bg-purple-50 text-purple-700',
              searchType === 'trace' && 'bg-green-50 text-green-700'
            )}>
              <Link2 className="h-4 w-4" />
              {searchType === 'correlation' && 'Showing all events with matching correlation ID (not just failed events)'}
              {searchType === 'session' && 'Showing all events from this user session (not just failed events)'}
              {searchType === 'trace' && 'Showing trace timeline with span hierarchy (not just failed events)'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Events List */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-lg flex items-center gap-2">
            {searchType ? (
              <>
                <Link2 className="h-5 w-5" />
                {searchType === 'correlation' && `Events by Correlation (${events.length})`}
                {searchType === 'session' && `Events by Session (${events.length})`}
                {searchType === 'trace' && `Trace Timeline (${events.length} spans)`}
              </>
            ) : (
              <>
                <Filter className="h-5 w-5" />
                Failed Events ({events.length})
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {eventsError ? (
            <div className="p-6 text-center text-red-600">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
              <p>{eventsError}</p>
            </div>
          ) : eventsLoading && events.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              <RefreshCw className="h-8 w-8 mx-auto mb-2 animate-spin" />
              <p>Loading events...</p>
            </div>
          ) : events.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
              <p>No failed events found</p>
            </div>
          ) : (
            <div>
              {/* Table Header */}
              <div className="flex items-center px-4 py-2 bg-gray-100 border-b text-sm font-medium text-gray-600">
                <div className="w-6" />
                <div className="flex-1 grid grid-cols-5 gap-4">
                  {/* Sortable: Event Type */}
                  <button
                    className="flex items-center gap-1 hover:text-gray-900 text-left"
                    onClick={() => toggleSort('event_type')}
                    aria-label={`Sort by event type ${sortBy === 'event_type' ? (sortOrder === 'desc' ? 'descending' : 'ascending') : ''}`}
                  >
                    Event Type
                    {sortBy === 'event_type' ? (
                      sortOrder === 'desc' ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronUp className="h-4 w-4" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3 w-3 text-gray-400" />
                    )}
                  </button>
                  <div>Stream Type</div>
                  <div>Stream ID</div>
                  {/* Sortable: Created At */}
                  <button
                    className="flex items-center gap-1 hover:text-gray-900 text-left"
                    onClick={() => toggleSort('created_at')}
                    aria-label={`Sort by created date ${sortBy === 'created_at' ? (sortOrder === 'desc' ? 'descending' : 'ascending') : ''}`}
                  >
                    Created At
                    {sortBy === 'created_at' ? (
                      sortOrder === 'desc' ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronUp className="h-4 w-4" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3 w-3 text-gray-400" />
                    )}
                  </button>
                  <div>Error</div>
                </div>
                <div className="ml-4 w-32">Actions</div>
              </div>

              {/* Event Rows */}
              <div className="divide-y divide-gray-200">
                {events.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    isExpanded={expandedEventId === event.id}
                    onToggle={() =>
                      setExpandedEventId(expandedEventId === event.id ? null : event.id)
                    }
                    onRetry={() => handleRetry(event.id)}
                    onDismiss={(reason) => handleDismiss(event.id, reason)}
                    onUndismiss={() => handleUndismiss(event.id)}
                    isRetrying={retryingEventId === event.id}
                    isDismissing={dismissingEventId === event.id}
                  />
                ))}
              </div>

              {/* Pagination Controls */}
              {!searchType && totalCount > PAGE_SIZE && (
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t">
                  <div className="text-sm text-gray-600">
                    Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, totalCount)} of {totalCount} events
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                      disabled={offset === 0}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Previous
                    </Button>
                    <span className="text-sm text-gray-500">
                      Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.ceil(totalCount / PAGE_SIZE)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setOffset(offset + PAGE_SIZE)}
                      disabled={offset + PAGE_SIZE >= totalCount}
                      aria-label="Next page"
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default FailedEventsPage;
