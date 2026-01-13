-- ============================================
-- ADD GRANULAR ORGANIZATION UNIT PERMISSIONS
-- ============================================
-- Adds 4 new permissions for fine-grained OU management:
--   - organization.update_ou
--   - organization.delete_ou
--   - organization.deactivate_ou
--   - organization.reactivate_ou
--
-- Previously, organization.create_ou gated all OU write operations.
-- These granular permissions enable role-based access control for
-- different OU management actions.
-- ============================================

-- ============================================
-- STEP 1: Define new permissions via domain events
-- ============================================

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "organization", "action": "update_ou", "description": "Update organization unit details", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Granular OU permissions for permission-based UI"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "organization", "action": "delete_ou", "description": "Delete organization units", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Granular OU permissions for permission-based UI"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "organization", "action": "deactivate_ou", "description": "Deactivate organization units (cascade to children)", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Granular OU permissions for permission-based UI"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "organization", "action": "reactivate_ou", "description": "Reactivate organization units (cascade to children)", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Granular OU permissions for permission-based UI"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- ============================================
-- STEP 2: Add to role_permission_templates for provider_admin bootstrap
-- ============================================

INSERT INTO role_permission_templates (role_name, permission_name)
VALUES
  ('provider_admin', 'organization.update_ou'),
  ('provider_admin', 'organization.delete_ou'),
  ('provider_admin', 'organization.deactivate_ou'),
  ('provider_admin', 'organization.reactivate_ou')
ON CONFLICT (role_name, permission_name) DO NOTHING;

-- ============================================
-- STEP 3: Backfill existing provider_admin roles with new permissions
-- ============================================
-- This grants the new permissions to all existing provider_admin roles
-- so they have the same capabilities as newly bootstrapped orgs.

INSERT INTO role_permissions_projection (role_id, permission_id, granted_at)
SELECT r.id, p.id, NOW()
FROM roles_projection r
CROSS JOIN permissions_projection p
WHERE r.name = 'provider_admin'
  AND p.name IN (
    'organization.update_ou',
    'organization.delete_ou',
    'organization.deactivate_ou',
    'organization.reactivate_ou'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================
-- END OF MIGRATION
-- ============================================
