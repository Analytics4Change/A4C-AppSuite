CREATE OR REPLACE FUNCTION public.handle_user_role_assigned(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_platform_org_id UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID;
  v_org_id UUID;
  v_scope_path LTREE;
BEGIN
  IF p_event.event_data->>'org_id' = '*'
     OR (p_event.event_data->>'org_id')::UUID = v_platform_org_id THEN
    v_org_id := NULL;
    v_scope_path := NULL;
  ELSE
    v_org_id := (p_event.event_data->>'org_id')::UUID;

    IF p_event.event_data->>'scope_path' IS NOT NULL
       AND p_event.event_data->>'scope_path' != '*' THEN
      v_scope_path := (p_event.event_data->>'scope_path')::LTREE;
    ELSE
      SELECT path INTO v_scope_path
      FROM organizations_projection
      WHERE id = v_org_id;
    END IF;

    IF v_org_id IS NOT NULL AND v_scope_path IS NULL THEN
      RAISE WARNING 'Cannot assign role: org_id % has no scope_path', v_org_id;
      RETURN;
    END IF;
  END IF;

  INSERT INTO user_roles_projection (
    user_id, role_id, organization_id, scope_path,
    role_valid_from, role_valid_until, assigned_at
  ) VALUES (
    p_event.stream_id,
    (p_event.event_data->>'role_id')::UUID,
    v_org_id,
    v_scope_path,
    (p_event.event_data->>'role_valid_from')::DATE,
    (p_event.event_data->>'role_valid_until')::DATE,
    p_event.created_at
  ) ON CONFLICT ON CONSTRAINT user_roles_projection_user_id_role_id_org_id_key DO UPDATE SET
    role_valid_from = COALESCE(EXCLUDED.role_valid_from, user_roles_projection.role_valid_from),
    role_valid_until = COALESCE(EXCLUDED.role_valid_until, user_roles_projection.role_valid_until);

  UPDATE users SET
    roles = ARRAY(
      SELECT DISTINCT unnest(roles || ARRAY[p_event.event_data->>'role_name'])
    ),
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$function$;
