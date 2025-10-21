-- Roles Projection Table
-- This is a CQRS projection maintained by event processors
-- Source of truth: role.created events in domain_events table

CREATE TABLE IF NOT EXISTS roles_projection (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  organization_id UUID,  -- Internal UUID for JOINs (NULL for super_admin global scope)
  zitadel_org_id TEXT,  -- External Zitadel org ID (for Zitadel API lookups)
  org_hierarchy_scope LTREE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,

  -- Constraint: super_admin has NULL org scoping, all others must have org scope
  CONSTRAINT roles_projection_scope_check CHECK (
    (name = 'super_admin' AND organization_id IS NULL AND zitadel_org_id IS NULL AND org_hierarchy_scope IS NULL)
    OR
    (name != 'super_admin' AND organization_id IS NOT NULL AND zitadel_org_id IS NOT NULL AND org_hierarchy_scope IS NOT NULL)
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_roles_name ON roles_projection(name);
CREATE INDEX IF NOT EXISTS idx_roles_organization_id ON roles_projection(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_roles_zitadel_org ON roles_projection(zitadel_org_id) WHERE zitadel_org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_roles_hierarchy_scope ON roles_projection USING GIST(org_hierarchy_scope) WHERE org_hierarchy_scope IS NOT NULL;

-- Comments
COMMENT ON TABLE roles_projection IS 'Projection of role.created events - defines collections of permissions';
COMMENT ON COLUMN roles_projection.organization_id IS 'Internal organization UUID for JOINs (NULL for super_admin with global scope)';
COMMENT ON COLUMN roles_projection.zitadel_org_id IS 'External Zitadel organization ID for API lookups (NULL for super_admin)';
COMMENT ON COLUMN roles_projection.org_hierarchy_scope IS 'ltree path for hierarchical scoping (NULL for super_admin)';
COMMENT ON CONSTRAINT roles_projection_scope_check ON roles_projection IS 'Ensures super_admin has global scope, all others have org scope';
