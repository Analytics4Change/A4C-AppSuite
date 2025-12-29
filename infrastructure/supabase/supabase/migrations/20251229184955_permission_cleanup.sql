-- Permission Architecture Cleanup Migration
-- ===========================================
-- This migration cleans up the permission architecture by:
-- 1. Removing 11 unused/redundant permissions from projection
-- 2. Adding 2 new permissions (medication.update, medication.delete)
-- 3. Updating role_permission_templates for provider_admin
--
-- NOTE: domain_events are NOT deleted - they are historical audit records
-- that should be preserved for event sourcing integrity.
--
-- Permissions Removed:
--   - a4c_role.* (5) - not used in codebase
--   - medication.prescribe - not needed
--   - organization.business_profile_create - encapsulated in create_ou
--   - organization.business_profile_update - encapsulated in update
--   - organization.create_sub - sub-org = OU (redundant)
--   - role.assign - redundant with user.role_assign
--   - role.grant - redundant with user.role_assign
--
-- Permissions Added:
--   - medication.update - update medication records
--   - medication.delete - delete medication records
--
-- Final Count: 31 permissions (10 global + 21 org)
-- ============================================

-- Step 1: Delete role_permission assignments that reference permissions we're removing
-- This must happen BEFORE deleting from permissions_projection due to FK constraint
DELETE FROM role_permissions_projection
WHERE permission_id IN (
  SELECT id FROM permissions_projection
  WHERE applet || '.' || action IN (
    'a4c_role.assign', 'a4c_role.create', 'a4c_role.delete', 'a4c_role.update', 'a4c_role.view',
    'medication.prescribe',
    'organization.business_profile_create', 'organization.business_profile_update', 'organization.create_sub',
    'role.assign', 'role.grant'
  )
);

-- Step 2: Delete removed permissions from projection
DELETE FROM permissions_projection
WHERE applet || '.' || action IN (
  'a4c_role.assign',
  'a4c_role.create',
  'a4c_role.delete',
  'a4c_role.update',
  'a4c_role.view',
  'medication.prescribe',
  'organization.business_profile_create',
  'organization.business_profile_update',
  'organization.create_sub',
  'role.assign',
  'role.grant'
);

-- Step 3: Add new permissions via domain events
-- These will be processed by the event trigger to populate permissions_projection
-- medication.delete
DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "medication", "action": "delete", "description": "Delete medications", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Permission architecture cleanup - add medication.delete"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- medication.update
DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "medication", "action": "update", "description": "Update medications", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Permission architecture cleanup - add medication.update"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- Step 4: Update descriptions for organization permissions (for clarity)
UPDATE permissions_projection
SET description = 'View organization settings'
WHERE applet = 'organization' AND action = 'view';

UPDATE permissions_projection
SET description = 'Update organization settings'
WHERE applet = 'organization' AND action = 'update';

UPDATE permissions_projection
SET description = 'View organization unit hierarchy'
WHERE applet = 'organization' AND action = 'view_ou';

UPDATE permissions_projection
SET description = 'Create organization units within hierarchy'
WHERE applet = 'organization' AND action = 'create_ou';

-- Step 5: Update role_permission_templates for provider_admin
-- Remove old permission: role.assign
DELETE FROM role_permission_templates
WHERE role_name = 'provider_admin'
  AND permission_name = 'role.assign';

-- Add new permissions for provider_admin
INSERT INTO role_permission_templates (role_name, permission_name)
VALUES
  ('provider_admin', 'medication.update'),
  ('provider_admin', 'medication.delete'),
  ('provider_admin', 'user.role_assign'),
  ('provider_admin', 'user.role_revoke')
ON CONFLICT (role_name, permission_name) DO NOTHING;

-- Step 6: Verification
DO $$
DECLARE
  v_permission_count INT;
  v_deleted_count INT;
  v_template_count INT;
BEGIN
  -- Verify permission count is now 31
  SELECT COUNT(*) INTO v_permission_count FROM permissions_projection;

  -- Verify no deleted permissions remain
  SELECT COUNT(*) INTO v_deleted_count
  FROM permissions_projection
  WHERE applet || '.' || action IN (
    'a4c_role.assign', 'a4c_role.create', 'a4c_role.delete', 'a4c_role.update', 'a4c_role.view',
    'medication.prescribe',
    'organization.business_profile_create', 'organization.business_profile_update', 'organization.create_sub',
    'role.assign', 'role.grant'
  );

  -- Verify provider_admin template count
  SELECT COUNT(*) INTO v_template_count
  FROM role_permission_templates
  WHERE role_name = 'provider_admin';

  RAISE NOTICE 'Permission cleanup complete:';
  RAISE NOTICE '  - Total permissions: % (expected: 31)', v_permission_count;
  RAISE NOTICE '  - Deleted permissions remaining: % (expected: 0)', v_deleted_count;
  RAISE NOTICE '  - Provider admin template permissions: % (expected: 17)', v_template_count;

  IF v_deleted_count > 0 THEN
    RAISE WARNING 'Some deleted permissions still exist! Check migration.';
  END IF;
END $$;
