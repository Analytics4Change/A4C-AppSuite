-- Organization Units Projection Table
-- CQRS projection maintained by organization_unit event processors
-- Source of truth: organization_unit.* events in domain_events table
--
-- NOTE: This table stores organization units (nlevel > 1) separately from
-- organizations_projection which stores root organizations (nlevel = 1).
-- Different access patterns by actor type:
--   - Platform owners query organizations_projection (root orgs)
--   - Providers query organization_units_projection (their internal hierarchy)

CREATE TABLE IF NOT EXISTS organization_units_projection (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations_projection(id),
  name TEXT NOT NULL,
  display_name TEXT,
  slug TEXT NOT NULL,

  -- Full ltree paths (preserves scope_path containment for RLS)
  -- Path example: 'root.org_acme.north_campus.pediatrics'
  path LTREE NOT NULL UNIQUE,
  parent_path LTREE NOT NULL,
  depth INTEGER GENERATED ALWAYS AS (nlevel(path)) STORED,

  -- Configuration
  timezone TEXT DEFAULT 'America/New_York',

  -- Lifecycle management
  is_active BOOLEAN DEFAULT true,
  deactivated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints ensuring data integrity
  -- 1. Must be sub-organization (depth > 1, since root orgs are depth 1)
  CONSTRAINT valid_ou_depth CHECK (nlevel(path) > 1),

  -- 2. Slug must be ltree-safe (PG15 compatible - no hyphens)
  CONSTRAINT valid_slug CHECK (slug ~ '^[a-z0-9_]+$'),

  -- 3. Path must end with the slug
  CONSTRAINT path_ends_with_slug CHECK (subpath(path, nlevel(path) - 1, 1)::TEXT = slug),

  -- 4. Parent path must be a proper ancestor (direct parent)
  CONSTRAINT valid_parent_path CHECK (
    parent_path IS NOT NULL
    AND path <@ parent_path
    AND nlevel(path) = nlevel(parent_path) + 1
  )
);

-- Performance indexes for hierarchy queries
CREATE INDEX IF NOT EXISTS idx_ou_path_gist ON organization_units_projection USING GIST (path);
CREATE INDEX IF NOT EXISTS idx_ou_path_btree ON organization_units_projection USING BTREE (path);
CREATE INDEX IF NOT EXISTS idx_ou_parent_path_gist ON organization_units_projection USING GIST (parent_path);
CREATE INDEX IF NOT EXISTS idx_ou_parent_path_btree ON organization_units_projection USING BTREE (parent_path);

-- Index on organization_id for FK lookups and org-scoped queries
CREATE INDEX IF NOT EXISTS idx_ou_organization_id ON organization_units_projection(organization_id);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ou_active ON organization_units_projection(is_active)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_ou_deleted ON organization_units_projection(deleted_at)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ou_slug ON organization_units_projection(slug);

-- Comments for documentation
COMMENT ON TABLE organization_units_projection IS 'CQRS projection of organization_unit.* events - maintains sub-organization hierarchy (depth > 2)';
COMMENT ON COLUMN organization_units_projection.organization_id IS 'FK to root organization (provider) this unit belongs to';
COMMENT ON COLUMN organization_units_projection.path IS 'Full ltree hierarchical path (e.g., root.org_acme_healthcare.north_campus.pediatrics)';
COMMENT ON COLUMN organization_units_projection.parent_path IS 'Direct parent ltree path (e.g., root.org_acme_healthcare.north_campus)';
COMMENT ON COLUMN organization_units_projection.depth IS 'Computed depth in hierarchy (always > 2 for OUs)';
COMMENT ON COLUMN organization_units_projection.slug IS 'ltree-safe identifier (a-z, 0-9, underscore only for PG15 compatibility)';
COMMENT ON COLUMN organization_units_projection.is_active IS 'OU active status - when false, role assignments to this OU and descendants are blocked';
COMMENT ON COLUMN organization_units_projection.deleted_at IS 'Soft deletion timestamp (OUs are never physically deleted)';

-- Grant SELECT to authenticated users (RLS will enforce access)
GRANT SELECT ON organization_units_projection TO authenticated;
