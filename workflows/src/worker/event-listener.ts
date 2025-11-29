/**
 * Workflow Event Listener
 *
 * Subscribes to workflow_queue_projection via Supabase Realtime and starts
 * Temporal workflows when new jobs appear.
 *
 * Architecture Pattern: CQRS Projection → Realtime Subscription → Temporal Workflow
 *
 * Flow:
 *   1. Edge Function emits organization.bootstrap.initiated event
 *   2. Database trigger creates workflow_queue_projection entry (status=pending)
 *   3. This listener receives Realtime notification
 *   4. Worker claims job by emitting workflow.queue.claimed event
 *   5. Database trigger updates projection (status=processing)
 *   6. Worker starts Temporal workflow
 *   7. Worker emits workflow.queue.completed or workflow.queue.failed event
 *
 * CQRS Pattern (Strict):
 *   - Read Model: workflow_queue_projection (subscribed via Realtime)
 *   - Write Path: ALL updates via events (workflow.queue.claimed, completed, failed)
 *   - No direct database updates (maintains event sourcing immutability)
 *
 * Benefits:
 *   - Works through connection poolers (no PostgreSQL LISTEN/NOTIFY)
 *   - Event-driven architecture (CQRS/Event Sourcing)
 *   - Resilient (processes jobs even if worker was down)
 *   - Observable (all state changes recorded as events)
 *   - Idempotent (same job won't start duplicate workflows)
 *
 * Author: A4C Infrastructure Team
 * Created: 2025-11-23
 * Updated: 2025-11-28 (Migrated to Realtime + strict CQRS)
 */

import { Connection, Client as TemporalClient } from '@temporalio/client';
import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';
import type { RealtimeChannel } from '@supabase/realtime-js';
import type { OrganizationBootstrapParams } from '../shared/types';

export interface WorkflowQueueJob {
  id: string;                    // Queue entry ID
  event_id: string;              // Original domain event ID
  event_type: string;            // Original event type
  event_data: any;               // Event payload
  stream_id: string;             // Stream ID
  stream_type: string;           // Stream type
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
}

/**
 * Validate required environment variables
 * @throws Error if required variables are missing or invalid
 */
function validateEnvironment(): void {
  const required = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS,
    TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE
  };

  const missing = Object.entries(required)
    .filter(([_, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `Please check ConfigMap (workflow-worker-config) and Secrets (workflow-worker-secrets)`
    );
  }

  // Validate URL format
  try {
    new URL(required.SUPABASE_URL!);
  } catch {
    throw new Error(`Invalid SUPABASE_URL format: ${required.SUPABASE_URL}`);
  }

  // Validate Temporal address format (host:port)
  if (!/^[^:]+:\d+$/.test(required.TEMPORAL_ADDRESS!)) {
    throw new Error(
      `Invalid TEMPORAL_ADDRESS format: ${required.TEMPORAL_ADDRESS} (expected "host:port")`
    );
  }
}

export class WorkflowEventListener {
  private subscription: RealtimeChannel | null = null;
  private temporalClient: TemporalClient;
  private supabaseClient: SupabaseClient;
  private isListening = false;

  constructor(
    temporalClient: TemporalClient,
    supabaseClient: SupabaseClient
  ) {
    this.temporalClient = temporalClient;
    this.supabaseClient = supabaseClient;
  }

