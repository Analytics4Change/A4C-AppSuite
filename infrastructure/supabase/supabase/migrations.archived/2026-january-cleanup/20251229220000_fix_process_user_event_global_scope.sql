-- Fix process_user_event to handle global super_admin scope correctly
-- Problem: Events with org_id = platform UUID and scope_path = null violate CHECK constraint
-- Solution: Convert '*' and platform org UUID to NULL for global scope

-- Platform org UUID constant
-- aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa is the Analytics4Change platform organization

CREATE OR REPLACE FUNCTION "public"."process_user_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_org_path LTREE;
  v_org_id UUID;
  v_scope_path LTREE;
  v_platform_org_id UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID;
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
      -- Determine if this is a global scope assignment
      -- Global scope: org_id = '*' OR org_id = platform org UUID
      IF p_event.event_data->>'org_id' = '*'
         OR (p_event.event_data->>'org_id')::UUID = v_platform_org_id THEN
        -- Global scope: both org_id and scope_path must be NULL
        v_org_id := NULL;
        v_scope_path := NULL;
      ELSE
        -- Scoped assignment: get organization path
        v_org_id := (p_event.event_data->>'org_id')::UUID;

        -- Get scope_path from event or lookup from organization
        IF p_event.event_data->>'scope_path' IS NOT NULL
           AND p_event.event_data->>'scope_path' != '*' THEN
          v_scope_path := (p_event.event_data->>'scope_path')::LTREE;
        ELSE
          -- Lookup organization path as fallback
          SELECT path INTO v_scope_path
          FROM organizations_projection
          WHERE id = v_org_id;
        END IF;

        -- If we still don't have a scope_path but have an org_id,
        -- we can't insert (would violate CHECK constraint)
        IF v_org_id IS NOT NULL AND v_scope_path IS NULL THEN
          RAISE WARNING 'Cannot assign role: org_id % has no scope_path', v_org_id;
          RETURN;
        END IF;
      END IF;

      -- Insert role assignment with correct column name (organization_id, not org_id)
      INSERT INTO user_roles_projection (
        user_id,
        role_id,
        organization_id,
        scope_path,
        assigned_at
      ) VALUES (
        p_event.stream_id,  -- User ID is the stream_id
        (p_event.event_data->>'role_id')::UUID,
        v_org_id,
        v_scope_path,
        p_event.created_at
      )
      ON CONFLICT ON CONSTRAINT user_roles_projection_user_id_role_id_org_id_key DO NOTHING;

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
$$;

COMMENT ON FUNCTION "public"."process_user_event"("p_event" "record") IS 'User event processor - handles user.created, user.synced_from_auth, user.role.assigned events. Creates/updates users shadow table and user_roles_projection. Handles global scope (org_id=* or platform org) by setting both organization_id and scope_path to NULL.';
