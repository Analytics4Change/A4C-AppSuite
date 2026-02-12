-- ============================================
-- SEED: user.schedule_manage and user.client_assign permissions
-- Phase 7: Staff Schedules & Client Assignments
-- ============================================
-- These permissions were missing from the permissions_projection despite
-- being referenced in RLS policies (schedule/assignment migrations) and
-- permission_implications_seed. This migration seeds them via domain events
-- and adds role_permission_templates entries for provider_admin bootstrap.
-- ============================================

-- Permission: user.schedule_manage
DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "user", "action": "schedule_manage", "description": "Create, update, and deactivate staff work schedules", "scope_type": "org", "requires_mfa": false, "display_name": "Manage Staff Schedules"}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Staff schedule management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- Permission: user.client_assign
DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "user", "action": "client_assign", "description": "Assign and unassign clients to/from staff members", "scope_type": "org", "requires_mfa": false, "display_name": "Assign Clients to Staff"}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Client assignment management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- Role-permission templates: grant to provider_admin for bootstrap
INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'user.schedule_manage', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'user.client_assign', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;
