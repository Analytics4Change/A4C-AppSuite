CREATE OR REPLACE FUNCTION public.handle_client_field_definition_deleted(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    DELETE FROM client_field_definitions_projection
    WHERE id = (p_event.event_data->>'field_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;
