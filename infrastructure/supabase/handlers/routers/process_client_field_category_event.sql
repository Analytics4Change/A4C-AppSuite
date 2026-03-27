CREATE OR REPLACE FUNCTION public.process_client_field_category_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    CASE p_event.event_type

        WHEN 'client_field_category.created' THEN
            PERFORM handle_client_field_category_created(p_event);

        WHEN 'client_field_category.deactivated' THEN
            PERFORM handle_client_field_category_deactivated(p_event);

        ELSE
            RAISE EXCEPTION 'Unhandled event type "%" in process_client_field_category_event', p_event.event_type
                USING ERRCODE = 'P9001';
    END CASE;
END;
$function$;
