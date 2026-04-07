CREATE OR REPLACE FUNCTION public.handle_client_email_added(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO client_emails_projection (
        id, client_id, organization_id, email, email_type, is_primary,
        is_active, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'email_id')::uuid,
        p_event.stream_id,
        (p_event.event_data->>'organization_id')::uuid,
        p_event.event_data->>'email',
        COALESCE(p_event.event_data->>'email_type', 'personal'),
        COALESCE((p_event.event_data->>'is_primary')::boolean, false),
        true,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (client_id, email) DO UPDATE SET
        email_type = EXCLUDED.email_type,
        is_primary = EXCLUDED.is_primary,
        is_active = true,
        updated_at = EXCLUDED.updated_at,
        last_event_id = EXCLUDED.last_event_id;
END;
$function$;
