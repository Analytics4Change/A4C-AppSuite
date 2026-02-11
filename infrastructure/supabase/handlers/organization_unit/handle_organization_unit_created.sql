CREATE OR REPLACE FUNCTION public.handle_organization_unit_created(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organizations_projection
    WHERE path = (p_event.event_data->>'parent_path')::LTREE
    UNION ALL
    SELECT 1 FROM organization_units_projection
    WHERE path = (p_event.event_data->>'parent_path')::LTREE
  ) THEN
    RAISE WARNING 'Parent path % does not exist for organization unit %',
      p_event.event_data->>'parent_path', p_event.stream_id;
  END IF;

  INSERT INTO organization_units_projection (
    id, organization_id, name, display_name, slug, path, parent_path,
    timezone, is_active, created_at, updated_at
  ) VALUES (
    p_event.stream_id,
    safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
    safe_jsonb_extract_text(p_event.event_data, 'name'),
    COALESCE(
      safe_jsonb_extract_text(p_event.event_data, 'display_name'),
      safe_jsonb_extract_text(p_event.event_data, 'name')
    ),
    safe_jsonb_extract_text(p_event.event_data, 'slug'),
    (p_event.event_data->>'path')::LTREE,
    (p_event.event_data->>'parent_path')::LTREE,
    COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), 'UTC'),
    true,
    p_event.created_at,
    p_event.created_at
  ) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    display_name = EXCLUDED.display_name,
    slug = EXCLUDED.slug,
    path = EXCLUDED.path,
    parent_path = EXCLUDED.parent_path,
    timezone = EXCLUDED.timezone,
    updated_at = EXCLUDED.updated_at;
END;
$function$;
