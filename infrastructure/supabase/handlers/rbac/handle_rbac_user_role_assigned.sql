CREATE OR REPLACE FUNCTION public.handle_rbac_user_role_assigned(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO user_roles_projection (
    user_id, role_id, org_id, scope_path, assigned_at
  ) VALUES (
    p_event.stream_id,
    (p_event.event_data->>'role_id')::UUID,
    CASE
      WHEN p_event.event_data->>'org_id' = '*' THEN NULL
      ELSE (p_event.event_data->>'org_id')::UUID
    END,
    CASE
      WHEN p_event.event_data->>'scope_path' = '*' THEN NULL
      ELSE (p_event.event_data->>'scope_path')::LTREE
    END,
    p_event.created_at
  ) ON CONFLICT (user_id, role_id, org_id) DO NOTHING;
END;
$function$;
