-- User Roles Projection Table
-- This is a CQRS projection maintained by event processors
-- Source of truth: user.role.assigned/revoked events in domain_events table

CREATE TABLE IF NOT EXISTS user_roles_projection (
  user_id UUID NOT NULL,
  role_id UUID NOT NULL,
  organization_id UUID,  -- NULL for super_admin global access, UUID for org-scoped roles
  scope_path LTREE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique constraint with NULLS NOT DISTINCT (PostgreSQL 15+)
  -- Treats NULL as a distinct value, so (user, role, NULL) can only exist once
  -- This allows super_admin (org_id = NULL) to be assigned uniquely per user
  UNIQUE NULLS NOT DISTINCT (user_id, role_id, organization_id),

  -- Constraint: global access (NULL org) requires NULL scope_path
  CHECK (
    (organization_id IS NULL AND scope_path IS NULL)
    OR
    (organization_id IS NOT NULL AND scope_path IS NOT NULL)
  )
);

-- Indexes for permission lookups
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles_projection(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles_projection(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_org ON user_roles_projection(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_roles_scope_path ON user_roles_projection USING GIST(scope_path) WHERE scope_path IS NOT NULL;

-- Composite index for common authorization query pattern
CREATE INDEX IF NOT EXISTS idx_user_roles_auth_lookup ON user_roles_projection(user_id, organization_id);

-- Comments
COMMENT ON TABLE user_roles_projection IS 'Projection of user.role.* events - assigns roles to users with org scoping';
COMMENT ON COLUMN user_roles_projection.organization_id IS 'Organization UUID (NULL for super_admin global access, specific UUID for scoped roles)';
COMMENT ON COLUMN user_roles_projection.scope_path IS 'ltree hierarchy path for granular scoping (NULL for global access)';
COMMENT ON COLUMN user_roles_projection.assigned_at IS 'Timestamp when role was assigned to user';
