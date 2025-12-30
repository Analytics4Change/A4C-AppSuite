-- =============================================================================
-- Migration: Remove diagnostic RAISE NOTICE statements from Phase 8 debugging
-- Purpose: Clean up [DIAG: prefixed debugging statements that were added during
--          RLS recursion debugging. Root cause was identified and fixed in
--          20251229201217_fix_rls_circular_recursion.sql
--
-- Functions cleaned (40 total RAISE NOTICE statements removed):
--   - api.create_role: 13 statements
--   - api.emit_domain_event: 3 statements
--   - public.process_domain_event: 10 statements
--   - public.process_rbac_event: 14 statements
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. api.create_role - Remove 13 diagnostic RAISE NOTICE statements
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.create_role(
  p_name text,
  p_description text,
  p_org_hierarchy_scope text DEFAULT NULL::text,
  p_permission_ids uuid[] DEFAULT '{}'::uuid[],
  p_cloned_from_role_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization context required',
      'errorDetails', jsonb_build_object('code', 'NO_ORG_CONTEXT', 'message', 'User must be in an organization context'));
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Name is required',
      'errorDetails', jsonb_build_object('code', 'VALIDATION_ERROR', 'message', 'Role name cannot be empty'));
  END IF;

  SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
  v_scope_path := COALESCE(p_org_hierarchy_scope::LTREE, v_org_path);

  -- Validate subset-only delegation
  SELECT array_agg(DISTINCT rp.permission_id) INTO v_user_perms
  FROM user_roles_projection ur
  JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
  WHERE ur.user_id = v_user_id;
  v_user_perms := COALESCE(v_user_perms, '{}');

  FOREACH v_perm_id IN ARRAY p_permission_ids
  LOOP
    IF NOT (v_perm_id = ANY(v_user_perms)) THEN
      SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;
      RETURN jsonb_build_object('success', false, 'error', 'Cannot grant permission you do not possess',
        'errorDetails', jsonb_build_object('code', 'SUBSET_ONLY_VIOLATION',
          'message', format('Permission %s is not in your granted set', COALESCE(v_perm_name, v_perm_id::TEXT))));
    END IF;
  END LOOP;

  v_role_id := gen_random_uuid();

  v_event_metadata := jsonb_build_object(
    'user_id', v_user_id,
    'organization_id', v_org_id,
    'reason', CASE WHEN p_cloned_from_role_id IS NOT NULL THEN 'Role duplicated via Role Management UI'
      ELSE 'Creating new role via Role Management UI' END
  );
  IF p_cloned_from_role_id IS NOT NULL THEN
    v_event_metadata := v_event_metadata || jsonb_build_object('cloned_from_role_id', p_cloned_from_role_id);
  END IF;

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

  -- Emit permission grant events
  FOREACH v_perm_id IN ARRAY p_permission_ids
  LOOP
    v_perm_count := v_perm_count + 1;
    SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;

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
  END LOOP;

  RETURN jsonb_build_object('success', true, 'role', jsonb_build_object(
    'id', v_role_id, 'name', p_name, 'description', p_description,
    'organizationId', v_org_id, 'orgHierarchyScope', v_scope_path::TEXT,
    'isActive', true, 'createdAt', now(), 'updatedAt', now()
  ));
END;
$function$;

