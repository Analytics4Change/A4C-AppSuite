-- ============================================
-- REGENERATE ALL PERMISSIONS VIA EVENT SOURCING
-- ============================================
-- This migration fixes data corruption in permissions_projection where:
-- 1. 19 permissions existed without corresponding domain events (orphaned projections)
-- 2. role.create had scope_type='global' instead of correct 'org'
--
-- Root cause: Day 0 baseline captured projection state via pg_dump,
-- bypassing event sourcing and preserving corrupted data.
--
-- Solution: Delete all existing data and regenerate from authoritative seed.
-- All 42 permissions will be emitted as permission.defined events,
-- triggering the event processor to rebuild projections correctly.
-- ============================================

-- Step 1: Clear existing corrupted projection data
-- CASCADE will also clear role_permissions_projection
TRUNCATE permissions_projection CASCADE;

-- Step 2: Delete existing permission.defined events (partial/corrupted)
DELETE FROM domain_events WHERE event_type = 'permission.defined';

-- Step 3: Emit all 42 permission.defined events
-- Source: infrastructure/supabase/sql/99-seeds/001-permissions-seed.sql

-- ============================================
-- GLOBAL SCOPE PERMISSIONS (10 total)
-- ============================================

-- Organization Management (Global) - 7 permissions
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "organization", "action": "activate", "description": "Activate or reactivate organization", "scope_type": "global", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "organization", "action": "create", "description": "Create organizations", "scope_type": "global", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "organization", "action": "create_root", "description": "Create new root tenant organizations", "scope_type": "global", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "organization", "action": "deactivate", "description": "Deactivate organization (soft delete, reversible)", "scope_type": "global", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "organization", "action": "delete", "description": "Delete organizations", "scope_type": "global", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "organization", "action": "search", "description": "Search across all organizations", "scope_type": "global", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "organization", "action": "suspend", "description": "Suspend organization access (e.g., payment issues)", "scope_type": "global", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

-- Permission Catalog Management (Global) - 3 permissions
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "permission", "action": "grant", "description": "Grant permissions to roles", "scope_type": "global", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "permission", "action": "revoke", "description": "Revoke permissions from roles", "scope_type": "global", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "permission", "action": "view", "description": "View available permissions and grants", "scope_type": "global", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

-- ============================================
-- ORG SCOPE PERMISSIONS (32 total)
-- ============================================

-- A4C Role Management (Org) - 5 permissions
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "a4c_role", "action": "assign", "description": "Assign A4C roles to A4C staff users", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "a4c_role", "action": "create", "description": "Create roles within A4C organization", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "a4c_role", "action": "delete", "description": "Delete A4C internal roles", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "a4c_role", "action": "update", "description": "Modify A4C internal roles", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "a4c_role", "action": "view", "description": "View A4C internal roles", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

-- Client Management (Org) - 4 permissions
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "client", "action": "create", "description": "Create clients", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "client", "action": "delete", "description": "Delete clients", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "client", "action": "update", "description": "Update clients", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "client", "action": "view", "description": "View clients", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

-- Medication Management (Org) - 4 permissions
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "medication", "action": "administer", "description": "Administer medications", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "medication", "action": "create", "description": "Add medications", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "medication", "action": "prescribe", "description": "Prescribe medications", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "medication", "action": "view", "description": "View medications", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

-- Organization Management (Org-scoped) - 7 permissions
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "organization", "action": "business_profile_create", "description": "Create business profile for organization", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "organization", "action": "business_profile_update", "description": "Update business profile for organization", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "organization", "action": "create_ou", "description": "Create organizational units (departments, locations, campuses) within hierarchy", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "organization", "action": "create_sub", "description": "Create sub-organizations within organizational hierarchy", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "organization", "action": "update", "description": "Update organizations", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "organization", "action": "view", "description": "View organization details", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "organization", "action": "view_ou", "description": "View organizational units (departments, locations, campuses)", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

-- Role Management (Org) - 6 permissions
-- NOTE: role.create is ORG-scoped (bug fix from incorrect global)
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "role", "action": "create", "description": "Create new roles within organization", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions - BUG FIX: role.create scope_type changed from global to org"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "role", "action": "assign", "description": "Assign roles", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "role", "action": "delete", "description": "Delete role (soft delete, removes from all users)", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "role", "action": "grant", "description": "Assign roles to users", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "role", "action": "update", "description": "Modify role details and description", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "role", "action": "view", "description": "View roles", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

-- User Management (Org) - 6 permissions
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "user", "action": "create", "description": "Create users", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "user", "action": "delete", "description": "Delete users", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "user", "action": "role_assign", "description": "Assign roles to users", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "user", "action": "role_revoke", "description": "Revoke roles from users", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "user", "action": "update", "description": "Update users", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  gen_random_uuid(), 'permission', 1, 'permission.defined',
  '{"applet": "user", "action": "view", "description": "View users", "scope_type": "org", "requires_mfa": false}'::jsonb,
  '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Migration: Regenerate permissions from authoritative seed"}'::jsonb
);

-- ============================================
-- VERIFICATION
-- ============================================
-- After migration, verify:
-- 1. SELECT COUNT(*) FROM permissions_projection; -- Should be 42
-- 2. SELECT COUNT(*) FROM domain_events WHERE event_type = 'permission.defined'; -- Should be 42
-- 3. SELECT applet, action, scope_type FROM permissions_projection WHERE applet = 'role' AND action = 'create';
--    -- Should show scope_type = 'org' (not 'global')
-- 4. All permission IDs should match their corresponding event stream_ids
