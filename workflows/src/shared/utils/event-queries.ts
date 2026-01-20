/**
 * Event Query Utilities
 *
 * Helper functions for querying domain events with workflow context.
 * Enables bi-directional traceability between events and workflows.
 *
 * Use Cases:
 *   - Debugging: Find all events for a failed workflow
 *   - Monitoring: Track workflow progress via event stream
 *   - Replay: Reconstruct workflow state from events
 *   - Audit: Trace which workflow created specific events
 *
 * Author: A4C Infrastructure Team
 * Created: 2025-11-23
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database.types.js';

/**
 * Domain Event structure from database
 */
export interface DomainEvent {
  id: string;
  sequence_number: number;
  stream_id: string;
  stream_type: string;
  stream_version: number;
  event_type: string;
  event_data: Record<string, any>;
  event_metadata: {
    workflow_id?: string;
    workflow_run_id?: string;
    workflow_type?: string;
    activity_id?: string;
    timestamp?: string;
    [key: string]: any;
  };
  created_at: string;
  processed_at: string | null;
  processing_error: string | null;
  retry_count: number | null;
}

/**
 * Event query result with metadata
 */
export interface EventQueryResult {
  events: DomainEvent[];
  total_count: number;
  has_errors: boolean;
  first_event_at: string | null;
  last_event_at: string | null;
}

/**
 * Workflow summary from events
 */
export interface WorkflowSummary {
  workflow_id: string;
  workflow_run_id: string | null;
  workflow_type: string | null;
  total_events: number;
  event_types: string[];
  first_event_at: string;
  last_event_at: string;
  has_errors: boolean;
  error_count: number;
}

