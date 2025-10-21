-- Role Permissions Projection Table
-- This is a CQRS projection maintained by event processors
-- Source of truth: role.permission.granted/revoked events in domain_events table

CREATE TABLE IF NOT EXISTS role_permissions_projection (
  role_id UUID NOT NULL,
  permission_id UUID NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (role_id, permission_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions_projection(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions_projection(permission_id);

-- Comments
COMMENT ON TABLE role_permissions_projection IS 'Projection of role.permission.* events - maps permissions to roles';
COMMENT ON COLUMN role_permissions_projection.granted_at IS 'Timestamp when permission was granted to role';
