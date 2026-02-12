-- =============================================================================
-- Migration: Schedule Name and Full Lifecycle Support
-- Purpose: Add schedule_name column, reactivate/delete RPCs, fix aggregate_id bug
-- =============================================================================
-- Changes:
--   1. Add schedule_name column to user_schedule_policies_projection
--   2. Drop old unique constraint (users can now have multiple schedules via names)
--   3. Fix all schedule event handlers (aggregate_id → stream_id, match by schedule_id)
--   4. Update existing RPCs with schedule_name support
--   5. Add new RPCs: reactivate, delete, get_by_id
--   6. Add schedule_name filter to list RPC
--   7. Update process_user_event router with new event types
--   8. Add permission.updated handler to RBAC router
--   9. Update permission description via domain event
-- =============================================================================

-- =============================================================================
-- 1. SCHEMA CHANGES
-- =============================================================================

TRUNCATE TABLE user_schedule_policies_projection;

ALTER TABLE user_schedule_policies_projection
  ADD COLUMN IF NOT EXISTS schedule_name TEXT NOT NULL DEFAULT '';

-- Remove default after adding (only needed for the ALTER)
ALTER TABLE user_schedule_policies_projection
  ALTER COLUMN schedule_name DROP DEFAULT;

-- Drop old unique constraint — with named schedules, a user can be assigned
-- to multiple schedules within the same org/OU
ALTER TABLE user_schedule_policies_projection
  DROP CONSTRAINT IF EXISTS user_schedule_policies_unique;

-- =============================================================================
-- 2. FIX + UPDATE EVENT HANDLERS
-- =============================================================================
-- All handlers previously used p_event.aggregate_id which doesn't exist on
-- domain_events (column is stream_id). Fixed to use p_event.stream_id.
-- Also updated to match by schedule_id (id column) instead of user+org+OU composite.
-- Using p_event.created_at for timestamps per event-handler-pattern.md.

