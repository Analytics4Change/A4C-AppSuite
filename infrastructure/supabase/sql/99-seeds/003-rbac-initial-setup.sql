-- RBAC Initial Setup: Permissions, Roles, and Role-Permission Grants
-- This seed data creates the foundational RBAC structure via events
-- All inserts go through the event-sourced architecture

-- ========================================
-- Initial Permissions
-- ========================================

-- Medication Management Permissions
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  -- medication.create
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "medication", "action": "create", "description": "Create new medication prescriptions", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining medication management permissions"}'::jsonb),

  -- medication.view
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "medication", "action": "view", "description": "View medication history and prescriptions", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining medication management permissions"}'::jsonb),

  -- medication.update
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "medication", "action": "update", "description": "Modify existing prescriptions", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining medication management permissions"}'::jsonb),

  -- medication.delete
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "medication", "action": "delete", "description": "Discontinue/archive medications", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining medication management permissions"}'::jsonb),

  -- medication.approve
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "medication", "action": "approve", "description": "Approve prescription changes", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining medication management permissions"}'::jsonb);

-- Provider Management Permissions
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  -- provider.create
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "provider", "action": "create", "description": "Create new provider organizations", "scope_type": "global", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining provider management permissions"}'::jsonb),

  -- provider.view
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "provider", "action": "view", "description": "View provider details and configurations", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining provider management permissions"}'::jsonb),

  -- provider.update
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "provider", "action": "update", "description": "Modify provider settings", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining provider management permissions"}'::jsonb),

  -- provider.delete
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "provider", "action": "delete", "description": "Archive providers", "scope_type": "global", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining provider management permissions"}'::jsonb),

  -- provider.impersonate
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "provider", "action": "impersonate", "description": "Impersonate users within provider organizations (Super Admin only)", "scope_type": "global", "requires_mfa": true}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining provider management permissions for Super Admin impersonation"}'::jsonb);

-- Client Management Permissions
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  -- client.create
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "client", "action": "create", "description": "Register new clients", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining client management permissions"}'::jsonb),

  -- client.view
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "client", "action": "view", "description": "View client records", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining client management permissions"}'::jsonb),

  -- client.update
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "client", "action": "update", "description": "Modify client information", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining client management permissions"}'::jsonb),

  -- client.delete
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "client", "action": "delete", "description": "Archive clients", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining client management permissions"}'::jsonb),

  -- client.discharge
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "client", "action": "discharge", "description": "Discharge clients from programs", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining client management permissions"}'::jsonb);

-- User Management Permissions
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  -- user.create
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "user", "action": "create", "description": "Create new user accounts", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining user management permissions"}'::jsonb),

  -- user.view
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "user", "action": "view", "description": "View user profiles", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining user management permissions"}'::jsonb),

  -- user.update
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "user", "action": "update", "description": "Modify user accounts", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining user management permissions"}'::jsonb),

  -- user.delete
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "user", "action": "delete", "description": "Deactivate users", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining user management permissions"}'::jsonb),

  -- user.assign_role
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "user", "action": "assign_role", "description": "Grant roles to users", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining user management permissions"}'::jsonb);

-- Access Grant Permissions
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  -- access_grant.create
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "access_grant", "action": "create", "description": "Create cross-tenant access grants", "scope_type": "org", "requires_mfa": true}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining cross-tenant access grant permissions"}'::jsonb),

  -- access_grant.view
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "access_grant", "action": "view", "description": "View existing grants", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining cross-tenant access grant permissions"}'::jsonb),

  -- access_grant.revoke
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "access_grant", "action": "revoke", "description": "Revoke cross-tenant access", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining cross-tenant access grant permissions"}'::jsonb),

  -- access_grant.approve
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "access_grant", "action": "approve", "description": "Approve Provider Partner access requests", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining cross-tenant access grant permissions"}'::jsonb);

-- Audit Permissions
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  -- audit.view
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "audit", "action": "view", "description": "View audit logs", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining audit log permissions"}'::jsonb),

  -- audit.export
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "audit", "action": "export", "description": "Export audit trails for compliance", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: defining audit log permissions"}'::jsonb);


-- ========================================
-- Initial Roles
-- ========================================

-- Super Admin Role (global scope)
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('11111111-1111-1111-1111-111111111111', 'role', 1, 'role.created',
   '{"name": "super_admin", "description": "Platform-wide administrator with all permissions across all organizations", "zitadel_org_id": null, "org_hierarchy_scope": null}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: creating super_admin role for A4C platform staff"}'::jsonb);

-- Provider Admin Role (org-scoped)
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('22222222-2222-2222-2222-222222222222', 'role', 1, 'role.created',
   '{"name": "provider_admin", "description": "Organization administrator with all permissions within their healthcare organization", "zitadel_org_id": "placeholder", "org_hierarchy_scope": "placeholder"}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: creating provider_admin role template for organization-level management"}'::jsonb);


-- ========================================
-- Grant All Permissions to Super Admin
-- ========================================

-- Grant all permissions to super_admin role
-- This dynamically grants all permissions that exist in the permissions_projection table

-- Note: The actual grant events will be generated after permissions are processed
-- This is a placeholder showing the pattern. In practice, you would:
-- 1. Wait for permission.defined events to be processed
-- 2. Query permissions_projection table
-- 3. Generate role.permission.granted events for each permission

-- Example for one permission (medication.create):
-- INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
-- SELECT
--   '11111111-1111-1111-1111-111111111111',
--   'role',
--   2 + row_number() OVER (),
--   'role.permission.granted',
--   jsonb_build_object('permission_id', id, 'permission_name', name),
--   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Initial RBAC setup: granting all permissions to super_admin role"}'::jsonb
-- FROM permissions_projection;

-- For now, we'll document this needs to be run after projection processing


-- ========================================
-- Grant All Permissions to Provider Admin (Template)
-- ========================================

-- Similarly, provider_admin role would receive all org-scoped permissions
-- This will be instantiated per organization when orgs are created


COMMENT ON EXTENSION IF EXISTS "uuid-ossp" IS 'Used for generating UUIDs for permission and role IDs';
