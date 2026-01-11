import { useState, useCallback } from 'react';
import { getEventEmitter, EventValidationError } from '@/lib/events/event-emitter';
import { EventMetadata, StreamType, DomainEvent } from '@/types/events';

export interface UseEventsOptions {
  onSuccess?: (event: DomainEvent) => void;
  onError?: (error: Error) => void;
  throwOnError?: boolean;
}

export function useEvents(options: UseEventsOptions = {}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastEvent, setLastEvent] = useState<DomainEvent | null>(null);

  const emitEvent = useCallback(async (
    streamId: string,
    streamType: StreamType,
    eventType: string,
    eventData: any,
    reason: string,
    additionalMetadata?: Partial<EventMetadata>
  ): Promise<DomainEvent | null> => {
    setSubmitting(true);
    setError(null);

    try {
      const eventEmitter = getEventEmitter();
      const event = await eventEmitter.emit(
        streamId,
        streamType,
        eventType,
        eventData,
        reason,
        additionalMetadata
      );

      setLastEvent(event);
      options.onSuccess?.(event);
      return event;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to emit event');
      setError(error);
      options.onError?.(error);

      if (options.throwOnError !== false) {
        throw error;
      }
      return null;
    } finally {
      setSubmitting(false);
    }
  }, [options]);

  const emitBatch = useCallback(async (
    events: Array<{
      streamId: string;
      streamType: StreamType;
      eventType: string;
      eventData: any;
      reason: string;
      additionalMetadata?: Partial<EventMetadata>;
    }>
  ): Promise<DomainEvent[] | null> => {
    setSubmitting(true);
    setError(null);

    try {
      const eventEmitter = getEventEmitter();
      const emittedEvents = await eventEmitter.emitBatch(events);

      if (emittedEvents.length > 0) {
        setLastEvent(emittedEvents[emittedEvents.length - 1]);
      }

      return emittedEvents;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to emit batch events');
      setError(error);
      options.onError?.(error);

      if (options.throwOnError !== false) {
        throw error;
      }
      return null;
    } finally {
      setSubmitting(false);
    }
  }, [options]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    emitEvent,
    emitBatch,
    submitting,
    error,
    lastEvent,
    clearError,
    isValidationError: error instanceof EventValidationError
  };
}