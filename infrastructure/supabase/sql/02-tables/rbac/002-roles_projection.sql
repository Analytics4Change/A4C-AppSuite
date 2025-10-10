-- Roles Projection Table
-- This is a CQRS projection maintained by event processors
-- Source of truth: role.created events in domain_events table

CREATE TABLE IF NOT EXISTS roles_projection (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  zitadel_org_id TEXT,
  org_hierarchy_scope LTREE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraint: super_admin has NULL org scoping, all others must have org scope
  CHECK (
    (name = 'super_admin' AND zitadel_org_id IS NULL AND org_hierarchy_scope IS NULL)
    OR
    (name != 'super_admin' AND zitadel_org_id IS NOT NULL AND org_hierarchy_scope IS NOT NULL)
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_roles_name ON roles_projection(name);
CREATE INDEX IF NOT EXISTS idx_roles_zitadel_org ON roles_projection(zitadel_org_id);
CREATE INDEX IF NOT EXISTS idx_roles_hierarchy_scope ON roles_projection USING GIST(org_hierarchy_scope) WHERE org_hierarchy_scope IS NOT NULL;

-- Comments
COMMENT ON TABLE roles_projection IS 'Projection of role.created events - defines collections of permissions';
COMMENT ON COLUMN roles_projection.zitadel_org_id IS 'Zitadel organization ID (NULL for super_admin with global scope)';
COMMENT ON COLUMN roles_projection.org_hierarchy_scope IS 'ltree path for hierarchical scoping (NULL for super_admin)';
COMMENT ON CONSTRAINT roles_projection_check IS 'Ensures super_admin has global scope, all others have org scope';
