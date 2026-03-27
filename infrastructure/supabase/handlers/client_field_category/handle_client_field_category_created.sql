CREATE OR REPLACE FUNCTION public.handle_client_field_category_created(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO client_field_categories (
        id, organization_id, name, slug, sort_order,
        is_active, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'category_id')::uuid,
        (p_event.event_data->>'organization_id')::uuid,
        p_event.event_data->>'name',
        p_event.event_data->>'slug',
        COALESCE((p_event.event_data->>'sort_order')::integer, 0),
        true,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (organization_id, slug) DO UPDATE SET
        name = EXCLUDED.name,
        sort_order = EXCLUDED.sort_order,
        is_active = true,
        updated_at = p_event.created_at,
        last_event_id = p_event.id;
END;
$function$;
