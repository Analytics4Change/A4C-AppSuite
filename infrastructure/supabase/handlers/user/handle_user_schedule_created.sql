CREATE OR REPLACE FUNCTION public.handle_user_schedule_created(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO user_schedule_policies_projection (
    id, user_id, organization_id, schedule_name, schedule, org_unit_id,
    effective_from, effective_until, created_by,
    created_at, updated_at, last_event_id
  ) VALUES (
    COALESCE((p_event.event_data->>'schedule_id')::uuid, gen_random_uuid()),
    p_event.stream_id,
    (p_event.event_data->>'organization_id')::uuid,
    p_event.event_data->>'schedule_name',
    p_event.event_data->'schedule',
    (p_event.event_data->>'org_unit_id')::uuid,
    (p_event.event_data->>'effective_from')::date,
    (p_event.event_data->>'effective_until')::date,
    (p_event.event_metadata->>'user_id')::uuid,
    p_event.created_at,
    p_event.created_at,
    p_event.id
  ) ON CONFLICT (id) DO NOTHING;
END;
$function$;
