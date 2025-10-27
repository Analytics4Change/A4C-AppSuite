-- Minimal Permissions Seed: 22 Core Permissions for Bootstrap
-- All permissions inserted via permission.defined events for event sourcing integrity

-- ============================================================================
-- Organization Management Permissions (8)
-- ============================================================================

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  -- organization.create_root
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "organization",
     "action": "create_root",
     "description": "Create new root tenant organizations",
     "scope_type": "global",
     "requires_mfa": false
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Super Admin tenant onboarding"
   }'::jsonb),

  -- organization.create_sub
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "organization",
     "action": "create_sub",
     "description": "Create sub-organizations within organizational hierarchy",
     "scope_type": "org",
     "requires_mfa": false
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Organization hierarchy management"
   }'::jsonb),

  -- organization.view
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "organization",
     "action": "view",
     "description": "View organization details",
     "scope_type": "org",
     "requires_mfa": false
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Organization visibility"
   }'::jsonb),

  -- organization.update
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "organization",
     "action": "update",
     "description": "Update organization details and settings",
     "scope_type": "org",
     "requires_mfa": false
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Organization management"
   }'::jsonb),

  -- organization.deactivate
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "organization",
     "action": "deactivate",
     "description": "Deactivate organization (soft delete, reversible)",
     "scope_type": "global",
     "requires_mfa": true
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Organization lifecycle management"
   }'::jsonb),

  -- organization.delete
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "organization",
     "action": "delete",
     "description": "Permanently delete organization (irreversible)",
     "scope_type": "global",
     "requires_mfa": true
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Organization lifecycle management"
   }'::jsonb),

  -- organization.business_profile_create
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "organization",
     "action": "business_profile_create",
     "description": "Create business profile for organization",
     "scope_type": "org",
     "requires_mfa": false
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Organization profile management"
   }'::jsonb),

  -- organization.business_profile_update
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "organization",
     "action": "business_profile_update",
     "description": "Update business profile for organization",
     "scope_type": "org",
     "requires_mfa": false
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Organization profile management"
   }'::jsonb);


-- ============================================================================
-- Role Management Permissions (5)
-- ============================================================================

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  -- role.create
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "role",
     "action": "create",
     "description": "Create new roles within organization",
     "scope_type": "org",
     "requires_mfa": false
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Role management"
   }'::jsonb),

  -- role.view
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "role",
     "action": "view",
     "description": "View roles and their permissions",
     "scope_type": "org",
     "requires_mfa": false
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Role visibility"
   }'::jsonb),

  -- role.update
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "role",
     "action": "update",
     "description": "Modify role details and description",
     "scope_type": "org",
     "requires_mfa": false
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Role management"
   }'::jsonb),

  -- role.delete
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "role",
     "action": "delete",
     "description": "Delete role (soft delete, removes from all users)",
     "scope_type": "org",
     "requires_mfa": true
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Role management"
   }'::jsonb),

  -- role.grant
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "role",
     "action": "grant",
     "description": "Assign roles to users",
     "scope_type": "org",
     "requires_mfa": false
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: User role assignment"
   }'::jsonb);


-- ============================================================================
-- Permission Management Permissions (3)
-- ============================================================================

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  -- permission.grant
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "permission",
     "action": "grant",
     "description": "Grant permissions to roles",
     "scope_type": "global",
     "requires_mfa": true
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: RBAC management"
   }'::jsonb),

  -- permission.revoke
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "permission",
     "action": "revoke",
     "description": "Revoke permissions from roles",
     "scope_type": "global",
     "requires_mfa": true
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: RBAC management"
   }'::jsonb),

  -- permission.view
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "permission",
     "action": "view",
     "description": "View available permissions and grants",
     "scope_type": "global",
     "requires_mfa": false
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Permission visibility"
   }'::jsonb);


-- ============================================================================
-- User Management Permissions (6)
-- ============================================================================

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  -- user.create
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "user",
     "action": "create",
     "description": "Create new users in organization",
     "scope_type": "org",
     "requires_mfa": false
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: User management"
   }'::jsonb),

  -- user.view
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "user",
     "action": "view",
     "description": "View user profiles and details",
     "scope_type": "org",
     "requires_mfa": false
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: User visibility"
   }'::jsonb),

  -- user.update
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "user",
     "action": "update",
     "description": "Update user profile information",
     "scope_type": "org",
     "requires_mfa": false
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: User management"
   }'::jsonb),

  -- user.delete
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "user",
     "action": "delete",
     "description": "Delete user account (soft delete)",
     "scope_type": "org",
     "requires_mfa": true
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: User management"
   }'::jsonb),

  -- user.role_assign
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "user",
     "action": "role_assign",
     "description": "Assign roles to users (creates user.role.assigned event)",
     "scope_type": "org",
     "requires_mfa": false
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: User role management"
   }'::jsonb),

  -- user.role_revoke
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{
     "applet": "user",
     "action": "role_revoke",
     "description": "Revoke roles from users (creates user.role.revoked event)",
     "scope_type": "org",
     "requires_mfa": false
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: User role management"
   }'::jsonb);


-- ============================================================================
-- Verification
-- ============================================================================

-- Total: 22 permissions
-- Organization: 8 (create_root, create_sub, view, update, deactivate, delete, business_profile_create, business_profile_update)
-- Role: 5 (create, view, update, delete, grant)
-- Permission: 3 (grant, revoke, view)
-- User: 6 (create, view, update, delete, role_assign, role_revoke)
