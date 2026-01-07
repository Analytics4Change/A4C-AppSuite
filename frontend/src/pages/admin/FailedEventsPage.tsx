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
} from '@/types/event-monitoring.types';
import {
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Search,
  Filter,
  Activity,
  CheckCircle,
  XCircle,
  Clock,
} from 'lucide-react';
import { Logger } from '@/utils/logger';
import { cn } from '@/components/ui/utils';

const log = Logger.getLogger('component');

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
  isRetrying: boolean;
}

const EventRow: React.FC<EventRowProps> = ({
  event,
  isExpanded,
  onToggle,
  onRetry,
  isRetrying,
}) => {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  return (
    <div className="border-b border-gray-200 last:border-b-0">
      {/* Main row */}
      <div
        className="flex items-center px-4 py-3 hover:bg-gray-50 cursor-pointer"
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
            <span className="font-mono text-sm">{event.event_type}</span>
          </div>
          <div className="text-sm text-gray-600">{event.stream_type}</div>
          <div className="text-sm text-gray-600 truncate" title={event.stream_id}>
            {event.stream_id.slice(0, 8)}...
          </div>
          <div className="text-sm text-gray-600">{formatDate(event.created_at)}</div>
          <div className="text-sm text-red-600 truncate" title={event.processing_error}>
            {event.processing_error.slice(0, 40)}...
          </div>
        </div>

        <div className="ml-4">
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
                <div>
                  <span className="text-gray-500">ID:</span>{' '}
                  <span className="font-mono">{event.id}</span>
                </div>
                <div>
                  <span className="text-gray-500">Stream ID:</span>{' '}
                  <span className="font-mono">{event.stream_id}</span>
                </div>
                <div>
                  <span className="text-gray-500">Processed At:</span>{' '}
                  {event.processed_at ? formatDate(event.processed_at) : 'Never'}
                </div>
              </div>
            </div>

            {/* Metadata */}
            <div>
              <h4 className="font-semibold text-sm text-gray-700 mb-2">Metadata</h4>
              <div className="space-y-1 text-sm">
                {event.event_metadata?.correlation_id && (
                  <div>
                    <span className="text-gray-500">Correlation ID:</span>{' '}
                    <span className="font-mono">{event.event_metadata.correlation_id}</span>
                  </div>
                )}
                {event.event_metadata?.user_id && (
                  <div>
                    <span className="text-gray-500">User ID:</span>{' '}
                    <span className="font-mono">{event.event_metadata.user_id}</span>
                  </div>
                )}
                {event.event_metadata?.source_function && (
                  <div>
                    <span className="text-gray-500">Source:</span>{' '}
                    {event.event_metadata.source_function}
                  </div>
                )}
              </div>
            </div>
          </div>

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
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Events state
  const [events, setEvents] = useState<FailedEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);

  // Filters
  const [correlationSearch, setCorrelationSearch] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState<string | null>(null);
  const [streamTypeFilter, setStreamTypeFilter] = useState<EventStreamType | null>(null);

  // UI state
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [retryingEventId, setRetryingEventId] = useState<string | null>(null);
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
      let result;

      if (correlationSearch.trim()) {
        result = await eventMonitoringService.searchByCorrelationId(correlationSearch.trim());
      } else {
        result = await eventMonitoringService.getFailedEvents({
          limit: 100,
          eventType: eventTypeFilter ?? undefined,
          streamType: streamTypeFilter ?? undefined,
        });
      }

      if (result.success && result.data) {
        setEvents(result.data.events);
      } else {
        setEventsError(result.error ?? 'Failed to load events');
      }
    } catch (error) {
      setEventsError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setEventsLoading(false);
      setLastRefresh(new Date());
    }
  }, [correlationSearch, eventTypeFilter, streamTypeFilter]);

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

  // Manual refresh
  const handleRefresh = () => {
    loadStats();
    loadEvents();
  };

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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <StatCard
            title="Total Failed Events"
            value={stats?.total_failed ?? 0}
            icon={<XCircle className="h-5 w-5" />}
            variant={stats?.total_failed && stats.total_failed > 0 ? 'danger' : 'default'}
          />
          <StatCard
            title="Last 24 Hours"
            value={stats?.failed_last_24h ?? 0}
            icon={<Clock className="h-5 w-5" />}
            variant={stats?.failed_last_24h && stats.failed_last_24h > 0 ? 'warning' : 'default'}
          />
          <StatCard
            title="Last 7 Days"
            value={stats?.failed_last_7d ?? 0}
            icon={<Activity className="h-5 w-5" />}
            variant="default"
          />
          <StatCard
            title="Event Types Affected"
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
            {/* Correlation ID Search */}
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search by correlation ID..."
                  value={correlationSearch}
                  onChange={(e) => setCorrelationSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

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

            <div className="text-sm text-gray-500">
              Last refreshed: {lastRefresh.toLocaleTimeString()}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Events List */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Failed Events ({events.length})
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
                  <div>Event Type</div>
                  <div>Stream Type</div>
                  <div>Stream ID</div>
                  <div>Created At</div>
                  <div>Error</div>
                </div>
                <div className="ml-4 w-20">Action</div>
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
                    isRetrying={retryingEventId === event.id}
                  />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default FailedEventsPage;
