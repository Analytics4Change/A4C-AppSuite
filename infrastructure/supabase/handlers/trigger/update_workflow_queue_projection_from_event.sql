CREATE OR REPLACE FUNCTION public.update_workflow_queue_projection_from_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    IF NEW.event_type = 'workflow.queue.pending' THEN
        INSERT INTO workflow_queue_projection (
            event_id, event_type, event_data, stream_id, stream_type,
            status, created_at, updated_at
        ) VALUES (
            (NEW.event_data->>'event_id')::UUID,
            NEW.event_data->>'event_type',
            (NEW.event_data->'event_data')::JSONB,
            NEW.stream_id, NEW.stream_type,
            'pending', NOW(), NOW()
        ) ON CONFLICT (event_id) DO NOTHING;

    ELSIF NEW.event_type = 'workflow.queue.claimed' THEN
        UPDATE workflow_queue_projection SET
            status = 'processing',
            worker_id = NEW.event_data->>'worker_id',
            claimed_at = (NEW.event_data->>'claimed_at')::TIMESTAMPTZ,
            workflow_id = NEW.event_data->>'workflow_id',
            updated_at = NOW()
        WHERE event_id = (NEW.event_data->>'event_id')::UUID
          AND status = 'pending';

    ELSIF NEW.event_type = 'workflow.queue.completed' THEN
        UPDATE workflow_queue_projection SET
            status = 'completed',
            completed_at = (NEW.event_data->>'completed_at')::TIMESTAMPTZ,
            workflow_run_id = NEW.event_data->>'workflow_run_id',
            result = (NEW.event_data->'result')::JSONB,
            updated_at = NOW()
        WHERE event_id = (NEW.event_data->>'event_id')::UUID
          AND status = 'processing';

    ELSIF NEW.event_type = 'workflow.queue.failed' THEN
        UPDATE workflow_queue_projection SET
            status = 'failed',
            failed_at = (NEW.event_data->>'failed_at')::TIMESTAMPTZ,
            error_message = NEW.event_data->>'error_message',
            error_stack = NEW.event_data->>'error_stack',
            retry_count = COALESCE((NEW.event_data->>'retry_count')::INTEGER, 0),
            updated_at = NOW()
        WHERE event_id = (NEW.event_data->>'event_id')::UUID
          AND status = 'processing';

    END IF;

    RETURN NEW;
END;
$function$;
