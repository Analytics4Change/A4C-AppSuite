CREATE OR REPLACE FUNCTION public.handle_client_insurance_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_insurance_policies_projection SET
        payer_name = COALESCE(p_event.event_data->>'payer_name', payer_name),
        policy_number = CASE WHEN p_event.event_data ? 'policy_number' THEN p_event.event_data->>'policy_number' ELSE policy_number END,
        group_number = CASE WHEN p_event.event_data ? 'group_number' THEN p_event.event_data->>'group_number' ELSE group_number END,
        subscriber_name = CASE WHEN p_event.event_data ? 'subscriber_name' THEN p_event.event_data->>'subscriber_name' ELSE subscriber_name END,
        subscriber_relation = CASE WHEN p_event.event_data ? 'subscriber_relation' THEN p_event.event_data->>'subscriber_relation' ELSE subscriber_relation END,
        coverage_start_date = CASE WHEN p_event.event_data ? 'coverage_start_date' THEN (p_event.event_data->>'coverage_start_date')::date ELSE coverage_start_date END,
        coverage_end_date = CASE WHEN p_event.event_data ? 'coverage_end_date' THEN (p_event.event_data->>'coverage_end_date')::date ELSE coverage_end_date END,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'policy_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;
