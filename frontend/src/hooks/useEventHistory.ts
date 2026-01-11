import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { getEventEmitter } from '@/lib/events/event-emitter';
import { DomainEvent, StreamType } from '@/types/events';

export interface EventHistoryItem {
  id: string;
  entity_id: string;
  entity_type: string;
  event_type: string;
  version: number;
  change_reason: string;
  changed_by_id: string;
  changed_by_name?: string;
  changed_by_email?: string;
  occurred_at: string;
  event_data: any;
  event_metadata: any;
}

export interface UseEventHistoryOptions {
  streamType?: StreamType;
  eventTypes?: string[];
  limit?: number;
  realtime?: boolean;
  includeRawEvents?: boolean;
}

export function useEventHistory(
  entityId: string,
  options: UseEventHistoryOptions = {}
) {
  const [history, setHistory] = useState<EventHistoryItem[]>([]);
  const [rawEvents, setRawEvents] = useState<DomainEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!entityId) {
      setHistory([]);
      setRawEvents([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('event_history_by_entity')
        .select('*')
        .eq('entity_id', entityId)
        .order('version', { ascending: false });

      if (options.streamType) {
        query = query.eq('entity_type', options.streamType);
      }

      if (options.eventTypes?.length) {
        query = query.in('event_type', options.eventTypes);
      }

      if (options.limit) {
        query = query.limit(options.limit);
      }

      const { data, error } = await query;

      if (error) throw error;

      setHistory(data || []);

      if (options.includeRawEvents) {
        const eventEmitter = getEventEmitter();
        const events = await eventEmitter.getEventHistory(
          entityId,
          options.streamType,
          {
            eventTypes: options.eventTypes,
            limit: options.limit
          }
        );
        setRawEvents(events);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch history'));
    } finally {
      setLoading(false);
    }
  }, [entityId, options.streamType, options.eventTypes, options.limit, options.includeRawEvents]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    if (!options.realtime || !entityId) return;

    const eventEmitter = getEventEmitter();
    const subscription = eventEmitter.subscribeToEvents(
      (event) => {
        setHistory(prev => {
          const newItem: EventHistoryItem = {
            id: event.id!,
            entity_id: event.stream_id,
            entity_type: event.stream_type,
            event_type: event.event_type,
            version: event.stream_version || 0,
            change_reason: event.event_metadata.reason || 'No reason provided',
            changed_by_id: event.event_metadata.user_id || '',
            changed_by_name: event.event_metadata.user_name,
            changed_by_email: event.event_metadata.user_email,
            occurred_at: event.created_at!,
            event_data: event.event_data,
            event_metadata: event.event_metadata
          };

          return [newItem, ...prev];
        });

        if (options.includeRawEvents) {
          setRawEvents(prev => [event, ...prev]);
        }
      },
      {
        streamId: entityId,
        streamType: options.streamType,
        eventTypes: options.eventTypes
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [entityId, options.realtime, options.streamType, options.eventTypes, options.includeRawEvents]);

  const refresh = useCallback(() => {
    fetchHistory();
  }, [fetchHistory]);

  return {
    history,
    rawEvents,
    loading,
    error,
    refresh,
    isEmpty: history.length === 0
  };
}