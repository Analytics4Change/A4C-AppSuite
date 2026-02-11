CREATE OR REPLACE FUNCTION public.notify_workflow_worker_bootstrap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  notification_payload jsonb;
BEGIN
  -- Only notify for organization.bootstrap.initiated events
  IF NEW.event_type = 'organization.bootstrap.initiated' THEN

    notification_payload := jsonb_build_object(
      'event_id', NEW.id,
      'event_type', NEW.event_type,
      'stream_id', NEW.stream_id,
      'stream_type', NEW.stream_type,
      'event_data', NEW.event_data,
      'event_metadata', NEW.event_metadata,
      'created_at', NEW.created_at
    );

    PERFORM pg_notify('workflow_events', notification_payload::text);

    RAISE NOTICE 'Notified workflow worker: event_id=%, stream_id=%',
      NEW.id, NEW.stream_id;

  END IF;

  RETURN NEW;
END;
$function$;
