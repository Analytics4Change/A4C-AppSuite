CREATE OR REPLACE FUNCTION public.handle_organization_subdomain_failed(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_error_message TEXT := p_event.event_data->>'error_message';
BEGIN
  UPDATE organizations_projection SET
    subdomain_status = 'failed',
    subdomain_metadata = jsonb_build_object(
      'failure_reason', COALESCE(v_error_message, 'Unknown error'),
      'failed_at', p_event.created_at
    ),
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$function$;
