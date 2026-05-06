-- =====================================================================
-- Add cross-aggregate permission implications for role management
-- =====================================================================
--
-- Closes a structural gap in the permission-implication graph: roles
-- granting role-management permissions did not automatically inherit
-- `organization.view_ou` (or `user.view` for revoke), even though the
-- frontend role-management UI structurally depends on OU visibility
-- (`RolesManagePage.tsx:125` derives `rootScopePath = ouNodes[0].path`
-- and passes it as `p_scope_path` to `api.list_users_for_role_management`).
--
-- Surfaced 2026-05-06 by `lars.tice+test@gmail.com` (custom role
-- "South Valley Admin", granted full `role.*` + `user.*` perm set
-- but no `organization.view_ou`). Symptom cascade:
--   1. `api.get_organization_units` raised 42501 → empty `ouNodes`
--   2. `rootScopePath = ''` (empty ltree) → assignment dialog passed
--      empty scope to `api.list_users_for_role_management`
--   3. Backend `v_user_scope @> ''::ltree` = FALSE → 42501 again
--
-- Existing implications already encode the same pattern at half-strength:
--   organization.{create,update,delete,deactivate,reactivate}_ou → organization.view_ou
--   role.{create,update,delete}                                  → role.view
--   user.role_assign                                             → user.view
--
-- This migration adds the missing cross-aggregate cluster:
--   role.create        → organization.view_ou
--   role.update        → organization.view_ou
--   role.delete        → organization.view_ou
--   user.role_assign   → organization.view_ou
--   user.role_revoke   → organization.view_ou
--   user.role_revoke   → user.view  (closes pre-existing symmetry gap with user.role_assign)
--
-- Architectural notes (per software-architect-dbc review, 2026-05-06):
--
--   1. `permission_implications` is CONFIGURATION DATA, NOT event-sourced
--      (per seed file header line 8). No `permission.implication_added`
--      event type exists. Plain INSERT ... ON CONFLICT DO NOTHING is the
--      correct pattern, mirroring `sql/99-seeds/003-permission-implications-seed.sql`.
--
--   2. RLS policy `permission_implications_modify` (baseline_v4:15532)
--      restricts runtime mutations to `user_role = 'super_admin'`.
--      This migration runs as `postgres` (RLS bypass at deploy time).
--      Future runtime mutations would require super_admin context.
--
--   3. JWT-refresh required for live sessions to pick up new implications.
--      The `effective_permissions` claim is computed in
--      `auth.custom_access_token_hook` and baked into the JWT at
--      login/refresh. Affected users will not see the new derivations
--      until they logout/login or their token expires (~1 hour).
--      Implication grants are additive and not security-critical —
--      NO force-logout broadcast is needed.
--
--   4. Scope propagation: `compute_effective_permissions` (baseline_v4:6970)
--      inherits `we.scope_path` verbatim from the source permission to
--      the derived permission, and picks the widest scope (shortest
--      ltree, baseline_v4:6981) per perm name. So a holder of
--      `role.create` at scope `testorg-20260329` automatically gets
--      `organization.view_ou` at scope `testorg-20260329` (matches the
--      caller's mental model — same scope as the source grant).
--
--   5. `provider_admin` already holds `organization.view_ou` directly
--      (per `sql/99-seeds/002-role-permission-templates-seed.sql:137`).
--      After this migration: `compute_effective_permissions` widest-scope
--      rule means the explicit grant continues to win → NO functional
--      change for provider_admin or super_admin.
--
--   6. Deliberately NOT added: `role.view → organization.view_ou`.
--      Argument against: widens read implications across the codebase;
--      every role-viewer would automatically see every OU in tenant.
--      UI degrades gracefully on raw ltree paths. View permissions
--      should be granted explicitly.
--
--   7. Forward-looking note for sub-tenant-admin work
--      (`dev/active/sub-tenant-admin-design/`): when role assignments
--      eventually live at narrower scopes (e.g., a "South Valley
--      Admin" assigned at `testorg.south_valley` instead of tenant
--      root), `compute_effective_permissions`'s `we.scope_path`
--      inheritance (baseline_v4:6970) propagates the narrower scope to
--      the derived permissions added here. So a holder of
--      `role.create` at `testorg.south_valley` will get
--      `organization.view_ou` at `testorg.south_valley` (NOT tenant
--      root). The new edges automatically benefit from this property —
--      no change required to this migration when sub-tenant admin
--      semantics arrive.
--
-- See:
--   - documentation/architecture/decisions/adr-rpc-readback-pattern.md (no new RPC; not applicable)
--   - infrastructure/supabase/CLAUDE.md § Critical Rules (CQRS distinction:
--     config tables vs projection tables)
--   - dev/active/sub-tenant-admin-design/ (separate, deferred concern;
--     this migration does NOT change scope semantics for role assignment,
--     only completes the implication graph for view permissions)
-- =====================================================================

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
-- (RolesManagePage assignment dialog derives rootScopePath from OU tree)
INSERT INTO permission_implications (permission_id, implies_permission_id)
SELECT p1.id, p2.id
FROM permissions_projection p1, permissions_projection p2
WHERE p1.name = 'user.role_assign' AND p2.name = 'organization.view_ou'
ON CONFLICT DO NOTHING;

-- user.role_revoke → organization.view_ou
-- (Symmetric with user.role_assign — same UI surface, same rootScopePath dependency)
INSERT INTO permission_implications (permission_id, implies_permission_id)
SELECT p1.id, p2.id
FROM permissions_projection p1, permissions_projection p2
WHERE p1.name = 'user.role_revoke' AND p2.name = 'organization.view_ou'
ON CONFLICT DO NOTHING;

-- user.role_revoke → user.view
-- (Closes pre-existing symmetry gap with user.role_assign → user.view.
--  Must be able to see users to revoke roles from them.)
INSERT INTO permission_implications (permission_id, implies_permission_id)
SELECT p1.id, p2.id
FROM permissions_projection p1, permissions_projection p2
WHERE p1.name = 'user.role_revoke' AND p2.name = 'user.view'
ON CONFLICT DO NOTHING;

-- =====================================================================
-- Postcondition assertion (per architect review P2-A, 2026-05-06)
-- =====================================================================
-- The per-edge `INSERT ... SELECT FROM permissions_projection WHERE
-- name = '<literal>'` pattern silently produces zero rows if a
-- permission is ever renamed without updating this migration. The
-- pattern is also used 4× in `sql/99-seeds/003-permission-implications-seed.sql`
-- with the same latent risk. Make the postcondition explicit:
DO $$
DECLARE
  v_actual integer;
BEGIN
  SELECT COUNT(*) INTO v_actual
  FROM permission_implications pi
  JOIN permissions_projection p1 ON p1.id = pi.permission_id
  JOIN permissions_projection p2 ON p2.id = pi.implies_permission_id
  WHERE (p1.name, p2.name) IN (
    ('role.create',      'organization.view_ou'),
    ('role.update',      'organization.view_ou'),
    ('role.delete',      'organization.view_ou'),
    ('user.role_assign', 'organization.view_ou'),
    ('user.role_revoke', 'organization.view_ou'),
    ('user.role_revoke', 'user.view')
  );
  IF v_actual <> 6 THEN
    RAISE EXCEPTION
      'Postcondition violated: expected 6 implication rows, found %. '
      'Likely cause: a source or target permission name was renamed '
      'without updating this migration.', v_actual;
  END IF;
END $$;
