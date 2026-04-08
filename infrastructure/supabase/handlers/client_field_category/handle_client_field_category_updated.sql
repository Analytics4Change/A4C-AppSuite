CREATE OR REPLACE FUNCTION public.handle_client_field_category_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_field_categories SET
        name       = COALESCE(p_event.event_data->>'name', name),
        sort_order = COALESCE((p_event.event_data->>'sort_order')::integer, sort_order),
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'category_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;