  /**
   * Start listening for workflow queue jobs via Supabase Realtime
   */
  async start(): Promise<void> {
    if (this.isListening) {
      console.log('[EventListener] Already listening, skipping start');
      return;
    }

    try {
      // Subscribe to workflow_queue_projection INSERT events (status=pending)
      this.subscription = this.supabaseClient
        .channel('workflow_queue')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'workflow_queue_projection',
            filter: 'status=eq.pending'
          },
          (payload) => {
            this.handleQueueJob(payload.new).catch((error) => {
              console.error('[EventListener] Error handling queue job:', error);
            });
          }
        )
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            this.isListening = true;
            console.log('[EventListener] ✅ Subscribed to workflow queue via Supabase Realtime');
            console.log('[EventListener]    Channel: workflow_queue');
            console.log('[EventListener]    Table: workflow_queue_projection');
            console.log('[EventListener]    Filter: status=eq.pending');
          } else if (status === 'CLOSED') {
            this.isListening = false;
            console.log('[EventListener] ⚠️  Subscription closed');
          } else if (status === 'CHANNEL_ERROR') {
            console.error('[EventListener] ❌ Subscription error:', err);
            this.isListening = false;
            // Attempt reconnection
            this.reconnect();
          }
        });

      console.log('[EventListener] Subscription initiated...');
    } catch (error) {
      console.error('[EventListener] Failed to start listener:', error);
      throw error;
    }
  }

  /**
   * Stop listening for events
   */
  async stop(): Promise<void> {
    if (!this.isListening || !this.subscription) {
      return;
    }

    try {
      await this.subscription.unsubscribe();
      this.isListening = false;
      console.log('[EventListener] Stopped listening for workflow events');
    } catch (error) {
      console.error('[EventListener] Error stopping listener:', error);
    }
  }

  /**
   * Handle incoming queue job from Supabase Realtime
   */
  private async handleQueueJob(job: any): Promise<void> {
    if (!job) {
      console.warn('[EventListener] Received null job, skipping');
      return;
    }

    try {
      // Map Realtime payload to WorkflowQueueJob format
      const queueJob: WorkflowQueueJob = {
        id: job.id,
        event_id: job.event_id,
        event_type: job.event_type,
        event_data: job.event_data,
        stream_id: job.stream_id,
        stream_type: job.stream_type,
        status: job.status,
        created_at: job.created_at
      };

      console.log('[EventListener] Received queue job:', {
        queue_id: queueJob.id,
        event_id: queueJob.event_id,
        event_type: queueJob.event_type,
        stream_id: queueJob.stream_id
      });

      // Route to appropriate handler based on event type
      switch (queueJob.event_type) {
        case 'organization.bootstrap.initiated':
          await this.handleBootstrapJob(queueJob);
          break;

        default:
          console.log(`[EventListener] No handler for event type: ${queueJob.event_type}`);
      }
    } catch (error) {
      console.error('[EventListener] Error handling queue job:', error);
      console.error('[EventListener] Job:', JSON.stringify(job, null, 2));
    }
  }

  /**
   * Handle organization.bootstrap.initiated queue job
   */
  private async handleBootstrapJob(job: WorkflowQueueJob): Promise<void> {
    const { id: queueId, event_id, event_data, stream_id } = job;

    try {
      // Step 1: Claim the job (emit workflow.queue.claimed event)
      const workerId = process.env.HOSTNAME || `worker-${process.pid}`;
      const workflowId = `org-bootstrap-${stream_id}`;

      await this.emitQueueClaimedEvent(event_id, queueId, workerId, workflowId);

      console.log('[EventListener] ✅ Claimed queue job:', { queue_id: queueId, worker_id: workerId });

      // Step 2: Build workflow parameters from event data
      const workflowParams: OrganizationBootstrapParams = {
        subdomain: event_data.subdomain,
        orgData: event_data.orgData,
        users: event_data.users
      };

      console.log('[EventListener] Starting workflow:', {
        workflowId,
        event_id,
        orgName: workflowParams.orgData.name
      });

      // Step 3: Start Temporal workflow
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

      // Step 4: Emit workflow_started event (existing behavior)
      await this.emitWorkflowStartedEvent(
        stream_id,
        event_id,
        handle.workflowId,
        handle.firstExecutionRunId
      );

      // Step 5: Emit workflow.queue.completed event
      await this.emitQueueCompletedEvent(event_id, queueId, handle.firstExecutionRunId);

      console.log('[EventListener] ✅ Workflow queue job completed:', { queue_id: queueId });
    } catch (error) {
      console.error('[EventListener] Failed to process queue job:', error);

      // Emit workflow.queue.failed event
      await this.emitQueueFailedEvent(event_id, queueId, error);
    }
  }

  /**
   * Emit organization.bootstrap.workflow_started event
   * Maintains event sourcing immutability by creating new event instead of updating existing one
   */
  private async emitWorkflowStartedEvent(
    streamId: string,
    bootstrapEventId: string,
    workflowId: string,
    workflowRunId: string
  ): Promise<void> {
    try {
      const { data: eventId, error } = await this.supabaseClient
        .schema('api')
        .rpc('emit_workflow_started_event', {
          p_stream_id: streamId,
          p_bootstrap_event_id: bootstrapEventId,
          p_workflow_id: workflowId,
          p_workflow_run_id: workflowRunId,
          p_workflow_type: 'organizationBootstrapWorkflow'
        });

      if (error) {
        console.error('[EventListener] Failed to emit workflow_started event:', error);
        // Don't throw - workflow already started successfully
      } else {
        console.log('[EventListener] ✅ Emitted workflow_started event:', eventId);
      }
    } catch (error) {
      console.error('[EventListener] Error emitting workflow_started event:', error);
      // Don't throw - workflow already started successfully
    }
  }

  /**
   * Emit workflow.queue.claimed event (strict CQRS)
   * Updates projection status to 'processing' via trigger
   */
  private async emitQueueClaimedEvent(
    eventId: string,
    queueId: string,
    workerId: string,
    workflowId: string
  ): Promise<void> {
    try {
      const { error } = await this.supabaseClient
        .schema('api')
        .rpc('emit_domain_event', {
          p_stream_id: queueId,
          p_stream_type: 'workflow_queue',
          p_stream_version: 1,
          p_event_type: 'workflow.queue.claimed',
          p_event_data: {
            event_id: eventId,
            queue_id: queueId,
            worker_id: workerId,
            workflow_id: workflowId,
            claimed_at: new Date().toISOString()
          },
          p_event_metadata: {
            worker_hostname: process.env.HOSTNAME,
            worker_pid: process.pid
          }
        });

      if (error) {
        console.error('[EventListener] Failed to emit workflow.queue.claimed event:', error);
        throw error; // Critical - must claim job
      }
    } catch (error) {
      console.error('[EventListener] Error emitting workflow.queue.claimed event:', error);
      throw error;
    }
  }

  /**
   * Emit workflow.queue.completed event (strict CQRS)
   * Updates projection status to 'completed' via trigger
   */
  private async emitQueueCompletedEvent(
    eventId: string,
    queueId: string,
    workflowRunId: string
  ): Promise<void> {
    try {
      const { error } = await this.supabaseClient
        .schema('api')
        .rpc('emit_domain_event', {
          p_stream_id: queueId,
          p_stream_type: 'workflow_queue',
          p_stream_version: 2,
          p_event_type: 'workflow.queue.completed',
          p_event_data: {
            event_id: eventId,
            queue_id: queueId,
            workflow_run_id: workflowRunId,
            completed_at: new Date().toISOString()
          },
          p_event_metadata: {
            worker_hostname: process.env.HOSTNAME,
            worker_pid: process.pid
          }
        });

      if (error) {
        console.error('[EventListener] Failed to emit workflow.queue.completed event:', error);
        // Don't throw - workflow already started successfully
      }
    } catch (error) {
      console.error('[EventListener] Error emitting workflow.queue.completed event:', error);
      // Don't throw - workflow already started successfully
    }
  }

  /**
   * Emit workflow.queue.failed event (strict CQRS)
   * Updates projection status to 'failed' via trigger
   */
  private async emitQueueFailedEvent(
    eventId: string,
    queueId: string,
    error: any
  ): Promise<void> {
    try {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      const { error: rpcError } = await this.supabaseClient
        .schema('api')
        .rpc('emit_domain_event', {
          p_stream_id: queueId,
          p_stream_type: 'workflow_queue',
          p_stream_version: 2,
          p_event_type: 'workflow.queue.failed',
          p_event_data: {
            event_id: eventId,
            queue_id: queueId,
            error_message: errorMessage,
            error_stack: errorStack,
            failed_at: new Date().toISOString(),
            retry_count: 0
          },
          p_event_metadata: {
            worker_hostname: process.env.HOSTNAME,
            worker_pid: process.pid
          }
        });

      if (rpcError) {
        console.error('[EventListener] Failed to emit workflow.queue.failed event:', rpcError);
        // Don't throw - already in error state
      }
    } catch (emitError) {
      console.error('[EventListener] Error emitting workflow.queue.failed event:', emitError);
      // Don't throw - already in error state
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
  // Validate environment variables first
  validateEnvironment();

  // Create Supabase client
  const supabaseClient = createSupabaseClient(
    process.env.SUPABASE_URL!,  // Already validated
    process.env.SUPABASE_SERVICE_ROLE_KEY!,  // Already validated
    {
      auth: {
        persistSession: false
      },
      global: {
        headers: {
          'x-application-name': 'temporal-worker'
        }
      }
    }
  );

  // Create Temporal connection
  let connection: Connection;
  try {
    connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS!  // Already validated
    });
  } catch (error) {
    throw new Error(
      `Failed to connect to Temporal at ${process.env.TEMPORAL_ADDRESS}: ${error}`
    );
  }

  // Create Temporal client
  const temporalClient = new TemporalClient({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default'
  });

  // Create and start listener
  const listener = new WorkflowEventListener(temporalClient, supabaseClient);

  try {
    await listener.start();
  } catch (error) {
    // Close Temporal connection if listener fails
    await connection.close();
    throw new Error(`Failed to start event listener: ${error}`);
  }

  return listener;
}
