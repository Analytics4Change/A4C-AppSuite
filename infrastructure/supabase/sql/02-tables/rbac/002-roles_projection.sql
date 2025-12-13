-- Roles Projection Table
-- This is a CQRS projection maintained by event processors
-- Source of truth: role.created events in domain_events table

CREATE TABLE IF NOT EXISTS roles_projection (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,  -- NOT globally unique - see composite constraint below
  description TEXT NOT NULL,
  organization_id UUID,  -- Internal UUID for JOINs (NULL for super_admin global scope)
  org_hierarchy_scope LTREE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true
);

-- Remove deprecated zitadel_org_id column if it exists
ALTER TABLE roles_projection DROP COLUMN IF EXISTS zitadel_org_id;

-- Remove old global unique constraint on name (if exists)
-- Role names should be unique per organization, not globally
ALTER TABLE roles_projection DROP CONSTRAINT IF EXISTS roles_projection_name_key;

-- Add composite unique constraint: role name unique per organization
-- Note: super_admin (org_id=NULL) is globally unique because PostgreSQL treats each NULL as unique
ALTER TABLE roles_projection DROP CONSTRAINT IF EXISTS roles_projection_name_org_unique;
ALTER TABLE roles_projection ADD CONSTRAINT roles_projection_name_org_unique
  UNIQUE (name, organization_id);

-- Update constraint: only super_admin is a system role with NULL org scope
-- All other roles (including provider_admin, partner_admin, clinician, viewer) MUST have organization_id
ALTER TABLE roles_projection DROP CONSTRAINT IF EXISTS roles_projection_scope_check;
ALTER TABLE roles_projection ADD CONSTRAINT roles_projection_scope_check CHECK (
  (name = 'super_admin' AND organization_id IS NULL AND org_hierarchy_scope IS NULL)
  OR
  (name <> 'super_admin' AND organization_id IS NOT NULL AND org_hierarchy_scope IS NOT NULL)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_roles_name ON roles_projection(name);
CREATE INDEX IF NOT EXISTS idx_roles_organization_id ON roles_projection(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_roles_hierarchy_scope ON roles_projection USING GIST(org_hierarchy_scope) WHERE org_hierarchy_scope IS NOT NULL;

-- Comments
COMMENT ON TABLE roles_projection IS 'Projection of role.created events - defines collections of permissions';
COMMENT ON COLUMN roles_projection.organization_id IS 'Internal organization UUID for JOINs (NULL for super_admin with global scope)';
COMMENT ON COLUMN roles_projection.org_hierarchy_scope IS 'ltree path for hierarchical scoping (NULL for super_admin)';
COMMENT ON CONSTRAINT roles_projection_scope_check ON roles_projection IS 'Ensures only super_admin (system role) has NULL org scope. All other roles (provider_admin, partner_admin, clinician, viewer) MUST have organization_id';
