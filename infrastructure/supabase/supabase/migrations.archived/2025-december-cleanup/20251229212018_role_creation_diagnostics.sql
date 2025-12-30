-- Migration: role_creation_diagnostics.sql
-- PURPOSE: Add RAISE NOTICE statements to trace role creation call chain
-- TEMPORARY: Remove after root cause identified
-- LOG ACCESS: Supabase Dashboard → Logs → Postgres
-- FILTER BY: [DIAG:

-- ============================================================================
-- 1. INSTRUMENT api.create_role (5-param version)
-- ============================================================================
CREATE OR REPLACE FUNCTION api.create_role(
  p_name TEXT,
  p_description TEXT,
  p_org_hierarchy_scope TEXT DEFAULT NULL,
  p_permission_ids UUID[] DEFAULT '{}',
  p_cloned_from_role_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_role_id UUID;
  v_org_path LTREE;
  v_scope_path LTREE;
  v_perm_id UUID;
  v_user_perms UUID[];
  v_perm_name TEXT;
  v_event_metadata JSONB;
  v_perm_count INT := 0;
BEGIN
  -- DIAGNOSTIC: Entry point
  RAISE NOTICE '[DIAG:api.create_role:ENTRY] name=%, perms=%, scope=%',
    p_name, array_length(p_permission_ids, 1), p_org_hierarchy_scope;

  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  RAISE NOTICE '[DIAG:api.create_role:CONTEXT] user_id=%, org_id=%', v_user_id, v_org_id;

  IF v_org_id IS NULL THEN
    RAISE NOTICE '[DIAG:api.create_role:EXIT:NO_ORG]';
    RETURN jsonb_build_object('success', false, 'error', 'Organization context required',
      'errorDetails', jsonb_build_object('code', 'NO_ORG_CONTEXT', 'message', 'User must be in an organization context'));
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE NOTICE '[DIAG:api.create_role:EXIT:VALIDATION]';
    RETURN jsonb_build_object('success', false, 'error', 'Name is required',
      'errorDetails', jsonb_build_object('code', 'VALIDATION_ERROR', 'message', 'Role name cannot be empty'));
  END IF;

  SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
  v_scope_path := COALESCE(p_org_hierarchy_scope::LTREE, v_org_path);

  RAISE NOTICE '[DIAG:api.create_role:SCOPE] org_path=%, scope_path=%', v_org_path, v_scope_path;

  -- Validate subset-only delegation
  SELECT array_agg(DISTINCT rp.permission_id) INTO v_user_perms
  FROM user_roles_projection ur
  JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
  WHERE ur.user_id = v_user_id;
  v_user_perms := COALESCE(v_user_perms, '{}');

  RAISE NOTICE '[DIAG:api.create_role:USER_PERMS] count=%', array_length(v_user_perms, 1);

  FOREACH v_perm_id IN ARRAY p_permission_ids
  LOOP
    IF NOT (v_perm_id = ANY(v_user_perms)) THEN
      SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;
      RAISE NOTICE '[DIAG:api.create_role:EXIT:SUBSET_VIOLATION] perm=%', v_perm_name;
      RETURN jsonb_build_object('success', false, 'error', 'Cannot grant permission you do not possess',
        'errorDetails', jsonb_build_object('code', 'SUBSET_ONLY_VIOLATION',
          'message', format('Permission %s is not in your granted set', COALESCE(v_perm_name, v_perm_id::TEXT))));
    END IF;
  END LOOP;

  v_role_id := gen_random_uuid();
  RAISE NOTICE '[DIAG:api.create_role:ROLE_ID] %', v_role_id;

  v_event_metadata := jsonb_build_object(
    'user_id', v_user_id,
    'organization_id', v_org_id,
    'reason', CASE WHEN p_cloned_from_role_id IS NOT NULL THEN 'Role duplicated via Role Management UI'
      ELSE 'Creating new role via Role Management UI' END
  );
  IF p_cloned_from_role_id IS NOT NULL THEN
    v_event_metadata := v_event_metadata || jsonb_build_object('cloned_from_role_id', p_cloned_from_role_id);
  END IF;

  -- DIAGNOSTIC: Before role.created event
  RAISE NOTICE '[DIAG:api.create_role:EMIT:role.created:BEFORE]';

  PERFORM api.emit_domain_event(
    p_stream_id := v_role_id,
    p_stream_type := 'role',
    p_event_type := 'role.created',
    p_event_data := jsonb_build_object(
      'name', p_name,
      'description', p_description,
      'organization_id', v_org_id,
      'org_hierarchy_scope', v_scope_path::TEXT
    ),
    p_event_metadata := v_event_metadata
  );

  RAISE NOTICE '[DIAG:api.create_role:EMIT:role.created:AFTER]';

  -- Emit permission grant events
  FOREACH v_perm_id IN ARRAY p_permission_ids
  LOOP
    v_perm_count := v_perm_count + 1;
    SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;

    RAISE NOTICE '[DIAG:api.create_role:EMIT:permission:BEFORE] #% perm=%', v_perm_count, v_perm_name;

    PERFORM api.emit_domain_event(
      p_stream_id := v_role_id,
      p_stream_type := 'role',
      p_event_type := 'role.permission.granted',
      p_event_data := jsonb_build_object('permission_id', v_perm_id, 'permission_name', v_perm_name),
      p_event_metadata := jsonb_build_object(
        'user_id', v_user_id,
        'organization_id', v_org_id,
        'reason', CASE WHEN p_cloned_from_role_id IS NOT NULL THEN 'Permission cloned from source role'
          ELSE 'Initial permission grant during role creation' END
      )
    );

    RAISE NOTICE '[DIAG:api.create_role:EMIT:permission:AFTER] #%', v_perm_count;
  END LOOP;

  RAISE NOTICE '[DIAG:api.create_role:EXIT:SUCCESS] role_id=%', v_role_id;

  RETURN jsonb_build_object('success', true, 'role', jsonb_build_object(
    'id', v_role_id, 'name', p_name, 'description', p_description,
    'organizationId', v_org_id, 'orgHierarchyScope', v_scope_path::TEXT,
    'isActive', true, 'createdAt', now(), 'updatedAt', now()
  ));
END;
$$;

-- ============================================================================
-- 2. INSTRUMENT api.emit_domain_event (5-param auto-version)
-- ============================================================================
CREATE OR REPLACE FUNCTION api.emit_domain_event(
  p_stream_id UUID,
  p_stream_type TEXT,
  p_event_type TEXT,
  p_event_data JSONB,
  p_event_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id UUID;
  v_stream_version INT;
BEGIN
  RAISE NOTICE '[DIAG:emit_domain_event:ENTRY] stream_id=%, type=%, event=%',
    p_stream_id, p_stream_type, p_event_type;

  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_stream_id AND stream_type = p_stream_type;

  RAISE NOTICE '[DIAG:emit_domain_event:VERSION] %', v_stream_version;

  INSERT INTO domain_events (
    stream_id, stream_type, stream_version, event_type, event_data, event_metadata, created_at
  ) VALUES (
    p_stream_id, p_stream_type, v_stream_version, p_event_type, p_event_data, p_event_metadata, NOW()
  ) RETURNING id INTO v_event_id;

  RAISE NOTICE '[DIAG:emit_domain_event:EXIT] event_id=%', v_event_id;

  RETURN v_event_id;
END;
$$;

-- ============================================================================
-- 3. INSTRUMENT process_domain_event (main trigger router)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_domain_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_start_time TIMESTAMPTZ;
  v_error_msg TEXT;
  v_error_detail TEXT;
BEGIN
  v_start_time := clock_timestamp();

  RAISE NOTICE '[DIAG:process_domain_event:ENTRY] id=%, stream_type=%, event_type=%',
    NEW.id, NEW.stream_type, NEW.event_type;

  IF NEW.processed_at IS NOT NULL THEN
    RAISE NOTICE '[DIAG:process_domain_event:SKIP:ALREADY_PROCESSED]';
    RETURN NEW;
  END IF;

  BEGIN
    IF NEW.event_type LIKE '%.linked' OR NEW.event_type LIKE '%.unlinked' THEN
      RAISE NOTICE '[DIAG:process_domain_event:ROUTE:junction]';
      PERFORM process_junction_event(NEW);
    ELSE
      CASE NEW.stream_type
        WHEN 'role' THEN
          RAISE NOTICE '[DIAG:process_domain_event:ROUTE:role->process_rbac_event]';
          PERFORM process_rbac_event(NEW);
        WHEN 'permission' THEN
          RAISE NOTICE '[DIAG:process_domain_event:ROUTE:permission->process_rbac_event]';
          PERFORM process_rbac_event(NEW);
        WHEN 'client' THEN PERFORM process_client_event(NEW);
        WHEN 'medication' THEN PERFORM process_medication_event(NEW);
        WHEN 'medication_history' THEN PERFORM process_medication_history_event(NEW);
        WHEN 'dosage' THEN PERFORM process_dosage_event(NEW);
        WHEN 'user' THEN PERFORM process_user_event(NEW);
        WHEN 'organization' THEN PERFORM process_organization_event(NEW);
        WHEN 'organization_unit' THEN PERFORM process_organization_unit_event(NEW);
        WHEN 'contact' THEN PERFORM process_contact_event(NEW);
        WHEN 'address' THEN PERFORM process_address_event(NEW);
        WHEN 'phone' THEN PERFORM process_phone_event(NEW);
        WHEN 'invitation' THEN PERFORM process_invitation_event(NEW);
        WHEN 'access_grant' THEN PERFORM process_access_grant_event(NEW);
        WHEN 'impersonation' THEN PERFORM process_impersonation_event(NEW);
        ELSE
          RAISE WARNING '[DIAG:process_domain_event:UNKNOWN_STREAM] %', NEW.stream_type;
      END CASE;
    END IF;

    NEW.processed_at = clock_timestamp();
    NEW.processing_error = NULL;

    RAISE NOTICE '[DIAG:process_domain_event:EXIT:SUCCESS] elapsed=%',
      (clock_timestamp() - v_start_time);

  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error_msg = MESSAGE_TEXT, v_error_detail = PG_EXCEPTION_DETAIL;
      RAISE WARNING '[DIAG:process_domain_event:ERROR] %: %', v_error_msg, v_error_detail;
      NEW.processing_error = v_error_msg || ' - ' || COALESCE(v_error_detail, '');
  END;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 4. INSTRUMENT process_rbac_event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_rbac_event(p_event RECORD)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RAISE NOTICE '[DIAG:process_rbac_event:ENTRY] event_type=%', p_event.event_type;

  CASE p_event.event_type
    WHEN 'role.created' THEN
      RAISE NOTICE '[DIAG:process_rbac_event:CASE:role.created]';
      INSERT INTO roles_projection (id, name, description, organization_id, org_hierarchy_scope, is_active, created_at, updated_at)
      VALUES (p_event.stream_id, p_event.event_data->>'name', p_event.event_data->>'description',
        (p_event.event_data->>'organization_id')::UUID, (p_event.event_data->>'org_hierarchy_scope')::LTREE,
        true, p_event.created_at, p_event.created_at)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
        organization_id = EXCLUDED.organization_id, org_hierarchy_scope = EXCLUDED.org_hierarchy_scope, updated_at = EXCLUDED.updated_at;
      RAISE NOTICE '[DIAG:process_rbac_event:DONE:role.created]';

    WHEN 'role.updated' THEN
      RAISE NOTICE '[DIAG:process_rbac_event:CASE:role.updated]';
      UPDATE roles_projection SET name = COALESCE(p_event.event_data->>'name', name),
        description = COALESCE(p_event.event_data->>'description', description), updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'role.deactivated' THEN
      RAISE NOTICE '[DIAG:process_rbac_event:CASE:role.deactivated]';
      UPDATE roles_projection SET is_active = false, updated_at = p_event.created_at WHERE id = p_event.stream_id;

    WHEN 'role.reactivated' THEN
      RAISE NOTICE '[DIAG:process_rbac_event:CASE:role.reactivated]';
      UPDATE roles_projection SET is_active = true, updated_at = p_event.created_at WHERE id = p_event.stream_id;

    WHEN 'role.deleted' THEN
      RAISE NOTICE '[DIAG:process_rbac_event:CASE:role.deleted]';
      UPDATE roles_projection SET deleted_at = p_event.created_at, updated_at = p_event.created_at WHERE id = p_event.stream_id;

    WHEN 'role.permission.granted' THEN
      RAISE NOTICE '[DIAG:process_rbac_event:CASE:role.permission.granted] role=%, perm=%',
        p_event.stream_id, p_event.event_data->>'permission_id';
      INSERT INTO role_permissions_projection (role_id, permission_id, granted_at)
      VALUES (p_event.stream_id, (p_event.event_data->>'permission_id')::UUID, p_event.created_at)
      ON CONFLICT (role_id, permission_id) DO NOTHING;
      RAISE NOTICE '[DIAG:process_rbac_event:DONE:role.permission.granted]';

    WHEN 'role.permission.revoked' THEN
      RAISE NOTICE '[DIAG:process_rbac_event:CASE:role.permission.revoked]';
      DELETE FROM role_permissions_projection WHERE role_id = p_event.stream_id
        AND permission_id = (p_event.event_data->>'permission_id')::UUID;

    WHEN 'permission.defined' THEN
      RAISE NOTICE '[DIAG:process_rbac_event:CASE:permission.defined]';
      INSERT INTO permissions_projection (id, applet, action, description, scope_type, requires_mfa, created_at)
      VALUES (p_event.stream_id, p_event.event_data->>'applet', p_event.event_data->>'action',
        p_event.event_data->>'description', p_event.event_data->>'scope_type',
        COALESCE((p_event.event_data->>'requires_mfa')::BOOLEAN, false), p_event.created_at)
      ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description, scope_type = EXCLUDED.scope_type, requires_mfa = EXCLUDED.requires_mfa;

    WHEN 'user.role.assigned' THEN
      RAISE NOTICE '[DIAG:process_rbac_event:CASE:user.role.assigned]';
      INSERT INTO user_roles_projection (user_id, role_id, org_id, scope_path, assigned_at)
      VALUES (p_event.stream_id, (p_event.event_data->>'role_id')::UUID,
        CASE WHEN p_event.event_data->>'org_id' = '*' THEN NULL ELSE (p_event.event_data->>'org_id')::UUID END,
        CASE WHEN p_event.event_data->>'scope_path' = '*' THEN NULL ELSE (p_event.event_data->>'scope_path')::LTREE END,
        p_event.created_at)
      ON CONFLICT (user_id, role_id, org_id) DO NOTHING;

    WHEN 'user.role.revoked' THEN
      RAISE NOTICE '[DIAG:process_rbac_event:CASE:user.role.revoked]';
      DELETE FROM user_roles_projection WHERE user_id = p_event.stream_id
        AND role_id = (p_event.event_data->>'role_id')::UUID;

    ELSE
      RAISE WARNING '[DIAG:process_rbac_event:UNKNOWN] %', p_event.event_type;
  END CASE;

  RAISE NOTICE '[DIAG:process_rbac_event:EXIT]';
END;
$$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Diagnostic instrumentation applied. View logs in Supabase Dashboard → Logs → Postgres';
  RAISE NOTICE 'Filter by: [DIAG:';
END;
$$;
