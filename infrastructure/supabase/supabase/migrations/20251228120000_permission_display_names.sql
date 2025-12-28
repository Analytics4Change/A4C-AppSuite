-- Migration: Add display_name column to permissions_projection
-- Purpose: Provide human-readable names for permissions in UI
-- Issue: #5 - Permission selector shows technical names like "organization.create"
--        instead of friendly names like "Create Organization"
--
-- Changes:
-- 1. Add display_name column to permissions_projection
-- 2. Update api.get_permissions() to return display_name
-- 3. Update process_rbac_events to populate display_name from events
-- 4. Populate display_name for existing permissions

-- ============================================================================
-- Step 1: Add display_name column
-- ============================================================================
ALTER TABLE public.permissions_projection
  ADD COLUMN IF NOT EXISTS display_name TEXT;

COMMENT ON COLUMN public.permissions_projection.display_name IS 'Human-readable permission name for UI display (e.g., "Create Organization" instead of "organization.create")';

-- ============================================================================
-- Step 2: Update api.get_permissions() to return display_name
-- ============================================================================
CREATE OR REPLACE FUNCTION api.get_permissions()
RETURNS TABLE (
  id UUID,
  name TEXT,
  applet TEXT,
  action TEXT,
  display_name TEXT,
  description TEXT,
  scope_type TEXT,
  requires_mfa BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.applet,
    p.action,
    p.display_name,
    p.description,
    p.scope_type,
    p.requires_mfa
  FROM permissions_projection p
  ORDER BY p.applet, p.action;
END;
$$;

COMMENT ON FUNCTION api.get_permissions IS 'List all available permissions with display names. Used for role permission selector UI.';

-- ============================================================================
-- Step 2b: Update api.get_role_by_id() to return display_name in permissions
-- ============================================================================
CREATE OR REPLACE FUNCTION api.get_role_by_id(p_role_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  organization_id UUID,
  org_hierarchy_scope TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  permissions JSONB
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.name,
    r.description,
    r.organization_id,
    r.org_hierarchy_scope::TEXT,
    r.is_active,
    r.created_at,
    r.updated_at,
    (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'applet', p.applet,
        'action', p.action,
        'display_name', p.display_name,
        'description', p.description,
        'scope_type', p.scope_type
      ) ORDER BY p.applet, p.action), '[]'::jsonb)
      FROM role_permissions_projection rp
      JOIN permissions_projection p ON p.id = rp.permission_id
      WHERE rp.role_id = r.id
    ) AS permissions
  FROM roles_projection r
  WHERE
    r.id = p_role_id
    AND r.deleted_at IS NULL;
END;
$$;

COMMENT ON FUNCTION api.get_role_by_id IS 'Get a single role with its associated permissions including display names. Access controlled by RLS.';

-- ============================================================================
-- Step 3: Update process_rbac_events to handle display_name
-- ============================================================================
-- Note: The function needs to support display_name in permission.defined events
-- and fall back to generating one if not provided

CREATE OR REPLACE FUNCTION public.process_rbac_events(p_event domain_events)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_permission_ids UUID[];
  v_permission_id UUID;
  v_existing_permissions UUID[];
  v_permissions_to_add UUID[];
  v_permissions_to_remove UUID[];
  v_display_name TEXT;
  v_applet TEXT;
  v_action TEXT;
