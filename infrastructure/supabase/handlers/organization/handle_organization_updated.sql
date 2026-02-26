CREATE OR REPLACE FUNCTION public.handle_organization_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE organizations_projection SET
    name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'name'), name),
    display_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'display_name'), display_name),
    slug = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'slug'), slug),
    type = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'type'), type),
    tax_number = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'tax_number'), tax_number),
    phone_number = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'phone_number'), phone_number),
    timezone = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), timezone),
    subdomain_status = COALESCE(
      safe_jsonb_extract_text(p_event.event_data, 'subdomain_status'),
      subdomain_status
    ),
    metadata = CASE
      WHEN p_event.event_data ? 'metadata' THEN p_event.event_data->'metadata'
      ELSE metadata
    END,
    tags = CASE
      WHEN p_event.event_data ? 'tags' THEN
        COALESCE(
          ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'tags')),
          '{}'::TEXT[]
        )
      ELSE tags
    END,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$function$;
