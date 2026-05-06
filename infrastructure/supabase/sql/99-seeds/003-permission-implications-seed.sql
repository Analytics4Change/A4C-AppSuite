-- ============================================
-- PERMISSION IMPLICATIONS SEED FILE
-- ============================================
-- This file populates the permission_implications configuration table.
-- Permission implications define automatic entailment: if a user has
-- permission A, they effectively also have permission B at the same scope.
--
-- IMPORTANT: This is configuration data, NOT event-sourced.
-- Must run AFTER 001-permissions-seed.sql (depends on permissions_projection).
--
-- Total: 28 implication rules
--
-- Last Updated: 2026-05-06
-- Changes:
--   - 2026-05-06: Added 6 cross-aggregate role-management → OU read implications
--                 (role.{create,update,delete} → organization.view_ou;
--                  user.role_{assign,revoke} → organization.view_ou;
--                  user.role_revoke → user.view).
--                 Mirror of migration 20260506190626. Closes structural gap
--                 surfaced by lars.tice+test UAT 2026-05-06; architect-reviewed
--                 (software-architect-dbc) F3 + P2-B.
--   - 2026-02-12: Extracted from archived migration 20260122204647 during Day 0 v4 baseline
--   - 2026-02-02: Added user.schedule_manage → user.view, user.client_assign → user.view
--   - 2026-01-22: Initial creation (Multi-Role Authorization Phase 2A)
-- ============================================

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
-- Cross-Aggregate Role-Management → OU Read Implications
-- (Added 2026-05-06 — mirror of migration 20260506190626)
-- Role-management UI structurally depends on OU visibility
-- (RolesManagePage.tsx derives rootScopePath from the OU tree). These
-- edges close the cross-aggregate gap so any custom role granting
-- role-management permissions automatically inherits OU read at the
-- same scope. Deliberately excludes `role.view → organization.view_ou`
-- to avoid widening read implications across the codebase.
-- =============================================================================

-- role.create → organization.view_ou
-- (Create-role form requires OU selector for org_hierarchy_scope)
INSERT INTO permission_implications (permission_id, implies_permission_id)
SELECT p1.id, p2.id
FROM permissions_projection p1, permissions_projection p2
WHERE p1.name = 'role.create' AND p2.name = 'organization.view_ou'
ON CONFLICT DO NOTHING;

-- role.update → organization.view_ou
-- (Edit-role form may show or change OU scope)
INSERT INTO permission_implications (permission_id, implies_permission_id)
SELECT p1.id, p2.id
FROM permissions_projection p1, permissions_projection p2
WHERE p1.name = 'role.update' AND p2.name = 'organization.view_ou'
ON CONFLICT DO NOTHING;

-- role.delete → organization.view_ou
-- (Delete-confirmation surfaces role's org_hierarchy_scope; symmetric
--  with the existing _ou-mutator-implies-view_ou pattern)
INSERT INTO permission_implications (permission_id, implies_permission_id)
SELECT p1.id, p2.id
FROM permissions_projection p1, permissions_projection p2
WHERE p1.name = 'role.delete' AND p2.name = 'organization.view_ou'
ON CONFLICT DO NOTHING;

-- user.role_assign → organization.view_ou
-- (Role-assignment dialog derives rootScopePath from OU tree)
INSERT INTO permission_implications (permission_id, implies_permission_id)
SELECT p1.id, p2.id
FROM permissions_projection p1, permissions_projection p2
WHERE p1.name = 'user.role_assign' AND p2.name = 'organization.view_ou'
ON CONFLICT DO NOTHING;

-- user.role_revoke → organization.view_ou
-- (Symmetric with user.role_assign — same UI surface, same dependency)
INSERT INTO permission_implications (permission_id, implies_permission_id)
SELECT p1.id, p2.id
FROM permissions_projection p1, permissions_projection p2
WHERE p1.name = 'user.role_revoke' AND p2.name = 'organization.view_ou'
ON CONFLICT DO NOTHING;

-- user.role_revoke → user.view
-- (Closes pre-existing symmetry gap with user.role_assign → user.view;
--  must be able to see users to revoke roles from them)
INSERT INTO permission_implications (permission_id, implies_permission_id)
SELECT p1.id, p2.id
FROM permissions_projection p1, permissions_projection p2
WHERE p1.name = 'user.role_revoke' AND p2.name = 'user.view'
ON CONFLICT DO NOTHING;
