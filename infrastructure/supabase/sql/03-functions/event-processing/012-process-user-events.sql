-- User Event Processing Functions
-- Handles user lifecycle events with CQRS-compliant projection updates
-- Source events: user.* events in domain_events table
--
-- Events Handled:
--   - user.created: Creates shadow record in users table
--   - user.synced_from_auth: Syncs user from Supabase Auth
--   - user.role.assigned: Creates role assignment in user_roles_projection

-- Main user event processor
CREATE OR REPLACE FUNCTION process_user_event(
  p_event RECORD
) RETURNS VOID AS $$
DECLARE
  v_org_path LTREE;
BEGIN
  CASE p_event.event_type

    -- Handle user creation (from invitation acceptance)
    WHEN 'user.created' THEN
      INSERT INTO users (
        id,
        email,
        name,
        current_organization_id,
        accessible_organizations,
        roles,
        metadata,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        (p_event.event_data->>'user_id')::UUID,
        p_event.event_data->>'email',
        COALESCE(p_event.event_data->>'name', p_event.event_data->>'email'),
        (p_event.event_data->>'organization_id')::UUID,
        ARRAY[(p_event.event_data->>'organization_id')::UUID],
        '{}',  -- Roles populated by user.role.assigned events
        jsonb_build_object(
          'auth_method', p_event.event_data->>'auth_method',
          'invited_via', p_event.event_data->>'invited_via'
        ),
        true,
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        current_organization_id = COALESCE(users.current_organization_id, EXCLUDED.current_organization_id),
        accessible_organizations = ARRAY(
          SELECT DISTINCT unnest(users.accessible_organizations || EXCLUDED.accessible_organizations)
        ),
        updated_at = p_event.created_at;

    -- Handle user sync from Supabase Auth
    WHEN 'user.synced_from_auth' THEN
      INSERT INTO users (
        id,
        email,
        name,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        (p_event.event_data->>'auth_user_id')::UUID,
        p_event.event_data->>'email',
        COALESCE(p_event.event_data->>'name', p_event.event_data->>'email'),
        COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        name = COALESCE(EXCLUDED.name, users.name),
        is_active = EXCLUDED.is_active,
        updated_at = p_event.created_at;

    -- Handle role assignment
    WHEN 'user.role.assigned' THEN
      -- Get organization path for scope
      SELECT path INTO v_org_path
      FROM organizations_projection
      WHERE id = (p_event.event_data->>'org_id')::UUID;

      -- Insert role assignment
      INSERT INTO user_roles_projection (
        user_id,
        role_id,
        org_id,
        scope_path,
        assigned_at
      ) VALUES (
        p_event.stream_id,  -- User ID is the stream_id
        (p_event.event_data->>'role_id')::UUID,
        (p_event.event_data->>'org_id')::UUID,
        COALESCE(
          (p_event.event_data->>'scope_path')::LTREE,
          v_org_path
        ),
        p_event.created_at
      )
      ON CONFLICT (user_id, role_id, org_id) DO NOTHING;  -- Idempotent

      -- Update user's roles array
      UPDATE users
      SET
        roles = ARRAY(
          SELECT DISTINCT unnest(roles || ARRAY[p_event.event_data->>'role_name'])
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown user event type: %', p_event.event_type;
  END CASE;

END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- Comments for documentation
COMMENT ON FUNCTION process_user_event IS
  'User event processor - handles user.created, user.synced_from_auth, user.role.assigned events. Creates/updates users shadow table and user_roles_projection.';
