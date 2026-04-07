CREATE OR REPLACE FUNCTION public.handle_client_email_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_emails_projection SET
        email = COALESCE(p_event.event_data->>'email', email),
        email_type = COALESCE(p_event.event_data->>'email_type', email_type),
        is_primary = CASE WHEN p_event.event_data ? 'is_primary' THEN (p_event.event_data->>'is_primary')::boolean ELSE is_primary END,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'email_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;
