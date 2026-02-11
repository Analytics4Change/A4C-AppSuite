CREATE OR REPLACE FUNCTION public.enqueue_workflow_from_bootstrap_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
            p_event_type := 'workflow.queue.pending',
            p_event_data := jsonb_build_object(
                'event_id', NEW.id,
                'event_type', NEW.event_type,
                'event_data', NEW.event_data,
                'stream_id', NEW.stream_id,
                'stream_type', NEW.stream_type
            ),
            p_event_metadata := jsonb_build_object(
                'triggered_by', 'enqueue_workflow_from_bootstrap_event',
                'source_event_id', NEW.id
            )
        ) INTO v_pending_event_id;

        RAISE NOTICE 'Enqueued workflow job: event_id=%, pending_event_id=%',
            NEW.id, v_pending_event_id;
    END IF;

    RETURN NEW;
END;
$function$;
