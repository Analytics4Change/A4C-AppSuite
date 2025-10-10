-- User Roles Projection Table
-- This is a CQRS projection maintained by event processors
-- Source of truth: user.role.assigned/revoked events in domain_events table

CREATE TABLE IF NOT EXISTS user_roles_projection (
  user_id UUID NOT NULL,
  role_id UUID NOT NULL REFERENCES roles_projection(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  scope_path LTREE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, role_id, org_id),

  -- Constraint: wildcard org_id requires wildcard scope_path
  CHECK (
    (org_id = '*' AND scope_path IS NULL)
    OR
    (org_id != '*' AND scope_path IS NOT NULL)
  )
);

-- Indexes for permission lookups
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles_projection(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles_projection(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_org ON user_roles_projection(org_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_scope_path ON user_roles_projection USING GIST(scope_path) WHERE scope_path IS NOT NULL;

-- Composite index for common authorization query pattern
CREATE INDEX IF NOT EXISTS idx_user_roles_auth_lookup ON user_roles_projection(user_id, org_id);

-- Comments
COMMENT ON TABLE user_roles_projection IS 'Projection of user.role.* events - assigns roles to users with org scoping';
COMMENT ON COLUMN user_roles_projection.org_id IS 'Organization ID (* for super_admin global access, specific org ID for scoped roles)';
COMMENT ON COLUMN user_roles_projection.scope_path IS 'ltree hierarchy path for granular scoping (NULL for global access)';
COMMENT ON COLUMN user_roles_projection.assigned_at IS 'Timestamp when role was assigned to user';
