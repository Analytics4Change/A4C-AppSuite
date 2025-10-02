import React, { useState } from 'react';
import { useEventHistory } from '@/hooks/useEventHistory';
import { StreamType } from '@/types/event-types';
import { cn } from '@/lib/utils';
import { formatDistanceToNow, format } from 'date-fns';

export interface EventHistoryProps {
  entityId: string;
  streamType?: StreamType;
  eventTypes?: string[];
  limit?: number;
  realtime?: boolean;
  className?: string;
  showRawData?: boolean;
  title?: string;
  emptyMessage?: string;
}

export function EventHistory({
  entityId,
  streamType,
  eventTypes,
  limit = 20,
  realtime = true,
  className,
  showRawData = false,
  title = 'Change History',
  emptyMessage = 'No changes recorded yet'
}: EventHistoryProps) {
  const { history, loading, error, refresh, isEmpty } = useEventHistory(entityId, {
    streamType,
    eventTypes,
    limit,
    realtime
  });

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const toggleExpanded = (eventId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  const formatEventType = (type: string): string => {
    return type
      .split('.')
      .map(part => part.replace(/_/g, ' '))
      .join(' → ')
      .replace(/\b\w/g, l => l.toUpperCase());
  };

  const getEventIcon = (eventType: string): string => {
    if (eventType.includes('registered') || eventType.includes('created')) return '➕';
    if (eventType.includes('updated') || eventType.includes('changed')) return '✏️';
    if (eventType.includes('deleted') || eventType.includes('archived')) return '🗑️';
    if (eventType.includes('discharged')) return '🏠';
    if (eventType.includes('prescribed')) return '💊';
    if (eventType.includes('approved')) return '✅';
    if (eventType.includes('rejected')) return '❌';
    return '📝';
  };

  const getEventColor = (eventType: string): string => {
    if (eventType.includes('error') || eventType.includes('failed')) return 'border-red-500 bg-red-50';
    if (eventType.includes('warning')) return 'border-amber-500 bg-amber-50';
    if (eventType.includes('success') || eventType.includes('approved')) return 'border-green-500 bg-green-50';
    return 'border-gray-300 bg-white';
  };

  if (loading) {
    return (
      <div className={cn('p-4 space-y-2', className)}>
        <div className="animate-pulse space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-gray-200 rounded-lg h-20" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('p-4', className)}>
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-600">Failed to load history: {error.message}</p>
          <button
            onClick={refresh}
            className="mt-2 text-xs text-red-500 underline hover:text-red-600"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className={cn('p-4', className)}>
        <div className="text-center py-8 text-gray-500">
          <p className="text-sm">{emptyMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {realtime && (
          <span className="text-xs text-green-600 flex items-center gap-1">
            <span className="w-2 h-2 bg-green-600 rounded-full animate-pulse" />
            Live updates
          </span>
        )}
      </div>

      <div className="space-y-3">
        {history.map((event) => {
          const isExpanded = expandedItems.has(event.id);

          return (
            <div
              key={event.id}
              className={cn(
                'border rounded-lg p-4 transition-all duration-200',
                getEventColor(event.event_type),
                'hover:shadow-md'
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{getEventIcon(event.event_type)}</span>
                    <span className="font-medium text-sm">
                      {formatEventType(event.event_type)}
                    </span>
                    <span className="text-xs text-gray-500">
                      v{event.version}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm text-gray-700">
                      <span className="font-medium">Reason:</span> {event.change_reason}
                    </p>

                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>
                        By {event.changed_by_name || event.changed_by_email || 'System'}
                      </span>
                      <span title={format(new Date(event.occurred_at), 'PPpp')}>
                        {formatDistanceToNow(new Date(event.occurred_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>

                  {showRawData && (
                    <button
                      onClick={() => toggleExpanded(event.id)}
                      className="mt-2 text-xs text-blue-600 hover:text-blue-700 underline"
                    >
                      {isExpanded ? 'Hide' : 'Show'} details
                    </button>
                  )}

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <details className="text-xs">
                        <summary className="cursor-pointer text-gray-600 hover:text-gray-800">
                          Event Data
                        </summary>
                        <pre className="mt-2 p-2 bg-gray-100 rounded overflow-x-auto">
                          {JSON.stringify(event.event_data, null, 2)}
                        </pre>
                      </details>

                      {event.event_metadata && (
                        <details className="text-xs mt-2">
                          <summary className="cursor-pointer text-gray-600 hover:text-gray-800">
                            Metadata
                          </summary>
                          <pre className="mt-2 p-2 bg-gray-100 rounded overflow-x-auto">
                            {JSON.stringify(event.event_metadata, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {history.length === limit && (
        <div className="text-center pt-2">
          <p className="text-xs text-gray-500">
            Showing most recent {limit} events
          </p>
        </div>
      )}
    </div>
  );
}

export default EventHistory;