-- -----------------------------------------------------------------------------
-- 2. api.emit_domain_event - Remove 3 diagnostic RAISE NOTICE statements
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.emit_domain_event(
  p_stream_id uuid,
  p_stream_type text,
  p_event_type text,
  p_event_data jsonb,
  p_event_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_event_id UUID;
  v_stream_version INT;
BEGIN
  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_stream_id AND stream_type = p_stream_type;

  INSERT INTO domain_events (
    stream_id, stream_type, stream_version, event_type, event_data, event_metadata, created_at
  ) VALUES (
    p_stream_id, p_stream_type, v_stream_version, p_event_type, p_event_data, p_event_metadata, NOW()
  ) RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 3. public.process_domain_event - Remove 10 diagnostic RAISE NOTICE statements
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_domain_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_start_time TIMESTAMPTZ;
  v_error_msg TEXT;
  v_error_detail TEXT;
BEGIN
  v_start_time := clock_timestamp();

  IF NEW.processed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NEW.event_type LIKE '%.linked' OR NEW.event_type LIKE '%.unlinked' THEN
      PERFORM process_junction_event(NEW);
    ELSE
      CASE NEW.stream_type
        WHEN 'role' THEN PERFORM process_rbac_event(NEW);
        WHEN 'permission' THEN PERFORM process_rbac_event(NEW);
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
          RAISE WARNING 'Unknown stream_type: %', NEW.stream_type;
      END CASE;
    END IF;

    NEW.processed_at = clock_timestamp();
    NEW.processing_error = NULL;

  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error_msg = MESSAGE_TEXT, v_error_detail = PG_EXCEPTION_DETAIL;
      RAISE WARNING 'Event processing error for event %: % - %', NEW.id, v_error_msg, COALESCE(v_error_detail, '');
      NEW.processing_error = v_error_msg || ' - ' || COALESCE(v_error_detail, '');
  END;

  RETURN NEW;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 4. public.process_rbac_event - Remove 14 diagnostic RAISE NOTICE statements
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_rbac_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  CASE p_event.event_type
    WHEN 'role.created' THEN
      INSERT INTO roles_projection (id, name, description, organization_id, org_hierarchy_scope, is_active, created_at, updated_at)
      VALUES (p_event.stream_id, p_event.event_data->>'name', p_event.event_data->>'description',
        (p_event.event_data->>'organization_id')::UUID, (p_event.event_data->>'org_hierarchy_scope')::LTREE,
        true, p_event.created_at, p_event.created_at)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
        organization_id = EXCLUDED.organization_id, org_hierarchy_scope = EXCLUDED.org_hierarchy_scope, updated_at = EXCLUDED.updated_at;

    WHEN 'role.updated' THEN
      UPDATE roles_projection SET name = COALESCE(p_event.event_data->>'name', name),
        description = COALESCE(p_event.event_data->>'description', description), updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'role.deactivated' THEN
      UPDATE roles_projection SET is_active = false, updated_at = p_event.created_at WHERE id = p_event.stream_id;

    WHEN 'role.reactivated' THEN
      UPDATE roles_projection SET is_active = true, updated_at = p_event.created_at WHERE id = p_event.stream_id;

    WHEN 'role.deleted' THEN
      UPDATE roles_projection SET deleted_at = p_event.created_at, updated_at = p_event.created_at WHERE id = p_event.stream_id;

    WHEN 'role.permission.granted' THEN
      INSERT INTO role_permissions_projection (role_id, permission_id, granted_at)
      VALUES (p_event.stream_id, (p_event.event_data->>'permission_id')::UUID, p_event.created_at)
      ON CONFLICT (role_id, permission_id) DO NOTHING;

    WHEN 'role.permission.revoked' THEN
      DELETE FROM role_permissions_projection WHERE role_id = p_event.stream_id
        AND permission_id = (p_event.event_data->>'permission_id')::UUID;

    WHEN 'permission.defined' THEN
      INSERT INTO permissions_projection (id, applet, action, description, scope_type, requires_mfa, created_at)
      VALUES (p_event.stream_id, p_event.event_data->>'applet', p_event.event_data->>'action',
        p_event.event_data->>'description', p_event.event_data->>'scope_type',
        COALESCE((p_event.event_data->>'requires_mfa')::BOOLEAN, false), p_event.created_at)
      ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description, scope_type = EXCLUDED.scope_type, requires_mfa = EXCLUDED.requires_mfa;

    WHEN 'user.role.assigned' THEN
      INSERT INTO user_roles_projection (user_id, role_id, org_id, scope_path, assigned_at)
      VALUES (p_event.stream_id, (p_event.event_data->>'role_id')::UUID,
        CASE WHEN p_event.event_data->>'org_id' = '*' THEN NULL ELSE (p_event.event_data->>'org_id')::UUID END,
        CASE WHEN p_event.event_data->>'scope_path' = '*' THEN NULL ELSE (p_event.event_data->>'scope_path')::LTREE END,
        p_event.created_at)
      ON CONFLICT (user_id, role_id, org_id) DO NOTHING;

    WHEN 'user.role.revoked' THEN
      DELETE FROM user_roles_projection WHERE user_id = p_event.stream_id
        AND role_id = (p_event.event_data->>'role_id')::UUID;

    ELSE
      RAISE WARNING 'Unknown RBAC event type: %', p_event.event_type;
  END CASE;
END;
$function$;

-- -----------------------------------------------------------------------------
-- Verification: Check that [DIAG: statements are removed
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_diag_count INT;
BEGIN
  SELECT COUNT(*) INTO v_diag_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname IN ('api', 'public')
    AND p.proname IN ('create_role', 'emit_domain_event', 'process_domain_event', 'process_rbac_event')
    AND pg_get_functiondef(p.oid) LIKE '%[DIAG:%';

  IF v_diag_count > 0 THEN
    RAISE WARNING 'Found % functions still containing [DIAG: statements', v_diag_count;
  ELSE
    RAISE NOTICE 'SUCCESS: All diagnostic statements removed from 4 functions';
  END IF;
END;
$$;
