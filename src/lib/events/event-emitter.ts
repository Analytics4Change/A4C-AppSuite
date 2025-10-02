import { SupabaseClient } from '@supabase/supabase-js';
import { DomainEvent, EventMetadata, StreamType } from '@/types/events';
import { supabaseService } from '@/services/auth/supabase.service';

export class EventValidationError extends Error {
  constructor(message: string, public field: string, public code: string) {
    super(message);
    this.name = 'EventValidationError';
  }
}

export class EventEmitter {
  constructor(private supabase: SupabaseClient) {}

  private async getNextVersion(streamId: string, streamType: StreamType): Promise<number> {
    const { data, error } = await this.supabase
      .from('domain_events')
      .select('stream_version')
      .eq('stream_id', streamId)
      .eq('stream_type', streamType)
      .order('stream_version', { ascending: false })
      .limit(1);

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return (data?.[0]?.stream_version || 0) + 1;
  }

  private validateReason(reason: string): void {
    if (!reason) {
      throw new EventValidationError(
        'Reason is required for all events',
        'reason',
        'REASON_REQUIRED'
      );
    }

    if (reason.length < 10) {
      throw new EventValidationError(
        'Reason must be at least 10 characters to provide meaningful context',
        'reason',
        'REASON_TOO_SHORT'
      );
    }

    if (reason.length > 500) {
      throw new EventValidationError(
        'Reason must be less than 500 characters',
        'reason',
        'REASON_TOO_LONG'
      );
    }
  }

  private validateEventType(eventType: string): void {
    const pattern = /^[a-z_]+\.[a-z_]+$/;
    if (!pattern.test(eventType)) {
      throw new EventValidationError(
        'Event type must be in format "domain.action" (e.g., "client.registered")',
        'event_type',
        'INVALID_EVENT_TYPE_FORMAT'
      );
    }
  }

  async emit<T = any>(
    streamId: string,
    streamType: StreamType,
    eventType: string,
    eventData: T,
    reason: string,
    additionalMetadata?: Partial<EventMetadata>
  ): Promise<DomainEvent<T>> {
    this.validateReason(reason);
    this.validateEventType(eventType);

    const user = await this.supabase.auth.getUser();
    if (!user.data.user) {
      throw new Error('User must be authenticated to emit events');
    }

    const version = await this.getNextVersion(streamId, streamType);

    const event: Omit<DomainEvent<T>, 'id' | 'sequence_number' | 'created_at'> = {
      stream_id: streamId,
      stream_type: streamType,
      stream_version: version,
      event_type: eventType,
      event_data: eventData,
      event_metadata: {
        user_id: user.data.user.id,
        reason,
        user_email: user.data.user.email,
        user_name: user.data.user.user_metadata?.name,
        ...additionalMetadata
      }
    };

    const { data, error } = await this.supabase
      .from('domain_events')
      .insert(event)
      .select()
      .single();

    if (error) {
      if (error.code === '23514') {
        throw new EventValidationError(
          'Event validation failed. Please check your input.',
          'event',
          'VALIDATION_FAILED'
        );
      }
      if (error.code === '23505') {
        throw new EventValidationError(
          'This event has already been processed',
          'event',
          'DUPLICATE_EVENT'
        );
      }
      throw error;
    }

    return data as DomainEvent<T>;
  }

  async emitBatch<T = any>(
    events: Array<{
      streamId: string;
      streamType: StreamType;
      eventType: string;
      eventData: T;
      reason: string;
      additionalMetadata?: Partial<EventMetadata>;
    }>
  ): Promise<DomainEvent<T>[]> {
    const user = await this.supabase.auth.getUser();
    if (!user.data.user) {
      throw new Error('User must be authenticated to emit events');
    }

    const processedEvents = await Promise.all(
      events.map(async (e) => {
        this.validateReason(e.reason);
        this.validateEventType(e.eventType);

        const version = await this.getNextVersion(e.streamId, e.streamType);

        return {
          stream_id: e.streamId,
          stream_type: e.streamType,
          stream_version: version,
          event_type: e.eventType,
          event_data: e.eventData,
          event_metadata: {
            user_id: user.data.user!.id,
            reason: e.reason,
            user_email: user.data.user!.email,
            user_name: user.data.user!.user_metadata?.name,
            ...e.additionalMetadata
          }
        };
      })
    );

    const { data, error } = await this.supabase
      .from('domain_events')
      .insert(processedEvents)
      .select();

    if (error) {
      throw error;
    }

    return data as DomainEvent<T>[];
  }