BEGIN
  CASE p_event.event_type
    -- Permission Events
    WHEN 'permission.defined' THEN
      v_applet := p_event.event_data->>'applet';
      v_action := p_event.event_data->>'action';
      -- Use display_name from event if provided, otherwise generate from applet.action
      v_display_name := COALESCE(
        p_event.event_data->>'display_name',
        INITCAP(REPLACE(v_action, '_', ' ')) || ' ' || INITCAP(REPLACE(v_applet, '_', ' '))
      );

      INSERT INTO permissions_projection (
        id, applet, action, display_name, description, scope_type, requires_mfa, created_at
      ) VALUES (
        p_event.stream_id,
        v_applet,
        v_action,
        v_display_name,
        p_event.event_data->>'description',
        p_event.event_data->>'scope_type',
        COALESCE((p_event.event_data->>'requires_mfa')::BOOLEAN, false),
        p_event.created_at
      )
      ON CONFLICT (id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        description = EXCLUDED.description,
        scope_type = EXCLUDED.scope_type,
        requires_mfa = EXCLUDED.requires_mfa;

    -- Role Events
    WHEN 'role.created' THEN
      INSERT INTO roles_projection (
        id, name, description, organization_id, org_hierarchy_scope, created_at, is_active
      ) VALUES (
        p_event.stream_id,
        p_event.event_data->>'name',
        p_event.event_data->>'description',
        CASE
          WHEN p_event.event_data->>'organization_id' IS NOT NULL
          THEN (p_event.event_data->>'organization_id')::UUID
          ELSE NULL
        END,
        CASE
          WHEN p_event.event_data->>'org_hierarchy_scope' IS NOT NULL
          THEN (p_event.event_data->>'org_hierarchy_scope')::LTREE
          ELSE NULL
        END,
        p_event.created_at,
        TRUE
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        updated_at = now();

    WHEN 'role.updated' THEN
      UPDATE roles_projection
      SET
        name = COALESCE(p_event.event_data->>'name', name),
        description = COALESCE(p_event.event_data->>'description', description),
        updated_at = now()
      WHERE id = p_event.stream_id;

    WHEN 'role.deactivated' THEN
      UPDATE roles_projection
      SET is_active = FALSE, updated_at = now()
      WHERE id = p_event.stream_id;

    WHEN 'role.reactivated' THEN
      UPDATE roles_projection
      SET is_active = TRUE, updated_at = now()
      WHERE id = p_event.stream_id;

    WHEN 'role.deleted' THEN
      UPDATE roles_projection
      SET deleted_at = now(), is_active = FALSE, updated_at = now()
      WHERE id = p_event.stream_id;

    WHEN 'role.permission.granted' THEN
      INSERT INTO role_permissions_projection (role_id, permission_id, granted_at)
      VALUES (
        p_event.stream_id,
        (p_event.event_data->>'permission_id')::UUID,
        p_event.created_at
      )
      ON CONFLICT (role_id, permission_id) DO NOTHING;

    WHEN 'role.permission.revoked' THEN
      DELETE FROM role_permissions_projection
      WHERE role_id = p_event.stream_id
        AND permission_id = (p_event.event_data->>'permission_id')::UUID;

    WHEN 'role.permissions.sync' THEN
      -- Batch sync: add all new permissions, remove all old ones
      v_permission_ids := ARRAY(
        SELECT jsonb_array_elements_text(p_event.event_data->'permission_ids')::UUID
      );

      -- Get existing permissions for this role
      SELECT ARRAY_AGG(permission_id) INTO v_existing_permissions
      FROM role_permissions_projection
      WHERE role_id = p_event.stream_id;

      v_existing_permissions := COALESCE(v_existing_permissions, ARRAY[]::UUID[]);

      -- Calculate diff
      v_permissions_to_add := ARRAY(
        SELECT unnest(v_permission_ids) EXCEPT SELECT unnest(v_existing_permissions)
      );
      v_permissions_to_remove := ARRAY(
        SELECT unnest(v_existing_permissions) EXCEPT SELECT unnest(v_permission_ids)
      );

      -- Remove old permissions
      IF array_length(v_permissions_to_remove, 1) > 0 THEN
        DELETE FROM role_permissions_projection
        WHERE role_id = p_event.stream_id
          AND permission_id = ANY(v_permissions_to_remove);
      END IF;

      -- Add new permissions
      IF array_length(v_permissions_to_add, 1) > 0 THEN
        INSERT INTO role_permissions_projection (role_id, permission_id, granted_at)
        SELECT p_event.stream_id, unnest(v_permissions_to_add), p_event.created_at
        ON CONFLICT (role_id, permission_id) DO NOTHING;
      END IF;

    -- User Role Events
    WHEN 'user.role.assigned' THEN
      INSERT INTO user_roles_projection (user_id, role_id, organization_id, scope_path, assigned_at)
      VALUES (
        p_event.stream_id,
        (p_event.event_data->>'role_id')::UUID,
        CASE
          WHEN p_event.event_data->>'org_id' = '*' THEN NULL
          WHEN p_event.event_data->>'org_id' IS NOT NULL
          THEN (p_event.event_data->>'org_id')::UUID
          ELSE NULL
        END,
        CASE
          WHEN p_event.event_data->>'scope_path' = '*' THEN NULL
          WHEN p_event.event_data->>'scope_path' IS NOT NULL
          THEN (p_event.event_data->>'scope_path')::LTREE
          ELSE NULL
        END,
        p_event.created_at
      )
      ON CONFLICT ON CONSTRAINT user_roles_projection_user_id_role_id_org_id_key DO NOTHING;

    WHEN 'user.role.revoked' THEN
      DELETE FROM user_roles_projection
      WHERE user_id = p_event.stream_id
        AND role_id = (p_event.event_data->>'role_id')::UUID
        AND (
          (organization_id IS NULL AND p_event.event_data->>'org_id' = '*')
          OR organization_id = (p_event.event_data->>'org_id')::UUID
        );

    ELSE
      -- Unknown event type - log but don't fail
      RAISE NOTICE 'process_rbac_events: Unknown event type: %', p_event.event_type;
  END CASE;
END;
$$;

COMMENT ON FUNCTION public.process_rbac_events(domain_events) IS 'Process RBAC domain events (permissions, roles, user assignments). Updates projections. Supports display_name for permissions.';

-- ============================================================================
-- Step 4: Populate display_name for existing permissions
-- ============================================================================
-- Update all existing permissions with user-friendly display names and descriptions

-- Organization Management (scope_type: global - platform_owner only)
UPDATE permissions_projection SET
  display_name = 'Create Organization',
  description = 'Create new tenant organizations in the platform'
WHERE name = 'organization.create';

UPDATE permissions_projection SET
  display_name = 'View Organizations',
  description = 'View organization details and settings'
WHERE name = 'organization.view';

UPDATE permissions_projection SET
  display_name = 'Update Organization',
  description = 'Modify organization settings and configuration'
WHERE name = 'organization.update';

UPDATE permissions_projection SET
  display_name = 'Delete Organization',
  description = 'Permanently remove organizations from the platform'
WHERE name = 'organization.delete';

UPDATE permissions_projection SET
  display_name = 'Deactivate Organization',
  description = 'Temporarily disable organizations'
WHERE name = 'organization.deactivate';

UPDATE permissions_projection SET
  display_name = 'Create Sub-Organization',
  description = 'Create child organizations under existing organizations'
WHERE name = 'organization.create_sub';

-- Organization Unit Management (scope_type: org - all org_types)
UPDATE permissions_projection SET
  display_name = 'View Org Units',
  description = 'View organizational unit hierarchy and details'
WHERE name = 'organization.view_ou';

UPDATE permissions_projection SET
  display_name = 'Create Org Unit',
  description = 'Create new organizational units (departments, locations, etc.)'
WHERE name = 'organization.create_ou';

UPDATE permissions_projection SET
  display_name = 'Update Org Unit',
  description = 'Modify organizational unit settings'
WHERE name = 'organization.update_ou';

UPDATE permissions_projection SET
  display_name = 'Delete Org Unit',
  description = 'Remove organizational units from the hierarchy'
WHERE name = 'organization.delete_ou';

-- Client Management
UPDATE permissions_projection SET
  display_name = 'Create Client',
  description = 'Add new client records to the system'
WHERE name = 'client.create';

UPDATE permissions_projection SET
  display_name = 'View Clients',
  description = 'View client information and records'
WHERE name = 'client.view';

UPDATE permissions_projection SET
  display_name = 'Update Client',
  description = 'Modify client information and records'
WHERE name = 'client.update';

UPDATE permissions_projection SET
  display_name = 'Delete Client',
  description = 'Remove client records from the system'
WHERE name = 'client.delete';

-- Medication Management
UPDATE permissions_projection SET
  display_name = 'Add Medication',
  description = 'Add new medication entries for clients'
WHERE name = 'medication.create';

UPDATE permissions_projection SET
  display_name = 'View Medications',
  description = 'View medication records and history'
WHERE name = 'medication.view';

UPDATE permissions_projection SET
  display_name = 'Update Medication',
  description = 'Modify medication entries'
WHERE name = 'medication.update';

UPDATE permissions_projection SET
  display_name = 'Delete Medication',
  description = 'Remove medication entries from records'
WHERE name = 'medication.delete';

UPDATE permissions_projection SET
  display_name = 'Approve Medication',
  description = 'Approve medication requests or changes'
WHERE name = 'medication.approve';

-- User Management
UPDATE permissions_projection SET
  display_name = 'Create User',
  description = 'Invite new users to the organization'
WHERE name = 'user.create';

UPDATE permissions_projection SET
  display_name = 'View Users',
  description = 'View user profiles and information'
WHERE name = 'user.view';

UPDATE permissions_projection SET
  display_name = 'Update User',
  description = 'Modify user profiles and settings'
WHERE name = 'user.update';

UPDATE permissions_projection SET
  display_name = 'Delete User',
  description = 'Remove user accounts from the organization'
WHERE name = 'user.delete';

UPDATE permissions_projection SET
  display_name = 'Deactivate User',
  description = 'Temporarily disable user accounts'
WHERE name = 'user.deactivate';

-- Role Management
UPDATE permissions_projection SET
  display_name = 'Create Role',
  description = 'Create custom roles for the organization'
WHERE name = 'role.create';

UPDATE permissions_projection SET
  display_name = 'View Roles',
  description = 'View role definitions and permissions'
WHERE name = 'role.view';

UPDATE permissions_projection SET
  display_name = 'Update Role',
  description = 'Modify role names, descriptions, and permissions'
WHERE name = 'role.update';

UPDATE permissions_projection SET
  display_name = 'Delete Role',
  description = 'Remove custom roles from the organization'
WHERE name = 'role.delete';

UPDATE permissions_projection SET
  display_name = 'Assign Role',
  description = 'Assign roles to users within the organization'
WHERE name = 'role.assign';

UPDATE permissions_projection SET
  display_name = 'Revoke Role',
  description = 'Remove role assignments from users'
WHERE name = 'role.revoke';

-- A4C Internal Roles
UPDATE permissions_projection SET
  display_name = 'Manage A4C Roles',
  description = 'Manage A4C internal role definitions'
WHERE applet = 'a4c_role';

-- Global Roles (scope_type: global - platform_owner only)
UPDATE permissions_projection SET
  display_name = 'Create Global Roles',
  description = 'Create platform-wide roles available to all organizations'
WHERE name = 'global_roles.create';

UPDATE permissions_projection SET
  display_name = 'Manage Global Roles',
  description = 'Manage platform-wide role definitions'
WHERE name = 'global_roles.manage';

-- Cross-Organization Access (scope_type: global - platform_owner only)
UPDATE permissions_projection SET
  display_name = 'Grant Cross-Org Access',
  description = 'Grant access across organization boundaries'
WHERE name = 'cross_org.grant';

UPDATE permissions_projection SET
  display_name = 'Revoke Cross-Org Access',
  description = 'Remove cross-organization access grants'
WHERE name = 'cross_org.revoke';

UPDATE permissions_projection SET
  display_name = 'View Cross-Org Access',
  description = 'View cross-organization access grants'
WHERE name = 'cross_org.view';

-- User Impersonation (scope_type: global - platform_owner only)
UPDATE permissions_projection SET
  display_name = 'Impersonate User',
  description = 'Access the system as another user for support purposes'
WHERE name = 'users.impersonate';

-- Generic fallback: Generate display names for any permissions not covered above
UPDATE permissions_projection
SET display_name = INITCAP(REPLACE(action, '_', ' ')) || ' ' || INITCAP(REPLACE(applet, '_', ' '))
WHERE display_name IS NULL;

-- ============================================================================
-- Verification
-- ============================================================================
DO $$
DECLARE
  v_count_without_display_name INT;
BEGIN
  SELECT COUNT(*) INTO v_count_without_display_name
  FROM permissions_projection
  WHERE display_name IS NULL OR display_name = '';

  IF v_count_without_display_name > 0 THEN
    RAISE WARNING 'Found % permissions without display_name', v_count_without_display_name;
  ELSE
    RAISE NOTICE 'All permissions have display_name populated';
  END IF;
END;
$$;
