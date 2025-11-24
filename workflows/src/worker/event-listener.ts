/**
 * Workflow Event Listener
 *
 * Subscribes to PostgreSQL NOTIFY channel and starts Temporal workflows
 * when domain events are emitted.
 *
 * Architecture Pattern: Database Trigger → NOTIFY → This Listener → Temporal Workflow
 *
 * Flow:
 *   1. PostgreSQL trigger emits NOTIFY on 'workflow_events' channel
 *   2. This listener receives notification payload
 *   3. Validates event and extracts workflow parameters
 *   4. Starts Temporal workflow with deterministic workflow ID
 *   5. Updates event record with workflow_id and workflow_run_id
 *
 * Benefits:
 *   - Event-driven architecture (CQRS/Event Sourcing)
 *   - Resilient (processes events even if worker was down)
 *   - Observable (all workflow starts recorded as events)
 *   - Idempotent (same event won't start duplicate workflows)
 *
 * Author: A4C Infrastructure Team
 * Created: 2025-11-23
 */

import { Client as PgClient } from 'pg';
import { Connection, Client as TemporalClient } from '@temporalio/client';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { OrganizationBootstrapParams } from '../shared/types';

export interface EventNotification {
  event_id: string;
  event_type: string;
  stream_id: string;
  stream_type: string;
  event_data: any;
  event_metadata: any;
  created_at: string;
}

export class WorkflowEventListener {
  private pgClient: PgClient;
  private temporalClient: TemporalClient;
  private supabaseClient: ReturnType<typeof createSupabaseClient>;
  private isListening = false;

  constructor(
    pgClient: PgClient,
    temporalClient: TemporalClient,
    supabaseClient: ReturnType<typeof createSupabaseClient>
  ) {
    this.pgClient = pgClient;
    this.temporalClient = temporalClient;
    this.supabaseClient = supabaseClient;
  }

  /**
   * Start listening for workflow events from PostgreSQL NOTIFY
   */
  async start(): Promise<void> {
    if (this.isListening) {
      console.log('[EventListener] Already listening, skipping start');
      return;
    }

    try {
      // Note: pgClient is already connected by createEventListener factory function

      // Subscribe to workflow_events channel
      await this.pgClient.query('LISTEN workflow_events');

      // Set up notification handler
      this.pgClient.on('notification', async (msg: any) => {
        if (msg.channel === 'workflow_events' && msg.payload) {
          await this.handleNotification(msg.payload);
        }
      });

      // Set up error handler
      this.pgClient.on('error', (err: Error) => {
        console.error('[EventListener] PostgreSQL client error:', err);
        // Attempt reconnection
        this.reconnect();
      });

      this.isListening = true;
      console.log('[EventListener] ✅ Listening for workflow events on PostgreSQL channel: workflow_events');
    } catch (error) {
      console.error('[EventListener] Failed to start listener:', error);
      throw error;
    }
  }

  /**
   * Stop listening for events
   */
  async stop(): Promise<void> {
    if (!this.isListening) {
      return;
    }

    try {
      await this.pgClient.query('UNLISTEN workflow_events');
      await this.pgClient.end();
      this.isListening = false;
      console.log('[EventListener] Stopped listening for workflow events');
    } catch (error) {
      console.error('[EventListener] Error stopping listener:', error);
    }
  }

  /**
   * Handle incoming notification from PostgreSQL
   */
  private async handleNotification(payload: string): Promise<void> {
    try {
      const notification: EventNotification = JSON.parse(payload);

      console.log('[EventListener] Received notification:', {
        event_id: notification.event_id,
        event_type: notification.event_type,
        stream_id: notification.stream_id
      });

      // Route to appropriate handler based on event type
      switch (notification.event_type) {
        case 'organization.bootstrap.initiated':
          await this.handleBootstrapEvent(notification);
          break;

        default:
          console.log(`[EventListener] No handler for event type: ${notification.event_type}`);
      }
    } catch (error) {
      console.error('[EventListener] Error handling notification:', error);
      console.error('[EventListener] Payload:', payload);
    }
  }

