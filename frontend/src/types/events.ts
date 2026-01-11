/**
 * Event System Type Definitions
 *
 * This file re-exports types from the generated schema contracts
 * and adds application-specific extensions.
 *
 * Source of truth: infrastructure/supabase/contracts/asyncapi/
 * Regenerate: cd infrastructure/supabase/contracts && npm run generate:types
 */

// Re-export core types from generated AsyncAPI schemas
export type {
  DomainEvent,
  EventMetadata,
  StreamType,
} from './generated';

// Import types needed for extensions
import type { EventMetadata, StreamType } from './generated';

// Application-specific type extensions

/**
 * Extended EventMetadata with app-specific fields
 */
export interface ExtendedEventMetadata extends EventMetadata {
  source?: string; // Source system/component
  user_email?: string; // Legacy field, prefer using user_id
  user_name?: string; // Legacy field, prefer using user_id
  [key: string]: unknown; // Allow additional metadata
}

// NOTE: MedicationEventType and ClientEventType removed (2025-01-10)
// Legacy CRUD tables dropped - will be redefined with proper event-driven architecture
// See: infrastructure/supabase/supabase/migrations/20260110020621_drop_legacy_crud_tables.sql

/**
 * Organization-related event types
 */
export type OrganizationEventType =
  | 'organization.bootstrap_initiated'
  | 'organization.bootstrap_completed'
  | 'organization.bootstrap_failed'
  | 'organization.bootstrap_cancelled';

/**
 * User-related event types
 */
export type UserEventType =
  | 'user.synced_from_auth'
  | 'user.organization_switched';

/**
 * Invitation-related event types
 */
export type InvitationEventType =
  | 'invitation.created'
  | 'invitation.revoked'
  | 'invitation.accepted'
  | 'invitation.expired';

/**
 * All supported event types
 */
export type EventType = OrganizationEventType | UserEventType | InvitationEventType;

// NOTE: MedicationMAREntryData and ClientRegisteredEventData removed (2025-01-10)
// Legacy CRUD tables dropped - will be redefined with proper event-driven architecture
// See: infrastructure/supabase/supabase/migrations/20260110020621_drop_legacy_crud_tables.sql

/**
 * Event emission options
 */
export interface EmitEventOptions {
  additionalMetadata?: Record<string, unknown>;
  correlationId?: string;
  causationId?: string;
}

/**
 * Event subscription filter
 */
export interface EventFilter {
  streamId?: string;
  streamType?: StreamType;
  eventType?: EventType;
  since?: string; // ISO timestamp
}

/**
 * Event history query options
 */
export interface EventHistoryOptions {
  limit?: number;
  offset?: number;
  orderBy?: 'asc' | 'desc';
  includeProcessed?: boolean;
  includeErrors?: boolean;
}
