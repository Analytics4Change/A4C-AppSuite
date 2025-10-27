-- RBAC Initial Setup: Minimal Viable Permissions for Platform Bootstrap
-- This seed creates the foundational RBAC structure for:
-- 1. Super Admin: Manages tenant onboarding and A4C internal roles
-- 2. Provider Admin: Bootstrap role (permissions granted per organization later)
-- 3. Partner Admin: Bootstrap role (permissions granted per organization later)
--
-- All inserts go through the event-sourced architecture

-- ========================================
-- Phase 1: Organization Management Permissions
-- Super Admin manages tenant/provider onboarding
-- ========================================

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  -- organization.create
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "organization", "action": "create", "description": "Create new tenant organizations", "scope_type": "global", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin tenant onboarding"}'::jsonb),

  -- organization.suspend
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "organization", "action": "suspend", "description": "Suspend organization access (e.g., payment issues)", "scope_type": "global", "requires_mfa": true}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin tenant onboarding"}'::jsonb),

  -- organization.activate
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "organization", "action": "activate", "description": "Activate or reactivate organization", "scope_type": "global", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin tenant onboarding"}'::jsonb),

  -- organization.search
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "organization", "action": "search", "description": "Search across all organizations", "scope_type": "global", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin tenant onboarding"}'::jsonb);


-- ========================================
-- Phase 2: A4C Internal Role Management Permissions
-- Super Admin manages roles within Analytics4Change organization
-- ========================================

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  -- a4c_role.create
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "a4c_role", "action": "create", "description": "Create roles within A4C organization", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin role delegation within A4C"}'::jsonb),

  -- a4c_role.view
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "a4c_role", "action": "view", "description": "View A4C internal roles", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin role delegation within A4C"}'::jsonb),

  -- a4c_role.update
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "a4c_role", "action": "update", "description": "Modify A4C internal roles", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin role delegation within A4C"}'::jsonb),

  -- a4c_role.delete
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "a4c_role", "action": "delete", "description": "Delete A4C internal roles", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin role delegation within A4C"}'::jsonb),

  -- a4c_role.assign
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "a4c_role", "action": "assign", "description": "Assign A4C roles to A4C staff users", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin role delegation within A4C"}'::jsonb);


-- ========================================
-- Phase 3: Meta-Permissions (RBAC Management)
-- Super Admin manages permissions and role grants
-- ========================================

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  -- permission.grant
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "permission", "action": "grant", "description": "Grant permissions to roles", "scope_type": "global", "requires_mfa": true}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin RBAC management"}'::jsonb),

  -- permission.revoke
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "permission", "action": "revoke", "description": "Revoke permissions from roles", "scope_type": "global", "requires_mfa": true}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin RBAC management"}'::jsonb),

  -- role.grant
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "role", "action": "grant", "description": "Assign roles to users", "scope_type": "global", "requires_mfa": true}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin RBAC management"}'::jsonb);


-- ========================================
-- Initial Roles
-- ========================================

-- A4C Platform Organization (owner of the application)
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'organization', 1, 'organization.registered',
   '{
     "name": "Analytics4Change",
     "slug": "a4c",
     "org_type": "platform_owner",
     "parent_org_id": null,
     "zitadel_org_id": "339658157368404786",
     "settings": {
       "is_active": true,
       "is_internal": true,
       "description": "Platform owner organization"
     }
   }'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Creating A4C platform organization"}'::jsonb);

-- Super Admin Role (global scope, NULL org_id for platform-wide access)
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('11111111-1111-1111-1111-111111111111', 'role', 1, 'role.created',
   '{
     "name": "super_admin",
     "description": "Platform administrator who manages tenant onboarding and A4C internal roles"
   }'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Creating super_admin role for A4C platform staff"}'::jsonb);

-- Provider Admin Role Template (bootstrap only, actual roles created per organization)
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('22222222-2222-2222-2222-222222222222', 'role', 1, 'role.created',
   '{
     "name": "provider_admin",
     "description": "Organization administrator who manages their own provider organization (permissions granted during org provisioning)",
     "zitadel_org_id": null,
     "org_hierarchy_scope": null
   }'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Creating provider_admin role template"}'::jsonb);

-- Partner Admin Role Template (bootstrap only, actual roles created per organization)
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('33333333-3333-3333-3333-333333333333', 'role', 1, 'role.created',
   '{
     "name": "partner_admin",
     "description": "Provider partner administrator who manages cross-tenant access (permissions granted during org provisioning)",
     "zitadel_org_id": null,
     "org_hierarchy_scope": null
   }'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Creating partner_admin role template"}'::jsonb);


-- ========================================
-- Grant All Permissions to Super Admin
-- ========================================

-- Grant all 16 permissions to super_admin role
-- These will be processed by the event triggers into role_permissions_projection table

DO $$
DECLARE
  perm_record RECORD;
  version_counter INT := 2;  -- Start at version 2 (version 1 was role.created)
BEGIN
  -- Wait for permissions to be processed into projection (in real deployment)
  -- For seed script, we query permissions_projection after initial INSERT processing

  FOR perm_record IN
    SELECT id, applet, action
    FROM permissions_projection
    WHERE applet IN ('organization', 'a4c_role', 'permission', 'role')
  LOOP
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      '11111111-1111-1111-1111-111111111111',  -- super_admin role stream_id
      'role',
      version_counter,
      'role.permission.granted',
      jsonb_build_object(
        'permission_id', perm_record.id,
        'permission_name', perm_record.applet || '.' || perm_record.action
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Bootstrap: Granting ' || perm_record.applet || '.' || perm_record.action || ' to super_admin'
      )
    );

    version_counter := version_counter + 1;
  END LOOP;
END $$;


-- ========================================
-- Documentation
-- ========================================

COMMENT ON EXTENSION "uuid-ossp" IS 'Used for generating UUIDs for permission and role IDs';

-- Notes:
-- 1. Provider Admin and Partner Admin roles have NO permissions in this seed
--    - Permissions are granted during organization provisioning workflows
--    - This ensures proper scoping: provider_admin manages their org, not others
--
-- 2. Super Admin manages two distinct areas:
--    - Tenant/organization lifecycle (organization.*)
--    - A4C internal role delegation (a4c_role.*)
--
-- 3. Super Admin does NOT create provider roles like "clinician" or "specialist"
--    - Provider Admin creates those within their organization
--    - Example: "Lars granted medication.create to clinician role on 2025-10-20"
--      would be done by provider_admin, not super_admin
--
-- 4. Super Admin CAN impersonate any role via separate impersonation workflow
--    - Impersonation is audited and logged
--    - Super Admin acts under constraints of impersonated role