  /**
   * Handle organization.bootstrap.initiated event
   */
  private async handleBootstrapEvent(notification: EventNotification): Promise<void> {
    const { event_id, event_data, stream_id } = notification;

    try {
      // Build workflow parameters from event data
      const workflowParams: OrganizationBootstrapParams = {
        subdomain: event_data.subdomain,
        orgData: event_data.orgData,
        users: event_data.users
      };

      // Generate deterministic workflow ID (enables idempotency)
      const workflowId = `org-bootstrap-${stream_id}`;

      console.log('[EventListener] Starting workflow:', {
        workflowId,
        event_id,
        orgName: workflowParams.orgData.name
      });

      // Start Temporal workflow
      const handle = await this.temporalClient.workflow.start('organizationBootstrapWorkflow', {
        taskQueue: 'bootstrap',
        workflowId,
        args: [workflowParams]
      });

      console.log('[EventListener] ✅ Workflow started:', {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
        event_id
      });

      // Update event record with workflow context
      await this.updateEventWithWorkflowContext(
        event_id,
        handle.workflowId,
        handle.firstExecutionRunId
      );

      console.log('[EventListener] ✅ Event updated with workflow context:', { event_id });
    } catch (error) {
      console.error('[EventListener] Failed to start workflow:', error);

      // Update event with error
      await this.updateEventWithError(event_id, error);
    }
  }

  /**
   * Update event record with workflow ID and run ID
   */
  private async updateEventWithWorkflowContext(
    eventId: string,
    workflowId: string,
    workflowRunId: string
  ): Promise<void> {
    try {
      const { error } = await (this.supabaseClient
        .from('domain_events') as any)
        .update({
          event_metadata: {
            workflow_id: workflowId,
            workflow_run_id: workflowRunId,
            workflow_type: 'organizationBootstrapWorkflow',
            timestamp: new Date().toISOString()
          },
          processed_at: new Date().toISOString()
        })
        .eq('id', eventId);

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error('[EventListener] Failed to update event with workflow context:', error);
      // Don't throw - workflow already started successfully
    }
  }

  /**
   * Update event with processing error
   */
  private async updateEventWithError(eventId: string, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    try {
      // Get current retry count
      const { data: event } = await (this.supabaseClient
        .from('domain_events') as any)
        .select('event_metadata')
        .eq('id', eventId)
        .single();

      const currentRetryCount = (event?.event_metadata as any)?.retry_count || 0;

      const { error: updateError } = await (this.supabaseClient
        .from('domain_events') as any)
        .update({
          event_metadata: {
            ...((event?.event_metadata as any) || {}),
            processing_error: errorMessage,
            retry_count: currentRetryCount + 1
          }
        })
        .eq('id', eventId);

      if (updateError) {
        console.error('[EventListener] Failed to update event with error:', updateError);
      }
    } catch (err) {
      console.error('[EventListener] Error updating event error:', err);
    }
  }

  /**
   * Attempt to reconnect after connection error
   */
  private async reconnect(): Promise<void> {
    this.isListening = false;

    console.log('[EventListener] Attempting to reconnect in 5 seconds...');

    setTimeout(async () => {
      try {
        await this.start();
        console.log('[EventListener] ✅ Reconnected successfully');
      } catch (error) {
        console.error('[EventListener] Reconnection failed:', error);
        // Try again
        this.reconnect();
      }
    }, 5000);
  }
}

/**
 * Create and start event listener
 */
export async function createEventListener(): Promise<WorkflowEventListener> {
  // PostgreSQL connection (from Supabase connection string)
  const pgClient = new PgClient({
    connectionString: process.env.SUPABASE_DB_URL || process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
  });

  // Connect to PostgreSQL
  await pgClient.connect();

  // Temporal connection and client
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233'
  });

  const temporalClient = new TemporalClient({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default'
  });

  // Supabase client (for updating events)
  const supabaseClient = createSupabaseClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as any;

  const listener = new WorkflowEventListener(pgClient, temporalClient, supabaseClient);
  await listener.start();

  return listener;
}