export class EventQueries {
  private supabase: SupabaseClient<Database>;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient<Database>(supabaseUrl, supabaseKey);
  }

  /**
   * Get all events for a specific workflow
   *
   * @param workflowId - The workflow ID (e.g., 'org-bootstrap-abc123')
   * @param options - Query options
   * @returns All events emitted during the workflow execution
   *
   * @example
   * const result = await queries.getEventsForWorkflow('org-bootstrap-abc123');
   * console.log(`Found ${result.total_count} events`);
   * result.events.forEach(event => console.log(event.event_type));
   */
  async getEventsForWorkflow(
    workflowId: string,
    options: { includeProcessingErrors?: boolean } = {}
  ): Promise<EventQueryResult> {
    let query = this.supabase
      .from('domain_events')
      .select('*')
      .eq('event_metadata->>workflow_id', workflowId)
      .order('created_at', { ascending: true });

    if (!options.includeProcessingErrors) {
      query = query.is('processing_error', null);
    }

    const { data: events, error } = await query;

    if (error) {
      throw new Error(`Failed to query events for workflow ${workflowId}: ${error.message}`);
    }

    const hasErrors = events?.some((e) => e.processing_error !== null) ?? false;
    const firstEvent = events?.[0];
    const lastEvent = events?.[events.length - 1];

    return {
      events: events || [],
      total_count: events?.length || 0,
      has_errors: hasErrors,
      first_event_at: firstEvent?.created_at || null,
      last_event_at: lastEvent?.created_at || null
    };
  }

  /**
   * Get workflow context from a specific event
   *
   * @param eventId - The event ID
   * @returns Workflow ID and run ID that created this event
   *
   * @example
   * const workflow = await queries.getWorkflowForEvent('event-uuid');
   * if (workflow) {
   *   console.log(`Event created by workflow: ${workflow.workflow_id}`);
   * }
   */
  async getWorkflowForEvent(eventId: string): Promise<{
    workflow_id: string | null;
    workflow_run_id: string | null;
    workflow_type: string | null;
  } | null> {
    const { data, error } = await this.supabase
      .from('domain_events')
      .select('event_metadata')
      .eq('id', eventId)
      .single();

    if (error || !data) {
      return null;
    }

    // Cast event_metadata to the expected shape
    const metadata = data.event_metadata as DomainEvent['event_metadata'] | null;
    return {
      workflow_id: metadata?.workflow_id ?? null,
      workflow_run_id: metadata?.workflow_run_id ?? null,
      workflow_type: metadata?.workflow_type ?? null
    };
  }

  /**
   * Get the bootstrap event for an organization
   *
   * @param orgId - The organization ID (stream_id)
   * @returns The organization.bootstrap.initiated event
   *
   * @example
   * const bootstrapEvent = await queries.getBootstrapEventForOrg('org-uuid');
   * const workflowId = bootstrapEvent?.event_metadata?.workflow_id;
   */
  async getBootstrapEventForOrg(orgId: string): Promise<DomainEvent | null> {
    const { data, error } = await this.supabase
      .from('domain_events')
      .select('*')
      .eq('stream_id', orgId)
      .eq('event_type', 'organization.bootstrap.initiated')
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  /**
   * Get workflow summary with event statistics
   *
   * @param workflowId - The workflow ID
   * @returns Summary of workflow execution based on events
   *
   * @example
   * const summary = await queries.getWorkflowSummary('org-bootstrap-abc123');
   * console.log(`Workflow emitted ${summary.total_events} events`);
   * console.log(`Event types: ${summary.event_types.join(', ')}`);
   */
  async getWorkflowSummary(workflowId: string): Promise<WorkflowSummary | null> {
    const result = await this.getEventsForWorkflow(workflowId, { includeProcessingErrors: true });

    if (result.total_count === 0) {
      return null;
    }

    const events = result.events;
    const eventTypes = [...new Set(events.map((e) => e.event_type))];
    const errorCount = events.filter((e) => e.processing_error !== null).length;
    const firstEvent = events[0];

    if (!firstEvent) {
      throw new Error(`No events found for workflow ${workflowId}`);
    }

    return {
      workflow_id: workflowId,
      workflow_run_id: firstEvent.event_metadata?.workflow_run_id || null,
      workflow_type: firstEvent.event_metadata?.workflow_type || null,
      total_events: result.total_count,
      event_types: eventTypes,
      first_event_at: result.first_event_at!,
      last_event_at: result.last_event_at!,
      has_errors: result.has_errors,
      error_count: errorCount
    };
  }

  /**
   * Get all events of a specific type for a workflow
   *
   * @param workflowId - The workflow ID
   * @param eventType - The event type to filter by
   * @returns Events matching the type
   *
   * @example
   * const contacts = await queries.getEventsByType('org-bootstrap-abc123', 'contact.added');
   * console.log(`Added ${contacts.length} contacts`);
   */
  async getEventsByType(workflowId: string, eventType: string): Promise<DomainEvent[]> {
    const { data, error } = await this.supabase
      .from('domain_events')
      .select('*')
      .eq('event_metadata->>workflow_id', workflowId)
      .eq('event_type', eventType)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to query events: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get events emitted by a specific activity
   *
   * @param workflowId - The workflow ID
   * @param activityId - The activity name
   * @returns Events emitted by the activity
   *
   * @example
   * const events = await queries.getEventsByActivity(
   *   'org-bootstrap-abc123',
   *   'createOrganizationActivity'
   * );
   */
  async getEventsByActivity(workflowId: string, activityId: string): Promise<DomainEvent[]> {
    const { data, error } = await this.supabase
      .from('domain_events')
      .select('*')
      .eq('event_metadata->>workflow_id', workflowId)
      .eq('event_metadata->>activity_id', activityId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to query events by activity: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find workflows with processing errors
   *
   * @param limit - Maximum number of workflows to return
   * @returns Workflows that have events with processing errors
   *
   * @example
   * const failed = await queries.getFailedWorkflows(10);
   * failed.forEach(wf => console.log(`${wf.workflow_id} has ${wf.error_count} errors`));
   */
  async getFailedWorkflows(limit: number = 10): Promise<WorkflowSummary[]> {
    // This is a complex query - need to group by workflow_id from metadata
    const { data, error } = await this.supabase
      .from('domain_events')
      .select('event_metadata, processing_error')
      .not('processing_error', 'is', null)
      .not('event_metadata->>workflow_id', 'is', null)
      .limit(100); // Get more events, then group in memory

    if (error || !data) {
      return [];
    }

    // Group events by workflow_id
    const workflowMap = new Map<string, DomainEvent[]>();
    for (const event of data as DomainEvent[]) {
      const workflowId = event.event_metadata?.workflow_id;
      if (workflowId) {
        if (!workflowMap.has(workflowId)) {
          workflowMap.set(workflowId, []);
        }
        workflowMap.get(workflowId)!.push(event);
      }
    }

    // Build summaries
    const summaries: WorkflowSummary[] = [];
    for (const [workflowId] of workflowMap.entries()) {
      const summary = await this.getWorkflowSummary(workflowId);
      if (summary) {
        summaries.push(summary);
      }
    }

    return summaries.slice(0, limit);
  }

  /**
   * Trace workflow lineage from organization
   *
   * Gets the bootstrap event, then all events for that workflow.
   * Useful for complete audit trail.
   *
   * @param orgId - The organization ID
   * @returns Complete event history for organization bootstrap
   *
   * @example
   * const history = await queries.traceWorkflowLineage('org-uuid');
   * console.log(`Bootstrap workflow: ${history.workflow_id}`);
   * console.log(`Total events: ${history.events.length}`);
   */
  async traceWorkflowLineage(orgId: string): Promise<{
    workflow_id: string | null;
    bootstrap_event: DomainEvent | null;
    events: DomainEvent[];
  }> {
    const bootstrapEvent = await this.getBootstrapEventForOrg(orgId);

    if (!bootstrapEvent || !bootstrapEvent.event_metadata?.workflow_id) {
      return {
        workflow_id: null,
        bootstrap_event: bootstrapEvent,
        events: []
      };
    }

    const result = await this.getEventsForWorkflow(bootstrapEvent.event_metadata.workflow_id);

    return {
      workflow_id: bootstrapEvent.event_metadata.workflow_id,
      bootstrap_event: bootstrapEvent,
      events: result.events
    };
  }
}

/**
 * Create event queries instance from environment variables
 */
export function createEventQueries(): EventQueries {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  return new EventQueries(supabaseUrl, supabaseKey);
}
