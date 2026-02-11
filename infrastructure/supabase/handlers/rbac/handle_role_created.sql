CREATE OR REPLACE FUNCTION public.handle_role_created(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO roles_projection (
    id, name, description, organization_id, org_hierarchy_scope,
    is_active, created_at, updated_at
  ) VALUES (
    p_event.stream_id,
    p_event.event_data->>'name',
    p_event.event_data->>'description',
    (p_event.event_data->>'organization_id')::UUID,
    (p_event.event_data->>'org_hierarchy_scope')::LTREE,
    true,
    p_event.created_at,
    p_event.created_at
  ) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    organization_id = EXCLUDED.organization_id,
    org_hierarchy_scope = EXCLUDED.org_hierarchy_scope,
    updated_at = EXCLUDED.updated_at;
END;
$function$;
