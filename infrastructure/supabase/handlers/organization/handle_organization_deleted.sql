CREATE OR REPLACE FUNCTION public.handle_organization_deleted(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE organizations_projection SET
    deleted_at = COALESCE(
      safe_jsonb_extract_timestamp(p_event.event_data, 'deleted_at'),
      p_event.created_at
    ),
    deletion_reason = safe_jsonb_extract_text(p_event.event_data, 'deletion_strategy'),
    is_active = false,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$function$;
