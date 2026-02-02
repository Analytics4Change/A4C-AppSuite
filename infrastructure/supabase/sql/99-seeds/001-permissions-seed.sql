-- ============================================
-- AUTHORITATIVE PERMISSIONS SEED FILE
-- ============================================
-- This file defines ALL 38 permissions for the A4C platform.
-- It emits permission.defined domain events which trigger projection updates.
--
-- IMPORTANT: This is the SINGLE SOURCE OF TRUTH for permission definitions.
-- Any changes to permissions must be made here first, then regenerated via migration.
--
-- Scope Types:
--   'global' - Platform-level permissions (platform_owner only)
--   'org'    - Organization-level permissions (org admins)
--
-- Last Updated: 2026-02-02
-- Changes:
--   - 2026-02-02: Added user.schedule_manage, user.client_assign (Phase 7 - staff schedules & assignments)
--   - 2026-01-20: Day 0 v3 reconciliation - added platform.admin (was in DB but missing from seed)
--   - 2026-01-13: Added granular OU permissions (update_ou, delete_ou, deactivate_ou, reactivate_ou)
--   - Removed a4c_role.* (5 permissions) - not used
--   - Removed medication.prescribe - not needed
--   - Added medication.update, medication.delete
--   - Removed organization.business_profile_create, business_profile_update, create_sub
--   - Removed role.assign, role.grant (use user.role_assign, user.role_revoke instead)
--   - Updated organization permission descriptions for clarity
-- ============================================

-- ============================================
-- GLOBAL SCOPE PERMISSIONS (11 total)
-- Platform-level operations visible only to platform_owner
-- ============================================

-- Platform Administration (Global) - 1 permission
DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "platform", "action": "admin", "description": "Full platform administrative access including observability, cross-tenant operations, and system management. Required for Event Monitor, audit log access, and platform-level features.", "scope_type": "global", "requires_mfa": false, "display_name": "Platform Administration"}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Platform administration"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- Organization Management (Global) - 7 permissions
DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "organization", "action": "activate", "description": "Activate or reactivate organization", "scope_type": "global", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Organization lifecycle management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "organization", "action": "create", "description": "Create organizations", "scope_type": "global", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Organization lifecycle management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "organization", "action": "create_root", "description": "Create new root tenant organizations", "scope_type": "global", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Organization lifecycle management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "organization", "action": "deactivate", "description": "Deactivate organization (soft delete, reversible)", "scope_type": "global", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Organization lifecycle management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "organization", "action": "delete", "description": "Delete organizations", "scope_type": "global", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Organization lifecycle management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "organization", "action": "search", "description": "Search across all organizations", "scope_type": "global", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Organization lifecycle management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "organization", "action": "suspend", "description": "Suspend organization access (e.g., payment issues)", "scope_type": "global", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Organization lifecycle management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- Permission Catalog Management (Global) - 3 permissions
DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "permission", "action": "grant", "description": "Grant permissions to roles", "scope_type": "global", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Permission catalog management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "permission", "action": "revoke", "description": "Revoke permissions from roles", "scope_type": "global", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Permission catalog management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "permission", "action": "view", "description": "View available permissions and grants", "scope_type": "global", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Permission catalog management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- ============================================
-- ORG SCOPE PERMISSIONS (25 total)
-- Organization-level operations for org admins
-- ============================================

-- NOTE: a4c_role.* permissions removed - not used in codebase

-- Client Management (Org) - 4 permissions
DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "client", "action": "create", "description": "Create clients", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Client management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "client", "action": "delete", "description": "Delete clients", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Client management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "client", "action": "update", "description": "Update clients", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Client management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "client", "action": "view", "description": "View clients", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Client management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- Medication Management (Org) - 5 permissions
-- NOTE: Removed medication.prescribe, added medication.update and medication.delete
DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "medication", "action": "administer", "description": "Administer medications", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Medication management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "medication", "action": "create", "description": "Add medications", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Medication management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "medication", "action": "delete", "description": "Delete medications", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Medication management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "medication", "action": "update", "description": "Update medications", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Medication management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "medication", "action": "view", "description": "View medications", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Medication management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- Organization Management (Org-scoped) - 8 permissions
-- NOTE: Removed business_profile_create, business_profile_update, create_sub
-- 2026-01-13: Added granular OU permissions (update_ou, delete_ou, deactivate_ou, reactivate_ou)
DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "organization", "action": "create_ou", "description": "Create organization units within hierarchy", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Organization hierarchy management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "organization", "action": "update", "description": "Update organization settings", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Organization management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "organization", "action": "view", "description": "View organization settings", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Organization management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "organization", "action": "view_ou", "description": "View organization unit hierarchy", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Organization hierarchy management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "organization", "action": "update_ou", "description": "Update organization unit details", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Organization hierarchy management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "organization", "action": "delete_ou", "description": "Delete organization units", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Organization hierarchy management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "organization", "action": "deactivate_ou", "description": "Deactivate organization units (cascade to children)", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Organization hierarchy management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "organization", "action": "reactivate_ou", "description": "Reactivate organization units (cascade to children)", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Organization hierarchy management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- Role Management (Org) - 4 permissions
-- NOTE: Removed role.assign and role.grant (use user.role_assign and user.role_revoke)
DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "role", "action": "create", "description": "Create new roles within organization", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Role management - org scoped"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "role", "action": "delete", "description": "Delete role (soft delete, removes from all users)", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Role management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "role", "action": "update", "description": "Modify role details and description", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Role management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "role", "action": "view", "description": "View roles", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Role management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- User Management (Org) - 8 permissions
DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "user", "action": "create", "description": "Create users", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: User management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "user", "action": "delete", "description": "Delete users", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: User management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "user", "action": "role_assign", "description": "Assign roles to users", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: User management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "user", "action": "role_revoke", "description": "Revoke roles from users", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: User management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "user", "action": "update", "description": "Update users", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: User management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "user", "action": "view", "description": "View users", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: User management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- Staff Schedule Management
DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "user", "action": "schedule_manage", "description": "Create, update, and deactivate staff work schedules", "scope_type": "org", "requires_mfa": false, "display_name": "Manage Staff Schedules"}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Staff schedule management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- Client Assignment Management
DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "user", "action": "client_assign", "description": "Assign and unassign clients to/from staff members", "scope_type": "org", "requires_mfa": false, "display_name": "Assign Clients to Staff"}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Client assignment management"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- ============================================
-- END OF PERMISSIONS SEED FILE
-- Total: 37 permissions (10 global + 27 org)
-- ============================================
