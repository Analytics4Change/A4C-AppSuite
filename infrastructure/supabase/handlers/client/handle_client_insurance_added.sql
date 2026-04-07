CREATE OR REPLACE FUNCTION public.handle_client_insurance_added(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO client_insurance_policies_projection (
        id, client_id, organization_id, policy_type, payer_name, policy_number,
        group_number, subscriber_name, subscriber_relation,
        coverage_start_date, coverage_end_date,
        is_active, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'policy_id')::uuid,
        p_event.stream_id,
        (p_event.event_data->>'organization_id')::uuid,
        p_event.event_data->>'policy_type',
        p_event.event_data->>'payer_name',
        p_event.event_data->>'policy_number',
        p_event.event_data->>'group_number',
        p_event.event_data->>'subscriber_name',
        p_event.event_data->>'subscriber_relation',
        (p_event.event_data->>'coverage_start_date')::date,
        (p_event.event_data->>'coverage_end_date')::date,
        true,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (client_id, policy_type) DO UPDATE SET
        payer_name = EXCLUDED.payer_name,
        policy_number = EXCLUDED.policy_number,
        group_number = EXCLUDED.group_number,
        subscriber_name = EXCLUDED.subscriber_name,
        subscriber_relation = EXCLUDED.subscriber_relation,
        coverage_start_date = EXCLUDED.coverage_start_date,
        coverage_end_date = EXCLUDED.coverage_end_date,
        is_active = true,
        updated_at = EXCLUDED.updated_at,
        last_event_id = EXCLUDED.last_event_id;
END;
$function$;
