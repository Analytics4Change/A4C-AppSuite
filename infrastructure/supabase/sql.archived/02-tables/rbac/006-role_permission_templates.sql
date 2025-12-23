-- Role Permission Templates
-- Defines canonical permissions for each role type
-- Used during org bootstrap to grant permissions to new roles
--
-- This is NOT a CQRS projection - it's a configuration table that
-- platform owners can modify to control which permissions are
-- granted to specific role types during organization bootstrap.

CREATE TABLE IF NOT EXISTS role_permission_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Role identification
  role_name TEXT NOT NULL,  -- 'provider_admin', 'partner_admin', 'clinician', 'viewer'

  -- Permission reference
  permission_name TEXT NOT NULL,  -- 'organization.view_ou', 'client.create', etc.

  -- Metadata
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,  -- Platform owner who added this

  -- Constraints
  CONSTRAINT role_permission_templates_unique UNIQUE (role_name, permission_name)
);

-- Indexes for fast lookup during org bootstrap
CREATE INDEX IF NOT EXISTS idx_role_permission_templates_role
  ON role_permission_templates(role_name) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_role_permission_templates_active
  ON role_permission_templates(is_active) WHERE is_active = TRUE;

-- RLS (platform owners only can write, anyone can read)
ALTER TABLE role_permission_templates ENABLE ROW LEVEL SECURITY;

-- Anyone can read templates (needed for Temporal workers with service role)
DROP POLICY IF EXISTS role_permission_templates_read ON role_permission_templates;
CREATE POLICY role_permission_templates_read ON role_permission_templates
  FOR SELECT USING (TRUE);

-- Only super_admin can modify templates
DROP POLICY IF EXISTS role_permission_templates_write ON role_permission_templates;
CREATE POLICY role_permission_templates_write ON role_permission_templates
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles_projection ur
      JOIN roles_projection r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND r.name = 'super_admin'
    )
  );

-- Comments
COMMENT ON TABLE role_permission_templates IS 'Canonical permission templates for role types. Used during org bootstrap to grant permissions to new provider_admin/partner_admin roles.';
COMMENT ON COLUMN role_permission_templates.role_name IS 'Role type name (provider_admin, partner_admin, clinician, viewer)';
COMMENT ON COLUMN role_permission_templates.permission_name IS 'Permission identifier in format: applet.action (e.g., organization.view_ou)';
COMMENT ON COLUMN role_permission_templates.is_active IS 'Soft delete flag - FALSE removes permission from future bootstraps without affecting existing grants';
COMMENT ON COLUMN role_permission_templates.created_by IS 'Platform owner (super_admin) who added this template entry';
