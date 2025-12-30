/**
 * Domain Event Emitter
 *
 * Emits domain events to the event store (domain_events table).
 * All state changes in the system must be recorded as domain events.
 *
 * The domain_events table serves as the SINGLE SOURCE OF TRUTH for all
 * system changes and the complete audit trail. There is no separate audit table.
 *
 * Features:
 * - Automatic event metadata (timestamp, workflow_id, workflow_run_id, workflow_type, activity_id)
 * - Bi-directional traceability between events and workflows
 * - Tags support for development entity tracking
 * - Idempotency via event_id
 * - Type-safe event data
 * - Audit context fields for compliance (user_id, reason, ip_address, etc.)
 *
 * Event Metadata Structure:
 * - workflow_id: Deterministic workflow ID (e.g., "org-bootstrap-abc123")
 * - workflow_run_id: Temporal execution ID (UUID)
 * - workflow_type: Workflow name (e.g., "organizationBootstrapWorkflow")
 * - activity_id: Activity that emitted the event (e.g., "createOrganizationActivity")
 * - timestamp: Event emission time (ISO 8601)
 * - tags: Optional development tracking tags
 * - correlation_id: Optional trace ID for related events
 * - causation_id: Optional ID of event that caused this event
 *
 * Audit Context Fields (added to metadata when provided):
 * - user_id: UUID of user who initiated the action
 * - reason: Human-readable reason for the action
 * - ip_address: Client IP (for security audit)
 * - user_agent: Client info (for debugging)
 * - request_id: Correlation with API logs
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
 *   // Audit context (recommended for all events)
 *   user_id: initiatedByUserId,
 *   reason: 'Organization bootstrap workflow',
 *   tags: ['development', 'test']
 * });
 * ```
 */

import { getSupabaseClient } from './supabase';

export interface EmitEventParams {
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

  // ========================================
  // Audit Context Fields (Added 2025-12-22)
  // domain_events serves as the sole audit trail
  // ========================================

  /** User ID who initiated the action (UUID) */
  user_id?: string;

  /** Human-readable reason for the action */
  reason?: string;

  /** Client IP address (for security audit) */
  ip_address?: string;

  /** Client user agent string (for debugging) */
  user_agent?: string;

  /** Request ID for correlation with API logs */
  request_id?: string;
}

/**
 * Emit a domain event to the event store
 * @param params - Event parameters
 * @returns Event ID
 * @throws Error if event emission fails
 */
export async function emitEvent(params: EmitEventParams): Promise<string> {
  const supabase = getSupabaseClient();

  // Note: event_id param is accepted but not used - the database function
  // auto-generates the event ID and returns it. The event_id field is kept
  // in the interface for potential future idempotency support.

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

  // Add audit context fields (for audit trail)
  if (params.user_id) {
    metadata.user_id = params.user_id;
  }
  if (params.reason) {
    metadata.reason = params.reason;
  }
  if (params.ip_address) {
    metadata.ip_address = params.ip_address;
  }
  if (params.user_agent) {
    metadata.user_agent = params.user_agent;
  }
  if (params.request_id) {
    metadata.request_id = params.request_id;
  }

  // Insert event into domain_events table via RPC function
  // (PostgREST only exposes 'api' schema, so we use RPC to access public.domain_events)
  //
  // Function signature: api.emit_domain_event(
  //   p_stream_id uuid,       -- aggregate_id (the entity ID)
  //   p_stream_type text,     -- aggregate_type (e.g., 'organization', 'role')
  //   p_event_type text,      -- event type (e.g., 'organization.created')
  //   p_event_data jsonb,     -- event payload
  //   p_event_metadata jsonb  -- audit context (optional, defaults to '{}')
  // )
  // Returns: UUID of the created event
  //
  // Note: stream_version is auto-calculated by the function.
  // Note: eventId is not passed - the function generates and returns it.
  const { data: returnedEventId, error } = await supabase
    .schema('api')
    .rpc('emit_domain_event', {
      p_stream_id: params.aggregate_id,
      p_stream_type: params.aggregate_type,
      p_event_type: params.event_type,
      p_event_data: params.event_data,
      p_event_metadata: metadata
    });

  if (error) {
    throw new Error(`Failed to emit event: ${error.message}`);
  }

  // The function returns the generated event UUID
  const emittedEventId = returnedEventId as string;
  console.log(`[Event Emitter] Emitted ${params.event_type} event: ${emittedEventId}`);
  return emittedEventId;
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
