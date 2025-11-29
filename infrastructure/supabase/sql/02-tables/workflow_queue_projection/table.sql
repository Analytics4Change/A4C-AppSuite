-- =====================================================================
-- WORKFLOW QUEUE PROJECTION TABLE
-- =====================================================================
-- Purpose: CQRS read model for workflow job queue
-- Pattern: Event-driven projection (updated via triggers)
-- Source: domain_events table (organization.bootstrap.initiated events)
-- Consumer: Temporal workers via Supabase Realtime subscription
--
-- CQRS Architecture:
-- - Write model: domain_events (immutable event store)
-- - Read model: workflow_queue_projection (mutable queue state)
-- - Updates: All status changes via events + triggers (strict CQRS)
--
-- Realtime Configuration:
-- - Added to supabase_realtime publication for worker subscriptions
-- - Workers filter: status=eq.pending to detect new jobs
-- - RLS policy: service_role can SELECT (workers use service_role key)
--
-- Status Lifecycle:
-- 1. pending    - Job created by trigger, awaiting worker claim
-- 2. processing - Worker claimed job via workflow.queue.claimed event
-- 3. completed  - Workflow succeeded via workflow.queue.completed event
-- 4. failed     - Workflow failed via workflow.queue.failed event
--
-- Related Events (see infrastructure/supabase/contracts/):
-- - workflow.queue.pending   - Creates new queue entry
-- - workflow.queue.claimed   - Updates to processing
-- - workflow.queue.completed - Updates to completed
-- - workflow.queue.failed    - Updates to failed
-- =====================================================================

-- Create workflow queue projection table (idempotent)
CREATE TABLE IF NOT EXISTS workflow_queue_projection (
    -- Primary key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Event tracking (links to domain_events)
    event_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    event_data JSONB NOT NULL,

    -- Stream identification (from domain event)
    stream_id UUID NOT NULL,
    stream_type TEXT NOT NULL,

    -- Queue status
    status TEXT NOT NULL DEFAULT 'pending',

    -- Worker tracking
    worker_id TEXT,
    claimed_at TIMESTAMPTZ,

    -- Workflow tracking (Temporal)
    workflow_id TEXT,
    workflow_run_id TEXT,

    -- Completion tracking
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    error_message TEXT,
    error_stack TEXT,
    retry_count INTEGER DEFAULT 0,

    -- Result storage
    result JSONB,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT workflow_queue_projection_status_check
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    CONSTRAINT workflow_queue_projection_event_id_unique
        UNIQUE (event_id)
);

-- Create indexes for query performance (idempotent)
CREATE INDEX IF NOT EXISTS workflow_queue_projection_status_idx
    ON workflow_queue_projection(status);

CREATE INDEX IF NOT EXISTS workflow_queue_projection_event_type_idx
    ON workflow_queue_projection(event_type);

CREATE INDEX IF NOT EXISTS workflow_queue_projection_stream_id_idx
    ON workflow_queue_projection(stream_id);

CREATE INDEX IF NOT EXISTS workflow_queue_projection_created_at_idx
    ON workflow_queue_projection(created_at DESC);

CREATE INDEX IF NOT EXISTS workflow_queue_projection_workflow_id_idx
    ON workflow_queue_projection(workflow_id)
    WHERE workflow_id IS NOT NULL;

-- Enable Row Level Security (required for Supabase)
ALTER TABLE workflow_queue_projection ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for service_role (workers)
DROP POLICY IF EXISTS "workflow_queue_projection_service_role_select"
    ON workflow_queue_projection;

CREATE POLICY "workflow_queue_projection_service_role_select"
    ON workflow_queue_projection
    FOR SELECT
    TO service_role
    USING (true);

-- Add table to Realtime publication (workers subscribe via Supabase Realtime)
DO $$
BEGIN
    -- Check if table is already in publication
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'workflow_queue_projection'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE workflow_queue_projection;
    END IF;
END $$;

-- Grant necessary permissions
GRANT SELECT ON workflow_queue_projection TO service_role;

-- Create updated_at trigger function (idempotent)
CREATE OR REPLACE FUNCTION update_workflow_queue_projection_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update updated_at column (idempotent)
DROP TRIGGER IF EXISTS workflow_queue_projection_updated_at_trigger
    ON workflow_queue_projection;

CREATE TRIGGER workflow_queue_projection_updated_at_trigger
    BEFORE UPDATE ON workflow_queue_projection
    FOR EACH ROW
    EXECUTE FUNCTION update_workflow_queue_projection_updated_at();

-- Add comment for documentation
COMMENT ON TABLE workflow_queue_projection IS
    'CQRS projection: Workflow job queue for Temporal workers. '
    'Updated via triggers processing domain events. '
    'Workers subscribe via Supabase Realtime (filter: status=eq.pending).';
