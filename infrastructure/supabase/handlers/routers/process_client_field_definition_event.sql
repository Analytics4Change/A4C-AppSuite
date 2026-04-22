CREATE OR REPLACE FUNCTION public.process_client_field_definition_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    CASE p_event.event_type

        WHEN 'client_field_definition.created' THEN
            PERFORM handle_client_field_definition_created(p_event);

        WHEN 'client_field_definition.updated' THEN
            PERFORM handle_client_field_definition_updated(p_event);

        WHEN 'client_field_definition.deactivated' THEN
            PERFORM handle_client_field_definition_deactivated(p_event);

        WHEN 'client_field_definition.reactivated' THEN
            PERFORM handle_client_field_definition_reactivated(p_event);

        WHEN 'client_field_definition.deleted' THEN
            PERFORM handle_client_field_definition_deleted(p_event);

        ELSE
            RAISE EXCEPTION 'Unhandled event type "%" in process_client_field_definition_event', p_event.event_type
                USING ERRCODE = 'P9001';
    END CASE;
END;
$function$;
