-- ========================================
-- Process Invitation Events
-- ========================================
-- Router-based event processor for invitation lifecycle events
--
-- Event Types Handled:
--   - invitation.accepted: User accepted invitation, assign role
--   - invitation.revoked: Invitation revoked (compensation/admin action)
--   - invitation.expired: Invitation expired without being accepted
--
-- NOTE: user.invited events have stream_type='organization' and are
--       handled by process_organization_event()
--
-- Security: SECURITY INVOKER (default) - runs with caller's privileges.
--           In the trigger chain, the caller is `postgres` via the
--           SECURITY DEFINER `api.emit_domain_event()` function.
--
-- Pattern: CQRS Event Sourcing with Router-based Processing
-- ========================================

CREATE OR REPLACE FUNCTION process_invitation_event(
  p_event RECORD
) RETURNS VOID AS $$
DECLARE
  v_role_id UUID;
  v_org_path LTREE;
  v_role_name TEXT;
BEGIN
  CASE p_event.event_type

    -- ========================================
    -- invitation.accepted
    -- ========================================
    -- User accepted invitation via Edge Function
    -- Updates invitation status and assigns role to user
    WHEN 'invitation.accepted' THEN
      -- Extract role name from event
      v_role_name := p_event.event_data->>'role';

      -- Mark invitation as accepted
      -- NOTE: Use stream_id (the invitation row id) not event_data.invitation_id
      -- The Edge Function uses the projection row id as the event stream_id
      UPDATE invitations_projection
      SET
        status = 'accepted',
        accepted_at = (p_event.event_data->>'accepted_at')::TIMESTAMPTZ,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      -- Get organization path for role scope
      SELECT path INTO v_org_path
      FROM organizations_projection
      WHERE id = (p_event.event_data->>'org_id')::UUID;

      -- Look up role by name for this organization
      -- Note: Only super_admin has NULL org_id. All other roles must be org-scoped.
      IF v_role_name = 'super_admin' THEN
        SELECT id INTO v_role_id
        FROM roles_projection
        WHERE name = 'super_admin'
          AND organization_id IS NULL;
      ELSE
        SELECT id INTO v_role_id
        FROM roles_projection
        WHERE name = v_role_name
          AND organization_id = (p_event.event_data->>'org_id')::UUID;
      END IF;

      -- If role doesn't exist, create it
      IF v_role_id IS NULL THEN
        v_role_id := gen_random_uuid();

        IF v_role_name = 'super_admin' THEN
          INSERT INTO roles_projection (
            id, name, description, organization_id, org_hierarchy_scope,
            is_active, created_at, updated_at
          ) VALUES (
            v_role_id,
            'super_admin',
            'Platform super administrator with global access',
            NULL,
            NULL,
            true,
            p_event.created_at,
            p_event.created_at
          )
          ON CONFLICT (name, organization_id) DO UPDATE SET updated_at = EXCLUDED.updated_at
          RETURNING id INTO v_role_id;

          RAISE NOTICE 'Created/found system role super_admin with ID %', v_role_id;
        ELSE
          INSERT INTO roles_projection (
            id, name, description, organization_id, org_hierarchy_scope,
            is_active, created_at, updated_at
          ) VALUES (
            v_role_id,
            v_role_name,
            format('%s role for organization', initcap(replace(v_role_name, '_', ' '))),
            (p_event.event_data->>'org_id')::UUID,
            v_org_path,
            true,
            p_event.created_at,
            p_event.created_at
          )
          ON CONFLICT (name, organization_id) DO UPDATE SET updated_at = EXCLUDED.updated_at
          RETURNING id INTO v_role_id;

          RAISE NOTICE 'Created/found role % with ID % for org %', v_role_name, v_role_id, p_event.event_data->>'org_id';
        END IF;
      END IF;

      -- Create role assignment in user_roles_projection
      INSERT INTO user_roles_projection (
        user_id,
        role_id,
        organization_id,
        scope_path,
        assigned_at
      ) VALUES (
        (p_event.event_data->>'user_id')::UUID,
        v_role_id,
        (p_event.event_data->>'org_id')::UUID,
        v_org_path,
        p_event.created_at
      )
      ON CONFLICT ON CONSTRAINT user_roles_projection_user_id_role_id_org_id_key DO NOTHING;

      -- Update user's roles array in users shadow table
      UPDATE users
      SET
        roles = ARRAY(
          SELECT DISTINCT unnest(COALESCE(roles, '{}') || ARRAY[v_role_name])
        ),
        accessible_organizations = ARRAY(
          SELECT DISTINCT unnest(COALESCE(accessible_organizations, '{}') || ARRAY[(p_event.event_data->>'org_id')::UUID])
        ),
        current_organization_id = COALESCE(current_organization_id, (p_event.event_data->>'org_id')::UUID),
        updated_at = p_event.created_at
      WHERE id = (p_event.event_data->>'user_id')::UUID;

    -- ========================================
    -- invitation.revoked
    -- ========================================
    -- Invitation revoked (workflow compensation or admin action)
    -- Updates invitation status to deleted
    WHEN 'invitation.revoked' THEN
      UPDATE invitations_projection
      SET
        status = 'deleted',
        updated_at = (p_event.event_data->>'revoked_at')::TIMESTAMPTZ
      WHERE id = p_event.stream_id
        AND status = 'pending';  -- Only revoke pending invitations (idempotent)

    -- ========================================
    -- invitation.expired
    -- ========================================
    -- Invitation expired without being accepted
    -- Updates invitation status to expired
    WHEN 'invitation.expired' THEN
      UPDATE invitations_projection
      SET
        status = 'expired',
        updated_at = (p_event.event_data->>'expired_at')::TIMESTAMPTZ
      WHERE id = p_event.stream_id
        AND status = 'pending';  -- Only expire pending invitations (idempotent)

    ELSE
      RAISE WARNING 'Unknown invitation event type: %', p_event.event_type;
  END CASE;

END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION process_invitation_event IS
  'Router-based processor for invitation lifecycle events (accepted, revoked, expired). Handles role assignment on acceptance. Runs via trigger chain with postgres privileges.';
