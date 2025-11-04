/**
 * Domain Event Emitter
 *
 * Emits domain events to the event store (domain_events table).
 * All state changes in the system must be recorded as domain events.
 *
 * Features:
 * - Automatic event metadata (timestamp, workflow_id, run_id)
 * - Tags support for development entity tracking
 * - Idempotency via event_id
 * - Type-safe event data
 *
 * Usage:
 * ```typescript
 * import { emitEvent } from '@shared/utils/emit-event';
 *
 * await emitEvent({
 *   event_type: 'OrganizationCreated',
 *   aggregate_type: 'Organization',
 *   aggregate_id: orgId,
 *   event_data: {
 *     org_id: orgId,
 *     name: 'Acme Corp',
 *     subdomain: 'acme'
 *   },
 *   tags: ['development', 'test']
 * });
 * ```
 */

import { v4 as uuidv4 } from 'uuid';
import { getSupabaseClient } from './supabase';

interface EmitEventParams {
  /** Event type (e.g., 'OrganizationCreated', 'UserInvited') */
  event_type: string;

  /** Aggregate type (e.g., 'Organization', 'User') */
  aggregate_type: string;

  /** Aggregate ID (UUID) */
  aggregate_id: string;

  /** Event data (JSON payload) */
  event_data: Record<string, unknown>;

  /** Optional event ID (for idempotency - auto-generated if not provided) */
  event_id?: string;

  /** Optional correlation ID (for tracing related events) */
  correlation_id?: string;

  /** Optional causation ID (event that caused this event) */
  causation_id?: string;

  /** Optional tags for development entity tracking */
  tags?: string[];
}

/**
 * Emit a domain event to the event store
 * @param params - Event parameters
 * @returns Event ID
 * @throws Error if event emission fails
 */
export async function emitEvent(params: EmitEventParams): Promise<string> {
  const supabase = getSupabaseClient();

  // Generate event ID if not provided (for idempotency)
  const eventId = params.event_id || uuidv4();

  // Build event metadata
  const metadata: Record<string, unknown> = {
    timestamp: new Date().toISOString()
  };

  // Add Temporal workflow context if available
  try {
    // Try to import Temporal workflow context (only available in workflow context)
    // This will fail in activities, which is expected
    const { workflowInfo } = await import('@temporalio/workflow');
    const info = workflowInfo();
    metadata.workflow_id = info.workflowId;
    metadata.run_id = info.runId;
  } catch {
    // Not in workflow context (e.g., running in activity)
    // Try to get from environment or activity context
    if (process.env.TEMPORAL_WORKFLOW_ID) {
      metadata.workflow_id = process.env.TEMPORAL_WORKFLOW_ID;
    }
    if (process.env.TEMPORAL_RUN_ID) {
      metadata.run_id = process.env.TEMPORAL_RUN_ID;
    }
  }

  // Add tags to metadata if provided
  if (params.tags && params.tags.length > 0) {
    metadata.tags = params.tags;
  }

  // Add correlation and causation IDs
  if (params.correlation_id) {
    metadata.correlation_id = params.correlation_id;
  }
  if (params.causation_id) {
    metadata.causation_id = params.causation_id;
  }

  // Insert event into domain_events table
  const { error } = await supabase
    .from('domain_events')
    .insert({
      event_id: eventId,
      event_type: params.event_type,
      aggregate_type: params.aggregate_type,
      aggregate_id: params.aggregate_id,
      event_data: params.event_data,
      event_metadata: metadata
    });

  if (error) {
    // Check if error is due to duplicate event_id (idempotency)
    if (error.code === '23505') { // unique_violation
      console.log(`[Event Emitter] Event ${eventId} already exists (idempotent)`);
      return eventId;
    }

    throw new Error(`Failed to emit event: ${error.message}`);
  }

  console.log(`[Event Emitter] Emitted ${params.event_type} event: ${eventId}`);
  return eventId;
}

/**
 * Get tags for current environment
 * Returns tags array based on TAG_DEV_ENTITIES environment variable
 *
 * @returns Array of tags to apply to entities
 */
export function getEnvironmentTags(): string[] {
  const tagDevEntities = process.env.TAG_DEV_ENTITIES === 'true';
  const workflowMode = process.env.WORKFLOW_MODE || 'development';

  if (!tagDevEntities) {
    return [];
  }

  const tags: string[] = ['development'];

  // Add mode-specific tag
  if (workflowMode !== 'production') {
    tags.push(`mode:${workflowMode}`);
  }

  // Add timestamp tag for easy identification
  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  tags.push(`created:${timestamp}`);

  return tags;
}

/**
 * Build tags array for entity creation
 * Combines environment tags with optional custom tags
 *
 * @param customTags - Optional custom tags to add
 * @returns Combined array of tags
 */
export function buildTags(customTags?: string[]): string[] {
  const envTags = getEnvironmentTags();
  const allTags = [...envTags];

  if (customTags && customTags.length > 0) {
    allTags.push(...customTags);
  }

  return allTags;
}