-- Handler for user.schedule.created
CREATE OR REPLACE FUNCTION handle_user_schedule_created(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  INSERT INTO user_schedule_policies_projection (
    id,
    user_id,
    organization_id,
    schedule_name,
    schedule,
    org_unit_id,
    effective_from,
    effective_until,
    created_by,
    created_at,
    updated_at,
    last_event_id
  ) VALUES (
    COALESCE((p_event.event_data->>'schedule_id')::uuid, gen_random_uuid()),
    p_event.stream_id,
    (p_event.event_data->>'organization_id')::uuid,
    p_event.event_data->>'schedule_name',
    p_event.event_data->'schedule',
    (p_event.event_data->>'org_unit_id')::uuid,
    (p_event.event_data->>'effective_from')::date,
    (p_event.event_data->>'effective_until')::date,
    (p_event.event_metadata->>'user_id')::uuid,
    p_event.created_at,
    p_event.created_at,
    p_event.id
  ) ON CONFLICT (id) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION handle_user_schedule_created(record) IS
'Event handler for user.schedule.created events.
Inserts a new schedule row into user_schedule_policies_projection.
Idempotent via ON CONFLICT (id) DO NOTHING.';

-- Handler for user.schedule.updated
CREATE OR REPLACE FUNCTION handle_user_schedule_updated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE user_schedule_policies_projection SET
    schedule_name = COALESCE(p_event.event_data->>'schedule_name', schedule_name),
    schedule = COALESCE(p_event.event_data->'schedule', schedule),
    org_unit_id = COALESCE((p_event.event_data->>'org_unit_id')::uuid, org_unit_id),
    effective_from = COALESCE((p_event.event_data->>'effective_from')::date, effective_from),
    effective_until = COALESCE((p_event.event_data->>'effective_until')::date, effective_until),
    updated_at = p_event.created_at,
    last_event_id = p_event.id
  WHERE id = (p_event.event_data->>'schedule_id')::uuid
    AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$$;

COMMENT ON FUNCTION handle_user_schedule_updated(record) IS
'Event handler for user.schedule.updated events.
Updates schedule row matched by schedule_id + organization_id.';

-- Handler for user.schedule.deactivated
CREATE OR REPLACE FUNCTION handle_user_schedule_deactivated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE user_schedule_policies_projection SET
    is_active = false,
    updated_at = p_event.created_at,
    last_event_id = p_event.id
  WHERE id = (p_event.event_data->>'schedule_id')::uuid
    AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$$;

COMMENT ON FUNCTION handle_user_schedule_deactivated(record) IS
'Event handler for user.schedule.deactivated events.
Sets is_active = false on matched schedule row.';

-- Handler for user.schedule.reactivated (NEW)
CREATE OR REPLACE FUNCTION handle_user_schedule_reactivated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE user_schedule_policies_projection SET
    is_active = true,
    updated_at = p_event.created_at,
    last_event_id = p_event.id
  WHERE id = (p_event.event_data->>'schedule_id')::uuid
    AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$$;

COMMENT ON FUNCTION handle_user_schedule_reactivated(record) IS
'Event handler for user.schedule.reactivated events.
Sets is_active = true on matched schedule row.';

-- Handler for user.schedule.deleted (NEW)
CREATE OR REPLACE FUNCTION handle_user_schedule_deleted(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  DELETE FROM user_schedule_policies_projection
  WHERE id = (p_event.event_data->>'schedule_id')::uuid
    AND organization_id = (p_event.event_data->>'organization_id')::uuid
    AND is_active = false;
END;
$$;

COMMENT ON FUNCTION handle_user_schedule_deleted(record) IS
'Event handler for user.schedule.deleted events.
Permanently removes inactive schedule row from projection.
Only deletes if is_active = false (safety guard).';

-- =============================================================================
-- 3. UPDATE process_user_event() ROUTER
-- =============================================================================

CREATE OR REPLACE FUNCTION process_user_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  CASE p_event.event_type
    -- User lifecycle
    WHEN 'user.created' THEN PERFORM handle_user_created(p_event);
    WHEN 'user.synced_from_auth' THEN PERFORM handle_user_synced_from_auth(p_event);
    WHEN 'user.deactivated' THEN PERFORM handle_user_deactivated(p_event);
    WHEN 'user.reactivated' THEN PERFORM handle_user_reactivated(p_event);
    WHEN 'user.organization_switched' THEN PERFORM handle_user_organization_switched(p_event);

    -- Role assignments
    WHEN 'user.role.assigned' THEN PERFORM handle_user_role_assigned(p_event);
    WHEN 'user.role.revoked' THEN PERFORM handle_user_role_revoked(p_event);

    -- Access dates
    WHEN 'user.access_dates.updated' THEN PERFORM handle_user_access_dates_updated(p_event);

    -- Notification preferences
    WHEN 'user.notification_preferences.updated' THEN PERFORM handle_user_notification_preferences_updated(p_event);

    -- Addresses
    WHEN 'user.address.added' THEN PERFORM handle_user_address_added(p_event);
    WHEN 'user.address.updated' THEN PERFORM handle_user_address_updated(p_event);
    WHEN 'user.address.removed' THEN PERFORM handle_user_address_removed(p_event);

    -- Phones
    WHEN 'user.phone.added' THEN PERFORM handle_user_phone_added(p_event);
    WHEN 'user.phone.updated' THEN PERFORM handle_user_phone_updated(p_event);
    WHEN 'user.phone.removed' THEN PERFORM handle_user_phone_removed(p_event);

    -- Schedule policies
    WHEN 'user.schedule.created' THEN PERFORM handle_user_schedule_created(p_event);
    WHEN 'user.schedule.updated' THEN PERFORM handle_user_schedule_updated(p_event);
    WHEN 'user.schedule.deactivated' THEN PERFORM handle_user_schedule_deactivated(p_event);
    WHEN 'user.schedule.reactivated' THEN PERFORM handle_user_schedule_reactivated(p_event);
    WHEN 'user.schedule.deleted' THEN PERFORM handle_user_schedule_deleted(p_event);

    -- Client assignments
    WHEN 'user.client.assigned' THEN PERFORM handle_user_client_assigned(p_event);
    WHEN 'user.client.unassigned' THEN PERFORM handle_user_client_unassigned(p_event);

    ELSE
      RAISE WARNING 'Unknown user event type: %', p_event.event_type;
  END CASE;
END;
$$;

COMMENT ON FUNCTION process_user_event(record) IS
'User event router v7 - dispatches to individual handler functions.

Handlers:
- Lifecycle: handle_user_created, handle_user_synced_from_auth,
  handle_user_deactivated, handle_user_reactivated, handle_user_organization_switched
- Roles: handle_user_role_assigned, handle_user_role_revoked
- Access: handle_user_access_dates_updated
- Notifications: handle_user_notification_preferences_updated
- Address: handle_user_address_added/updated/removed
- Phone: handle_user_phone_added/updated/removed
- Schedule: handle_user_schedule_created/updated/deactivated/reactivated/deleted
- Client Assignment: handle_user_client_assigned/unassigned';

-- =============================================================================
-- 4. UPDATE EXISTING SCHEDULE RPCs
-- =============================================================================

-- api.create_user_schedule — add p_schedule_name parameter
CREATE OR REPLACE FUNCTION api.create_user_schedule(
  p_user_id UUID,
  p_schedule_name TEXT,
  p_schedule JSONB,
  p_org_unit_id UUID DEFAULT NULL,
  p_effective_from DATE DEFAULT NULL,
  p_effective_until DATE DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_schedule_id UUID;
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization context required');
  END IF;

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User ID is required');
  END IF;

  IF p_schedule_name IS NULL OR TRIM(p_schedule_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Schedule name is required');
  END IF;

  IF p_schedule IS NULL OR p_schedule = '{}'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'error', 'Schedule is required');
  END IF;

  v_schedule_id := gen_random_uuid();

  PERFORM api.emit_domain_event(
    p_stream_id := p_user_id,
    p_stream_type := 'user',
    p_event_type := 'user.schedule.created',
    p_event_data := jsonb_build_object(
      'schedule_id', v_schedule_id,
      'organization_id', v_org_id,
      'schedule_name', TRIM(p_schedule_name),
      'schedule', p_schedule,
      'org_unit_id', p_org_unit_id,
      'effective_from', p_effective_from,
      'effective_until', p_effective_until
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', v_user_id,
      'organization_id', v_org_id
    ) || CASE WHEN p_reason IS NOT NULL
         THEN jsonb_build_object('reason', p_reason)
         ELSE '{}'::jsonb END
  );

  RETURN jsonb_build_object(
    'success', true,
    'schedule_id', v_schedule_id
  );
END;
$$;

-- Drop old signature grant and add new
DO $$ BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION api.create_user_schedule(UUID, JSONB, UUID, DATE, DATE, TEXT) FROM authenticated';
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

GRANT EXECUTE ON FUNCTION api.create_user_schedule(UUID, TEXT, JSONB, UUID, DATE, DATE, TEXT) TO authenticated;

-- api.update_user_schedule — add p_schedule_name parameter
CREATE OR REPLACE FUNCTION api.update_user_schedule(
  p_schedule_id UUID,
  p_schedule_name TEXT DEFAULT NULL,
  p_schedule JSONB DEFAULT NULL,
  p_org_unit_id UUID DEFAULT NULL,
  p_effective_from DATE DEFAULT NULL,
  p_effective_until DATE DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_target_user_id UUID;
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization context required');
  END IF;

  -- Verify schedule exists and belongs to this org
  SELECT user_id INTO v_target_user_id
  FROM user_schedule_policies_projection
  WHERE id = p_schedule_id AND organization_id = v_org_id AND is_active = true;

  IF v_target_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Active schedule not found');
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := v_target_user_id,
    p_stream_type := 'user',
    p_event_type := 'user.schedule.updated',
    p_event_data := jsonb_build_object(
      'schedule_id', p_schedule_id,
      'organization_id', v_org_id,
      'schedule_name', p_schedule_name,
      'schedule', p_schedule,
      'org_unit_id', p_org_unit_id,
      'effective_from', p_effective_from,
      'effective_until', p_effective_until
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', v_user_id,
      'organization_id', v_org_id
    ) || CASE WHEN p_reason IS NOT NULL
         THEN jsonb_build_object('reason', p_reason)
         ELSE '{}'::jsonb END
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Drop old signature grant and add new
DO $$ BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION api.update_user_schedule(UUID, JSONB, UUID, DATE, DATE, TEXT) FROM authenticated';
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

GRANT EXECUTE ON FUNCTION api.update_user_schedule(UUID, TEXT, JSONB, UUID, DATE, DATE, TEXT) TO authenticated;

-- api.list_user_schedules — add schedule_name to output and filter
CREATE OR REPLACE FUNCTION api.list_user_schedules(
  p_org_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_org_unit_id UUID DEFAULT NULL,
  p_active_only BOOLEAN DEFAULT true,
  p_schedule_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_org_id UUID;
  v_result JSONB;
BEGIN
  v_org_id := COALESCE(p_org_id, public.get_current_org_id());

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization context required');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'user_id', s.user_id,
      'user_name', COALESCE(u.name, u.email),
      'user_email', u.email,
      'organization_id', s.organization_id,
      'schedule_name', s.schedule_name,
      'org_unit_id', s.org_unit_id,
      'org_unit_name', ou.name,
      'schedule', s.schedule,
      'effective_from', s.effective_from,
      'effective_until', s.effective_until,
      'is_active', s.is_active,
      'created_at', s.created_at,
      'updated_at', s.updated_at
    ) ORDER BY s.schedule_name, u.name, u.email
  ), '[]'::jsonb) INTO v_result
  FROM user_schedule_policies_projection s
  LEFT JOIN users u ON u.id = s.user_id
  LEFT JOIN organization_units_projection ou ON ou.id = s.org_unit_id
  WHERE s.organization_id = v_org_id
    AND (p_user_id IS NULL OR s.user_id = p_user_id)
    AND (p_org_unit_id IS NULL OR s.org_unit_id = p_org_unit_id)
    AND (p_schedule_name IS NULL OR s.schedule_name = p_schedule_name)
    AND (NOT p_active_only OR s.is_active = true);

  RETURN jsonb_build_object('success', true, 'data', v_result);
END;
$$;

-- Drop old signature grant and add new
DO $$ BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION api.list_user_schedules(UUID, UUID, UUID, BOOLEAN) FROM authenticated';
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

GRANT EXECUTE ON FUNCTION api.list_user_schedules(UUID, UUID, UUID, BOOLEAN, TEXT) TO authenticated;

-- =============================================================================
-- 5. NEW RPCs
-- =============================================================================

-- api.reactivate_user_schedule
CREATE OR REPLACE FUNCTION api.reactivate_user_schedule(
  p_schedule_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_target_user_id UUID;
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization context required');
  END IF;

  SELECT user_id INTO v_target_user_id
  FROM user_schedule_policies_projection
  WHERE id = p_schedule_id AND organization_id = v_org_id AND is_active = false;

  IF v_target_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Inactive schedule not found');
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := v_target_user_id,
    p_stream_type := 'user',
    p_event_type := 'user.schedule.reactivated',
    p_event_data := jsonb_build_object(
      'schedule_id', p_schedule_id,
      'organization_id', v_org_id
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', v_user_id,
      'organization_id', v_org_id
    ) || CASE WHEN p_reason IS NOT NULL
         THEN jsonb_build_object('reason', p_reason)
         ELSE '{}'::jsonb END
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION api.reactivate_user_schedule(UUID, TEXT) TO authenticated;

-- api.delete_user_schedule
CREATE OR REPLACE FUNCTION api.delete_user_schedule(
  p_schedule_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_target_user_id UUID;
  v_is_active BOOLEAN;
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization context required');
  END IF;

  SELECT user_id, is_active INTO v_target_user_id, v_is_active
  FROM user_schedule_policies_projection
  WHERE id = p_schedule_id AND organization_id = v_org_id;

  IF v_target_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Schedule not found');
  END IF;

  IF v_is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'Schedule must be deactivated before deletion');
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := v_target_user_id,
    p_stream_type := 'user',
    p_event_type := 'user.schedule.deleted',
    p_event_data := jsonb_build_object(
      'schedule_id', p_schedule_id,
      'organization_id', v_org_id
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', v_user_id,
      'organization_id', v_org_id
    ) || CASE WHEN p_reason IS NOT NULL
         THEN jsonb_build_object('reason', p_reason)
         ELSE '{}'::jsonb END
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION api.delete_user_schedule(UUID, TEXT) TO authenticated;

-- api.get_schedule_by_id
CREATE OR REPLACE FUNCTION api.get_schedule_by_id(
  p_schedule_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_org_id UUID;
  v_result JSONB;
BEGIN
  v_org_id := public.get_current_org_id();

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization context required');
  END IF;

  SELECT jsonb_build_object(
    'id', s.id,
    'user_id', s.user_id,
    'user_name', COALESCE(u.name, u.email),
    'user_email', u.email,
    'organization_id', s.organization_id,
    'schedule_name', s.schedule_name,
    'org_unit_id', s.org_unit_id,
    'org_unit_name', ou.name,
    'schedule', s.schedule,
    'effective_from', s.effective_from,
    'effective_until', s.effective_until,
    'is_active', s.is_active,
    'created_at', s.created_at,
    'updated_at', s.updated_at
  ) INTO v_result
  FROM user_schedule_policies_projection s
  LEFT JOIN users u ON u.id = s.user_id
  LEFT JOIN organization_units_projection ou ON ou.id = s.org_unit_id
  WHERE s.id = p_schedule_id AND s.organization_id = v_org_id;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Schedule not found');
  END IF;

  RETURN jsonb_build_object('success', true, 'data', v_result);
END;
$$;

GRANT EXECUTE ON FUNCTION api.get_schedule_by_id(UUID) TO authenticated;

-- =============================================================================
-- 6. PERMISSION.UPDATED HANDLER + RBAC ROUTER UPDATE
-- =============================================================================

-- Handler for permission.updated
CREATE OR REPLACE FUNCTION handle_permission_updated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE permissions_projection SET
    description = COALESCE(p_event.event_data->>'description', description),
    scope_type = COALESCE(p_event.event_data->>'scope_type', scope_type),
    requires_mfa = COALESCE((p_event.event_data->>'requires_mfa')::boolean, requires_mfa)
  WHERE id = p_event.stream_id;
END;
$$;

COMMENT ON FUNCTION handle_permission_updated(record) IS
'Event handler for permission.updated events.
Updates mutable fields on permissions_projection matched by stream_id.';

-- Update RBAC router to include permission.updated
CREATE OR REPLACE FUNCTION process_rbac_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  CASE p_event.event_type
    -- Role lifecycle
    WHEN 'role.created' THEN PERFORM handle_role_created(p_event);
    WHEN 'role.updated' THEN PERFORM handle_role_updated(p_event);
    WHEN 'role.deactivated' THEN PERFORM handle_role_deactivated(p_event);
    WHEN 'role.reactivated' THEN PERFORM handle_role_reactivated(p_event);
    WHEN 'role.deleted' THEN PERFORM handle_role_deleted(p_event);

    -- Role permissions
    WHEN 'role.permission.granted' THEN PERFORM handle_role_permission_granted(p_event);
    WHEN 'role.permission.revoked' THEN PERFORM handle_role_permission_revoked(p_event);

    -- Permission lifecycle
    WHEN 'permission.defined' THEN PERFORM handle_permission_defined(p_event);
    WHEN 'permission.updated' THEN PERFORM handle_permission_updated(p_event);

    -- User role assignment
    WHEN 'user.role.assigned' THEN PERFORM handle_rbac_user_role_assigned(p_event);
    WHEN 'user.role.revoked' THEN PERFORM handle_user_role_revoked(p_event);

    ELSE
      RAISE WARNING 'Unknown RBAC event type: %', p_event.event_type;
  END CASE;
END;
$$;

COMMENT ON FUNCTION process_rbac_event(record) IS
'RBAC event router v3 - dispatches to individual handler functions.
Handlers: handle_role_created/updated/deactivated/reactivated/deleted,
handle_role_permission_granted/revoked, handle_permission_defined/updated,
handle_rbac_user_role_assigned, handle_user_role_revoked';

-- =============================================================================
-- 7. EMIT permission.updated EVENT TO UPDATE DESCRIPTION
-- =============================================================================
-- The handler + router above MUST exist before this INSERT fires the trigger.

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  SELECT
    p.id, 'permission', 2, 'permission.updated',
    jsonb_build_object(
      'description', 'Create, update, deactivate, reactivate, and delete staff work schedules'
    ),
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Update description to reflect full CRUD lifecycle"}'::jsonb
  FROM permissions_projection p
  WHERE p.name = 'user.schedule_manage';
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- =============================================================================
-- 8. VERIFY GRANTS (existing, but confirm)
-- =============================================================================

GRANT SELECT ON TABLE public.user_schedule_policies_projection TO authenticated;
GRANT SELECT ON TABLE public.user_schedule_policies_projection TO service_role;
