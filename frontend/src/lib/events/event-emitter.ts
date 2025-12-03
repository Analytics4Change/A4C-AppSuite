import { SupabaseClient } from '@supabase/supabase-js';
import { DomainEvent, EventMetadata, StreamType } from '@/types/events';
import { supabaseService } from '@/services/auth/supabase.service';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

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

  private validateEventData(eventType: string, eventData: any): void {
    log.debug('Validating event data', { eventType, hasData: !!eventData });

    if (!eventData || typeof eventData !== 'object') {
      throw new EventValidationError(
        'Event data must be a valid object',
        'event_data',
        'INVALID_EVENT_DATA'
      );
    }

    // Validate required fields based on event type
    const validationRules: Record<string, { required: string[]; description: string }> = {
      'client.registered': {
        required: ['organization_id', 'first_name', 'last_name', 'date_of_birth'],
        description: 'Client registration data'
      },
      'client.admitted': {
        required: ['admission_date', 'facility_id', 'admission_type'],
        description: 'Client admission data'
      },
      'client.information_updated': {
        required: ['changes'],
        description: 'Client update data'
      },
      'client.discharged': {
        required: ['discharge_date', 'discharge_type', 'discharge_disposition'],
        description: 'Client discharge data'
      },
      'medication.prescribed': {
        required: [],
        description: 'Medication prescription data'
      },
      'medication.administered': {
        required: [],
        description: 'Medication administration data'
      },
      'medication.skipped': {
        required: [],
        description: 'Medication skip data'
      },
      'medication.refused': {
        required: [],
        description: 'Medication refusal data'
      },
      'medication.discontinued': {
        required: [],
        description: 'Medication discontinuation data'
      },
      'user.synced': {
        required: [],
        description: 'User sync data'
      },
      'user.organization_switched': {
        required: [],
        description: 'Organization switch data'
      }
    };

    const rules = validationRules[eventType];
    if (!rules) {
      log.warn('No validation rules defined for event type', { eventType });
      return; // Allow unknown event types for extensibility
    }

    // Validate required fields
    for (const field of rules.required) {
      if (!(field in eventData) || eventData[field] === null || eventData[field] === undefined) {
        throw new EventValidationError(
          `Missing required field '${field}' for ${rules.description}`,
          field,
          'MISSING_REQUIRED_FIELD'
        );
      }
    }

    log.debug('Event data validation passed', { eventType });
  }

  async emit<T = any>(
    streamId: string,
    streamType: StreamType,
    eventType: string,
    eventData: T,
    reason: string,
    additionalMetadata?: Partial<EventMetadata>
  ): Promise<DomainEvent> {
    this.validateReason(reason);
    this.validateEventType(eventType);
    this.validateEventData(eventType, eventData);

    const user = await this.supabase.auth.getUser();
    if (!user.data.user) {
      throw new Error('User must be authenticated to emit events');
    }

    const version = await this.getNextVersion(streamId, streamType);

    const event: Omit<DomainEvent, 'id' | 'created_at'> = {
      stream_id: streamId,
      stream_type: streamType,
      stream_version: version,
      event_type: eventType,
      event_data: eventData as Record<string, any>,
      event_metadata: {
        user_id: user.data.user.id,
        organization_id: user.data.user.user_metadata?.organization_id || '',
        reason,
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

    return data as DomainEvent;
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
  ): Promise<DomainEvent[]> {
    const user = await this.supabase.auth.getUser();
    if (!user.data.user) {
      throw new Error('User must be authenticated to emit events');
    }

    const processedEvents = await Promise.all(
      events.map(async (e) => {
        this.validateReason(e.reason);
        this.validateEventType(e.eventType);
        this.validateEventData(e.eventType, e.eventData);

        const version = await this.getNextVersion(e.streamId, e.streamType);

        return {
          stream_id: e.streamId,
          stream_type: e.streamType,
          stream_version: version,
          event_type: e.eventType,
          event_data: e.eventData,
          event_metadata: {
            user_id: user.data.user!.id,
            organization_id: user.data.user!.user_metadata?.organization_id || '',
            reason: e.reason,
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

    return data as DomainEvent[];
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
    const channel = this.supabase
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
  ): Promise<DomainEvent> {
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
  ): Promise<DomainEvent[]> {
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

  async subscribeToEvents(
    callback: (event: DomainEvent) => void,
    filters?: {
      streamId?: string;
      streamType?: StreamType;
      eventTypes?: string[];
    }
  ) {
    // Initialize instance if not yet created (consistent with other methods)
    const instance = await getOrCreateEventEmitter();
    return instance.subscribeToEvents(callback, filters);
  }
};