  async getEventHistory(
    streamId: string,
    streamType?: StreamType,
    options?: {
      limit?: number;
      offset?: number;
      eventTypes?: string[];
    }
  ): Promise<DomainEvent[]> {
    let query = this.supabase
      .from('domain_events')
      .select('*')
      .eq('stream_id', streamId)
      .order('stream_version', { ascending: true });

    if (streamType) {
      query = query.eq('stream_type', streamType);
    }

    if (options?.eventTypes?.length) {
      query = query.in('event_type', options.eventTypes);
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 100) - 1);
    }

    const { data, error } = await query;

    if (error) throw error;

    return data as DomainEvent[];
  }

  subscribeToEvents(
    callback: (event: DomainEvent) => void,
    filters?: {
      streamId?: string;
      streamType?: StreamType;
      eventTypes?: string[];
    }
  ) {
    let channel = this.supabase
      .channel('domain-events')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'domain_events',
        filter: filters?.streamId ? `stream_id=eq.${filters.streamId}` : undefined
      }, (payload) => {
        const event = payload.new as DomainEvent;

        if (filters?.streamType && event.stream_type !== filters.streamType) {
          return;
        }

        if (filters?.eventTypes && !filters.eventTypes.includes(event.event_type)) {
          return;
        }

        callback(event);
      });

    return channel.subscribe();
  }
}

let eventEmitterInstance: EventEmitter | null = null;

export function createEventEmitter(supabase: SupabaseClient): EventEmitter {
  if (!eventEmitterInstance) {
    eventEmitterInstance = new EventEmitter(supabase);
  }
  return eventEmitterInstance;
}

export function getEventEmitter(): EventEmitter {
  if (!eventEmitterInstance) {
    throw new Error('EventEmitter not initialized. Call createEventEmitter first.');
  }
  return eventEmitterInstance;
}

// Lazy-initialized singleton for easy import
// Automatically initializes with Supabase client on first use
async function getOrCreateEventEmitter(): Promise<EventEmitter> {
  if (!eventEmitterInstance) {
    const client = await supabaseService.getClient();
    eventEmitterInstance = new EventEmitter(client);
  }
  return eventEmitterInstance;
}

// Export singleton with proxy methods for synchronous-looking API
export const eventEmitter = {
  async emit<T = any>(
    streamId: string,
    streamType: StreamType,
    eventType: string,
    eventData: T,
    reason: string,
    additionalMetadata?: Partial<EventMetadata>
  ): Promise<DomainEvent<T>> {
    const instance = await getOrCreateEventEmitter();
    return instance.emit(streamId, streamType, eventType, eventData, reason, additionalMetadata);
  },

  async emitBatch<T = any>(
    events: Array<{
      streamId: string;
      streamType: StreamType;
      eventType: string;
      eventData: T;
      reason: string;
      additionalMetadata?: Partial<EventMetadata>;
    }>
  ): Promise<DomainEvent<T>[]> {
    const instance = await getOrCreateEventEmitter();
    return instance.emitBatch(events);
  },

  async getEventHistory(
    streamId: string,
    streamType?: StreamType,
    options?: {
      limit?: number;
      offset?: number;
      eventTypes?: string[];
    }
  ): Promise<DomainEvent[]> {
    const instance = await getOrCreateEventEmitter();
    return instance.getEventHistory(streamId, streamType, options);
  },

  subscribeToEvents(
    callback: (event: DomainEvent) => void,
    filters?: {
      streamId?: string;
      streamType?: StreamType;
      eventTypes?: string[];
    }
  ) {
    // For subscriptions, we need the instance synchronously
    // This will throw if not initialized, which is acceptable
    return getEventEmitter().subscribeToEvents(callback, filters);
  }
};