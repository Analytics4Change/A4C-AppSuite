CREATE OR REPLACE FUNCTION public.handle_user_client_assigned(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO user_client_assignments_projection (
    id, user_id, client_id, organization_id, assigned_by,
    notes, assigned_until, last_event_id
  ) VALUES (
    COALESCE((p_event.event_data->>'assignment_id')::uuid, gen_random_uuid()),
    p_event.aggregate_id,
    (p_event.event_data->>'client_id')::uuid,
    (p_event.event_data->>'organization_id')::uuid,
    (p_event.event_metadata->>'user_id')::uuid,
    p_event.event_data->>'notes',
    (p_event.event_data->>'assigned_until')::timestamptz,
    p_event.id
  ) ON CONFLICT (user_id, client_id) DO UPDATE SET
    is_active = true,
    assigned_until = EXCLUDED.assigned_until,
    notes = EXCLUDED.notes,
    updated_at = now(),
    last_event_id = p_event.id;
END;
$function$;
