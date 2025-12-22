/**
 * Domain Event Emitter
 *
 * Emits domain events to the event store (domain_events table).
 * All state changes in the system must be recorded as domain events.
 *
 * Features:
 * - Automatic event metadata (timestamp, workflow_id, workflow_run_id, workflow_type, activity_id)
 * - Bi-directional traceability between events and workflows
 * - Tags support for development entity tracking
 * - Idempotency via event_id
 * - Type-safe event data
 *
 * Event Metadata Structure:
 * - workflow_id: Deterministic workflow ID (e.g., "org-bootstrap-abc123")
 * - workflow_run_id: Temporal execution ID (UUID)
 * - workflow_type: Workflow name (e.g., "organizationBootstrapWorkflow")
 * - activity_id: Activity that emitted the event (e.g., "createOrganizationActivity")
 * - timestamp: Event emission time (ISO 8601)
 * - tags: Optional development tracking tags
 *
 * Usage:
 * ```typescript
 * import { emitEvent } from '@shared/utils/emit-event';
 *
 * await emitEvent({
 *   event_type: 'organization.created',
 *   aggregate_type: 'organization',
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
  /** Event type in dot-notation (e.g., 'organization.created', 'user.invited', 'invitation.accepted') */
  event_type: string;

  /** Aggregate type (e.g., 'organization', 'invitation', 'user') - maps to stream_type */
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
    // When called from an activity, use Context.current() to get workflow info
    const { Context } = await import('@temporalio/activity');
    const activityInfo = Context.current().info;

    // Activity info contains workflow execution details
    metadata.workflow_id = activityInfo.workflowExecution.workflowId;
    metadata.workflow_run_id = activityInfo.workflowExecution.runId;
    metadata.workflow_type = activityInfo.workflowType;
    metadata.activity_id = activityInfo.activityType;
  } catch {
    // Not in activity context - may be in workflow or standalone
    try {
      // Try to import Temporal workflow context (only available in workflow context)
      const { workflowInfo } = await import('@temporalio/workflow');
      const info = workflowInfo();
      metadata.workflow_id = info.workflowId;
      metadata.workflow_run_id = info.runId;
      metadata.workflow_type = info.workflowType;
    } catch {
      // Not in workflow context either
      // Try to get from environment (for testing/debugging)
      if (process.env.TEMPORAL_WORKFLOW_ID) {
        metadata.workflow_id = process.env.TEMPORAL_WORKFLOW_ID;
      }
      if (process.env.TEMPORAL_RUN_ID) {
        metadata.workflow_run_id = process.env.TEMPORAL_RUN_ID;
      }
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

  // Insert event into domain_events table via RPC function
  // (PostgREST only exposes 'api' schema, so we use RPC to access public.domain_events)
  const { error } = await supabase
    .schema('api')
    .rpc('emit_domain_event', {
      p_event_id: eventId,
      p_event_type: params.event_type,
      p_aggregate_type: params.aggregate_type,
      p_aggregate_id: params.aggregate_id,
      p_event_data: params.event_data,
      p_event_metadata: metadata
    });

  if (error) {
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
