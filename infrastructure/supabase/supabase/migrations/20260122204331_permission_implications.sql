-- =============================================================================
-- Migration: Permission Implications Table
-- Purpose: Define which permissions imply other permissions (e.g., update → view)
-- Part of: Multi-Role Authorization Phase 2A
-- =============================================================================

-- Permission implications table
-- This is a CONFIGURATION table, not a projection (no event sourcing needed)
-- Implications are system rules defined by developers, not business events
CREATE TABLE IF NOT EXISTS permission_implications (
  permission_id uuid NOT NULL REFERENCES permissions_projection(id) ON DELETE CASCADE,
  implies_permission_id uuid NOT NULL REFERENCES permissions_projection(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (permission_id, implies_permission_id),
  -- A permission cannot imply itself
  CHECK (permission_id != implies_permission_id)
);

-- Index for reverse lookups ("what permissions imply this one?")
CREATE INDEX IF NOT EXISTS idx_permission_implications_implies
ON permission_implications(implies_permission_id);

-- Index for forward lookups ("what does this permission imply?")
CREATE INDEX IF NOT EXISTS idx_permission_implications_permission
ON permission_implications(permission_id);

-- =============================================================================
-- RLS Policies
-- =============================================================================

ALTER TABLE permission_implications ENABLE ROW LEVEL SECURITY;

-- Anyone can read implications (needed for compute_effective_permissions)
DROP POLICY IF EXISTS "permission_implications_select" ON permission_implications;
CREATE POLICY "permission_implications_select" ON permission_implications
FOR SELECT USING (true);

-- Only super_admin can modify (via migrations, not UI)
DROP POLICY IF EXISTS "permission_implications_modify" ON permission_implications;
CREATE POLICY "permission_implications_modify" ON permission_implications
FOR ALL USING (
  (current_setting('request.jwt.claims', true)::jsonb->>'user_role') = 'super_admin'
);

-- =============================================================================
-- Documentation
-- =============================================================================

COMMENT ON TABLE permission_implications IS
'Defines permission implication rules. If permission A implies permission B,
then a user with permission A effectively has permission B at the same scope.
Example: organization.update_ou implies organization.view_ou.
This is configuration data seeded by migrations, not event-sourced.';

COMMENT ON COLUMN permission_implications.permission_id IS
'The permission that grants (implies) another permission';

COMMENT ON COLUMN permission_implications.implies_permission_id IS
'The permission that is implied (granted) by the other permission';
