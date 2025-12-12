-- ========================================
-- Process InvitationAccepted Events
-- ========================================
-- Event-Driven Trigger: Updates invitations_projection and creates role assignment
--
-- Event Source: domain_events table (event_type = 'invitation.accepted')
-- Event Emitter: accept-invitation Edge Function
-- Projection Targets: invitations_projection, user_roles_projection
-- Pattern: CQRS Event Sourcing
-- ========================================

CREATE OR REPLACE FUNCTION process_invitation_accepted_event()
RETURNS TRIGGER AS $$
DECLARE
  v_role_id UUID;
  v_org_path LTREE;
  v_role_name TEXT;
BEGIN
  -- Extract role name from event
  v_role_name := NEW.event_data->>'role';

  -- Mark invitation as accepted
  UPDATE invitations_projection
  SET
    status = 'accepted',
    accepted_at = (NEW.event_data->>'accepted_at')::TIMESTAMPTZ,
    updated_at = NEW.created_at
  WHERE id = (NEW.event_data->>'invitation_id')::UUID
     OR invitation_id = (NEW.event_data->>'invitation_id')::UUID;

  -- Get organization path for role scope
  SELECT path INTO v_org_path
  FROM organizations_projection
  WHERE id = (NEW.event_data->>'org_id')::UUID;

  -- Look up role by name for this organization
  -- Note: Only super_admin has NULL org_id. All other roles (provider_admin, etc.) must be org-scoped.
  IF v_role_name = 'super_admin' THEN
    -- super_admin is the only system role with NULL org_id
    SELECT id INTO v_role_id
    FROM roles_projection
    WHERE name = 'super_admin'
      AND organization_id IS NULL;
  ELSE
    -- All other roles must be organization-scoped
    SELECT id INTO v_role_id
    FROM roles_projection
    WHERE name = v_role_name
      AND organization_id = (NEW.event_data->>'org_id')::UUID;
  END IF;

  -- If role doesn't exist, create it
  IF v_role_id IS NULL THEN
    v_role_id := gen_random_uuid();

    IF v_role_name = 'super_admin' THEN
      -- super_admin should already exist as seed data, but if not, create it as system role
      INSERT INTO roles_projection (
        id,
        name,
        description,
        organization_id,
        org_hierarchy_scope,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        v_role_id,
        'super_admin',
        'Platform super administrator with global access',
        NULL,  -- System role has NULL org_id
        NULL,  -- System role has NULL org_hierarchy_scope
        true,
        NEW.created_at,
        NEW.created_at
      )
      ON CONFLICT (id) DO NOTHING;

      RAISE NOTICE 'Created system role super_admin with ID %', v_role_id;
    ELSE
      -- All other roles are organization-scoped
      INSERT INTO roles_projection (
        id,
        name,
        description,
        organization_id,
        org_hierarchy_scope,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        v_role_id,
        v_role_name,
        format('%s role for organization', initcap(replace(v_role_name, '_', ' '))),
        (NEW.event_data->>'org_id')::UUID,
        v_org_path,
        true,
        NEW.created_at,
        NEW.created_at
      )
      ON CONFLICT (id) DO NOTHING;

      RAISE NOTICE 'Created role % with ID % for org %', v_role_name, v_role_id, NEW.event_data->>'org_id';
    END IF;
  END IF;

  -- Create role assignment in user_roles_projection
  INSERT INTO user_roles_projection (
    user_id,
    role_id,
    org_id,
    scope_path,
    assigned_at
  ) VALUES (
    (NEW.event_data->>'user_id')::UUID,
    v_role_id,
    (NEW.event_data->>'org_id')::UUID,
    v_org_path,
    NEW.created_at
  )
  ON CONFLICT (user_id, role_id, org_id) DO NOTHING;  -- Idempotent

  -- Update user's roles array in users shadow table
  UPDATE users
  SET
    roles = ARRAY(
      SELECT DISTINCT unnest(COALESCE(roles, '{}') || ARRAY[v_role_name])
    ),
    accessible_organizations = ARRAY(
      SELECT DISTINCT unnest(COALESCE(accessible_organizations, '{}') || ARRAY[(NEW.event_data->>'org_id')::UUID])
    ),
    current_organization_id = COALESCE(current_organization_id, (NEW.event_data->>'org_id')::UUID),
    updated_at = NEW.created_at
  WHERE id = (NEW.event_data->>'user_id')::UUID;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- ========================================
-- Register Trigger
-- ========================================
-- Fires AFTER INSERT on domain_events for invitation.accepted events only

DROP TRIGGER IF EXISTS process_invitation_accepted_event ON domain_events;

CREATE TRIGGER process_invitation_accepted_event
AFTER INSERT ON domain_events
FOR EACH ROW
WHEN (NEW.event_type = 'invitation.accepted')
EXECUTE FUNCTION process_invitation_accepted_event();

-- ========================================
-- Comments for Documentation
-- ========================================
COMMENT ON FUNCTION process_invitation_accepted_event() IS
'Event processor for InvitationAccepted domain events. Updates invitations_projection, creates role assignment in user_roles_projection, and updates users shadow table. Idempotent.';
