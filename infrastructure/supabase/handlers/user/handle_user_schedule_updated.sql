CREATE OR REPLACE FUNCTION public.handle_user_schedule_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE user_schedule_policies_projection SET
    schedule_name = COALESCE(p_event.event_data->>'schedule_name', schedule_name),
    schedule = COALESCE(p_event.event_data->'schedule', schedule),
    org_unit_id = COALESCE((p_event.event_data->>'org_unit_id')::uuid, org_unit_id),
    effective_from = COALESCE((p_event.event_data->>'effective_from')::date, effective_from),
    effective_until = COALESCE((p_event.event_data->>'effective_until')::date, effective_until),
    updated_at = p_event.created_at,
    last_event_id = p_event.id
  WHERE id = (p_event.event_data->>'schedule_id')::uuid
    AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;
