-- =====================================================================
-- ENQUEUE WORKFLOW FROM BOOTSTRAP EVENT TRIGGER
-- =====================================================================
-- Purpose: Automatically enqueue workflow job when bootstrap initiated
-- Pattern: Event-driven workflow queue population
-- Source Event: organization.bootstrap.initiated
-- Target Event: workflow.queue.pending
--
-- Flow:
-- 1. Edge Function emits organization.bootstrap.initiated event
-- 2. This trigger fires and emits workflow.queue.pending event
-- 3. update_workflow_queue_projection trigger creates queue entry
-- 4. Worker detects new queue entry via Realtime subscription
--
-- Why Two Events?
-- - organization.bootstrap.initiated: Domain event (business event)
-- - workflow.queue.pending: Infrastructure event (queue management)
-- - Separation of concerns: domain vs infrastructure
--
-- Idempotency:
-- - Uses emit_domain_event RPC which prevents duplicate event IDs
-- - Safe to replay bootstrap events
--
-- Related Files:
-- - Projection trigger: infrastructure/supabase/sql/04-triggers/update_workflow_queue_projection.sql
-- - Contracts: infrastructure/supabase/contracts/organization-bootstrap-events.yaml
-- =====================================================================

-- Create trigger function to enqueue workflow jobs (idempotent)
CREATE OR REPLACE FUNCTION enqueue_workflow_from_bootstrap_event()
RETURNS TRIGGER AS $$
DECLARE
    v_pending_event_id UUID;
BEGIN
    -- Only process organization.bootstrap.initiated events
    IF NEW.event_type = 'organization.bootstrap.initiated' THEN
        -- Emit workflow.queue.pending event
        -- This will be caught by update_workflow_queue_projection trigger
        SELECT api.emit_domain_event(
            p_stream_id := NEW.stream_id,
            p_stream_type := 'workflow_queue',
            p_stream_version := 1,
            p_event_type := 'workflow.queue.pending',
            p_event_data := jsonb_build_object(
                'event_id', NEW.id,              -- Link to bootstrap event
                'event_type', NEW.event_type,    -- Original event type
                'event_data', NEW.event_data,    -- Original event payload
                'stream_id', NEW.stream_id,      -- Original stream ID
                'stream_type', NEW.stream_type   -- Original stream type
            ),
            p_event_metadata := jsonb_build_object(
                'triggered_by', 'enqueue_workflow_from_bootstrap_event',
                'source_event_id', NEW.id
            )
        ) INTO v_pending_event_id;

        -- Log for debugging (appears in Supabase logs)
        RAISE NOTICE 'Enqueued workflow job: event_id=%, pending_event_id=%',
            NEW.id, v_pending_event_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists (idempotent)
DROP TRIGGER IF EXISTS enqueue_workflow_from_bootstrap_event_trigger
    ON domain_events;

-- Create trigger on domain_events INSERT (idempotent)
CREATE TRIGGER enqueue_workflow_from_bootstrap_event_trigger
    AFTER INSERT ON domain_events
    FOR EACH ROW
    WHEN (NEW.event_type = 'organization.bootstrap.initiated')
    EXECUTE FUNCTION enqueue_workflow_from_bootstrap_event();

-- Add comment for documentation
COMMENT ON FUNCTION enqueue_workflow_from_bootstrap_event() IS
    'Automatically enqueues workflow jobs by emitting workflow.queue.pending event '
    'when organization.bootstrap.initiated event is inserted. '
    'Part of strict CQRS architecture for workflow queue management.';
