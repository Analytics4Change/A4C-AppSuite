-- ==============================================================================
-- Service Role Projection Access Policies
-- ==============================================================================
--
-- Purpose: Grant service_role SELECT access to projection tables
--
-- Context: Temporal workers use the Supabase service_role key. When api.*
-- functions use SECURITY INVOKER (per architect review), they run with the
-- caller's permissions. Without these policies, service_role cannot read
-- projection tables.
--
-- Pattern: Same pattern as workflow_queue_projection (the only projection
-- table that previously had service_role access).
--
-- Reference: documentation/retrospectives/2025-11-temporal-worker-migration.md
-- Section: "Service Account RLS Pattern"
--
-- Tables covered:
--   - organizations_projection
--   - roles_projection
--   - role_permissions_projection
--   - permissions_projection
--   - contacts_projection
--   - addresses_projection
--   - phones_projection
--   - invitations_projection
--   - role_permission_templates (configuration table, not projection)
--
-- Note: These are SELECT-only policies. Temporal workers emit events for
-- state changes; they do not write to projections directly.
-- ==============================================================================

-- ==============================================================================
-- Base Table Privileges
-- ==============================================================================
-- PostgreSQL requires GRANT for table access, independent of RLS.
-- RLS policies control which rows; GRANT controls table-level access.
-- ==============================================================================
GRANT SELECT ON organizations_projection TO service_role;
GRANT SELECT ON roles_projection TO service_role;
GRANT SELECT ON role_permissions_projection TO service_role;
GRANT SELECT ON permissions_projection TO service_role;
GRANT SELECT ON contacts_projection TO service_role;
GRANT SELECT ON addresses_projection TO service_role;
GRANT SELECT ON phones_projection TO service_role;
GRANT SELECT ON invitations_projection TO service_role;
GRANT SELECT ON role_permission_templates TO service_role;

-- ==============================================================================
-- RLS Policies
-- ==============================================================================

-- organizations_projection
DROP POLICY IF EXISTS organizations_projection_service_role_select ON organizations_projection;
CREATE POLICY organizations_projection_service_role_select ON organizations_projection
  FOR SELECT TO service_role
  USING (TRUE);

-- roles_projection
DROP POLICY IF EXISTS roles_projection_service_role_select ON roles_projection;
CREATE POLICY roles_projection_service_role_select ON roles_projection
  FOR SELECT TO service_role
  USING (TRUE);

-- role_permissions_projection
DROP POLICY IF EXISTS role_permissions_projection_service_role_select ON role_permissions_projection;
CREATE POLICY role_permissions_projection_service_role_select ON role_permissions_projection
  FOR SELECT TO service_role
  USING (TRUE);

-- permissions_projection
DROP POLICY IF EXISTS permissions_projection_service_role_select ON permissions_projection;
CREATE POLICY permissions_projection_service_role_select ON permissions_projection
  FOR SELECT TO service_role
  USING (TRUE);

-- contacts_projection
DROP POLICY IF EXISTS contacts_projection_service_role_select ON contacts_projection;
CREATE POLICY contacts_projection_service_role_select ON contacts_projection
  FOR SELECT TO service_role
  USING (TRUE);

-- addresses_projection
DROP POLICY IF EXISTS addresses_projection_service_role_select ON addresses_projection;
CREATE POLICY addresses_projection_service_role_select ON addresses_projection
  FOR SELECT TO service_role
  USING (TRUE);

-- phones_projection
DROP POLICY IF EXISTS phones_projection_service_role_select ON phones_projection;
CREATE POLICY phones_projection_service_role_select ON phones_projection
  FOR SELECT TO service_role
  USING (TRUE);

-- invitations_projection
DROP POLICY IF EXISTS invitations_projection_service_role_select ON invitations_projection;
CREATE POLICY invitations_projection_service_role_select ON invitations_projection
  FOR SELECT TO service_role
  USING (TRUE);

-- role_permission_templates (configuration table)
-- Already has USING (TRUE) for all SELECTs, but explicitly grant to service_role
DROP POLICY IF EXISTS role_permission_templates_service_role_select ON role_permission_templates;
CREATE POLICY role_permission_templates_service_role_select ON role_permission_templates
  FOR SELECT TO service_role
  USING (TRUE);

-- ==============================================================================
-- Comments
-- ==============================================================================
COMMENT ON POLICY organizations_projection_service_role_select ON organizations_projection IS
  'Allows Temporal workers (service_role) to read organization data for workflow activities';

COMMENT ON POLICY roles_projection_service_role_select ON roles_projection IS
  'Allows Temporal workers (service_role) to read role data for RBAC lookups';

COMMENT ON POLICY role_permissions_projection_service_role_select ON role_permissions_projection IS
  'Allows Temporal workers (service_role) to read role-permission mappings';

COMMENT ON POLICY permissions_projection_service_role_select ON permissions_projection IS
  'Allows Temporal workers (service_role) to read permission definitions';

COMMENT ON POLICY contacts_projection_service_role_select ON contacts_projection IS
  'Allows Temporal workers (service_role) to read contact data for cleanup activities';

COMMENT ON POLICY addresses_projection_service_role_select ON addresses_projection IS
  'Allows Temporal workers (service_role) to read address data for cleanup activities';

COMMENT ON POLICY phones_projection_service_role_select ON phones_projection IS
  'Allows Temporal workers (service_role) to read phone data for cleanup activities';

COMMENT ON POLICY invitations_projection_service_role_select ON invitations_projection IS
  'Allows Temporal workers (service_role) to read invitation data for email activities';

COMMENT ON POLICY role_permission_templates_service_role_select ON role_permission_templates IS
  'Allows Temporal workers (service_role) to read permission templates for role bootstrap';
