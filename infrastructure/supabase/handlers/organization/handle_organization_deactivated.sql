CREATE OR REPLACE FUNCTION public.handle_organization_deactivated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE organizations_projection SET
    is_active = false,
    deactivated_at = COALESCE(
      safe_jsonb_extract_timestamp(p_event.event_data, 'effective_date'),
      p_event.created_at
    ),
    deactivation_reason = safe_jsonb_extract_text(p_event.event_data, 'deactivation_type'),
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$function$;
