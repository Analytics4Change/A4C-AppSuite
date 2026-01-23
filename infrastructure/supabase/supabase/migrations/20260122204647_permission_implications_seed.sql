-- =============================================================================
-- Migration: Permission Implications Seed Data
-- Purpose: Populate standard CRUD and domain-specific permission implications
-- Part of: Multi-Role Authorization Phase 2A
-- =============================================================================

-- =============================================================================
-- Standard CRUD Implications
-- Pattern: create/update/delete → view (same applet)
-- =============================================================================

INSERT INTO permission_implications (permission_id, implies_permission_id)
SELECT p1.id, p2.id
FROM permissions_projection p1
CROSS JOIN permissions_projection p2
WHERE p1.applet = p2.applet
  AND p2.action = 'view'
  AND p1.action IN ('create', 'update', 'delete')
  AND p1.id != p2.id
ON CONFLICT DO NOTHING;

-- =============================================================================
-- OU-Specific Implications
-- Pattern: *_ou actions → view_ou (same applet)
-- =============================================================================

INSERT INTO permission_implications (permission_id, implies_permission_id)
SELECT p1.id, p2.id
FROM permissions_projection p1
CROSS JOIN permissions_projection p2
WHERE p1.applet = p2.applet
  AND p2.action = 'view_ou'
  AND p1.action IN ('create_ou', 'update_ou', 'delete_ou', 'deactivate_ou', 'reactivate_ou')
  AND p1.id != p2.id
ON CONFLICT DO NOTHING;

-- =============================================================================
-- Domain-Specific Implications
-- =============================================================================

-- medication.administer → medication.view
-- (You must be able to see medications to administer them)
INSERT INTO permission_implications (permission_id, implies_permission_id)
SELECT p1.id, p2.id
FROM permissions_projection p1, permissions_projection p2
WHERE p1.name = 'medication.administer' AND p2.name = 'medication.view'
ON CONFLICT DO NOTHING;

-- user.role_assign → user.view
-- (You must be able to see users to assign roles to them)
INSERT INTO permission_implications (permission_id, implies_permission_id)
SELECT p1.id, p2.id
FROM permissions_projection p1, permissions_projection p2
WHERE p1.name = 'user.role_assign' AND p2.name = 'user.view'
ON CONFLICT DO NOTHING;

-- user.schedule_manage → user.view
-- (You must be able to see users to manage their schedules)
INSERT INTO permission_implications (permission_id, implies_permission_id)
SELECT p1.id, p2.id
FROM permissions_projection p1, permissions_projection p2
WHERE p1.name = 'user.schedule_manage' AND p2.name = 'user.view'
ON CONFLICT DO NOTHING;

-- user.client_assign → user.view
-- (You must be able to see users to assign clients to them)
INSERT INTO permission_implications (permission_id, implies_permission_id)
SELECT p1.id, p2.id
FROM permissions_projection p1, permissions_projection p2
WHERE p1.name = 'user.client_assign' AND p2.name = 'user.view'
ON CONFLICT DO NOTHING;

-- =============================================================================
-- Documentation
-- =============================================================================

COMMENT ON TABLE permission_implications IS
'Defines permission implication rules. If permission A implies permission B,
then a user with permission A effectively has permission B at the same scope.

Standard patterns seeded:
1. CRUD: create/update/delete → view (same applet)
2. OU: create_ou/update_ou/etc → view_ou (same applet)
3. Domain: medication.administer → medication.view
4. Domain: user.role_assign/schedule_manage/client_assign → user.view

This is configuration data, not event-sourced. Add custom implications via migrations.';
