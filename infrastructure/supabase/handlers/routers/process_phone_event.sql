CREATE OR REPLACE FUNCTION public.process_phone_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  CASE p_event.event_type

    WHEN 'phone.created' THEN
      INSERT INTO phones_projection (
        id, organization_id, type, label,
        number, extension, is_primary,
        metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::phone_type
          ELSE NULL
        END,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'number'),
        safe_jsonb_extract_text(p_event.event_data, 'extension'),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), false),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;

    WHEN 'phone.updated' THEN
      UPDATE phones_projection
      SET
        type = CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::phone_type
          ELSE type
        END,
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        number = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'number'), number),
        extension = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'extension'), extension),
        is_primary = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), is_primary),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'phone.deleted' THEN
      UPDATE phones_projection
      SET
        deleted_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_phone_event', p_event.event_type
          USING ERRCODE = 'P9001';
  END CASE;

END;
$function$;
