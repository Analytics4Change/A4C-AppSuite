-- =============================================================================
-- Migration: Fix enqueue_workflow_from_bootstrap_event trigger
-- =============================================================================
--
-- Problem: The trigger was calling api.emit_domain_event with p_stream_version := 1,
-- but the 5-parameter function doesn't accept this parameter. The Day 0 v2 baseline
-- consolidation removed the 6-parameter overload that accepted p_stream_version.
--
-- Fix: Remove p_stream_version parameter - the function auto-calculates it.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enqueue_workflow_from_bootstrap_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
            -- NOTE: p_stream_version removed - function auto-calculates it
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
$$;

COMMENT ON FUNCTION public.enqueue_workflow_from_bootstrap_event() IS
'Automatically enqueues workflow jobs by emitting workflow.queue.pending event when organization.bootstrap.initiated event is inserted. Part of strict CQRS architecture for workflow queue management.';
