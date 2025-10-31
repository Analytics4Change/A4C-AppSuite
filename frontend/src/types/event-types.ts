/**
 * Domain Event Types
 *
 * Core types for event-sourcing architecture.
 * Defines the structure of domain events used throughout the application.
 */

/**
 * Stream types for domain events
 *
 * Represents the different aggregates in the system.
 */
export type StreamType =
  | 'organization'
  | 'user'
  | 'client'
  | 'medication'
  | 'program'
  | 'contact'
  | 'address'
  | 'phone';

/**
 * Event metadata
 *
 * Additional context about who performed the action and in what context.
 */
export interface EventMetadata {
  /** User who triggered the event */
  user_id?: string;
  /** Organization context for the event */
  organization_id?: string;
  /** Additional metadata fields */
  [key: string]: any;
}

/**
 * Domain Event
 *
 * Represents an immutable event that occurred in the system.
 * All state changes are recorded as domain events.
 */
export interface DomainEvent {
  /** Unique event identifier */
  id: string;
  /** ID of the aggregate this event belongs to */
  stream_id: string;
  /** Type of aggregate (organization, user, etc.) */
  stream_type: StreamType;
  /** Version number of the aggregate */
  stream_version: number;
  /** Type of event (e.g., 'organization.created') */
  event_type: string;
  /** Event payload data */
  event_data: Record<string, any>;
  /** Event metadata (user, organization context) */
  event_metadata: EventMetadata;
  /** Timestamp when event was created */
  created_at: string;
}
