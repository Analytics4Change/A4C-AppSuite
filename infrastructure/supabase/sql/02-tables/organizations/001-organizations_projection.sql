-- Organizations Projection Table
-- CQRS projection maintained by organization event processors
-- Source of truth: organization.* events in domain_events table
CREATE TABLE IF NOT EXISTS organizations_projection (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT,
  slug TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('platform_owner', 'provider', 'provider_partner')),

  -- Hierarchical structure using ltree
  path LTREE NOT NULL UNIQUE,
  parent_path LTREE,
  depth INTEGER GENERATED ALWAYS AS (nlevel(path)) STORED,

  -- Basic shared fields from creation event
  tax_number TEXT,
  phone_number TEXT,
  timezone TEXT DEFAULT 'America/New_York',
  metadata JSONB DEFAULT '{}',

  -- Lifecycle management
  is_active BOOLEAN DEFAULT true,
  deactivated_at TIMESTAMPTZ,
  deactivation_reason TEXT,
  deleted_at TIMESTAMPTZ,
  deletion_reason TEXT,

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CHECK (
    -- Root organizations (depth 2) have no parent
    (nlevel(path) = 2 AND parent_path IS NULL)
    OR
    -- Sub-organizations (depth > 2) must have parent
    (nlevel(path) > 2 AND parent_path IS NOT NULL)
  )
);

-- Remove deprecated zitadel_org_id column (migration from Zitadel to Supabase Auth)
ALTER TABLE organizations_projection DROP COLUMN IF EXISTS zitadel_org_id;

-- Performance indexes for hierarchy queries
CREATE INDEX IF NOT EXISTS idx_organizations_path_gist ON organizations_projection USING GIST (path);
CREATE INDEX IF NOT EXISTS idx_organizations_path_btree ON organizations_projection USING BTREE (path);
CREATE INDEX IF NOT EXISTS idx_organizations_parent_path ON organizations_projection USING GIST (parent_path) 
  WHERE parent_path IS NOT NULL;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations_projection(type);
CREATE INDEX IF NOT EXISTS idx_organizations_active ON organizations_projection(is_active)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_organizations_deleted ON organizations_projection(deleted_at)
  WHERE deleted_at IS NULL;

-- Drop deprecated zitadel indexes
DROP INDEX IF EXISTS idx_organizations_zitadel_org;
DROP INDEX IF EXISTS idx_organizations_zitadel_org_id;

-- Comments for documentation
COMMENT ON TABLE organizations_projection IS 'CQRS projection of organization.* events - maintains hierarchical organization structure';
COMMENT ON COLUMN organizations_projection.path IS 'ltree hierarchical path (e.g., root.org_acme_healthcare.north_campus)';
COMMENT ON COLUMN organizations_projection.parent_path IS 'Parent organization ltree path (NULL for root organizations)';
COMMENT ON COLUMN organizations_projection.depth IS 'Computed depth in hierarchy (2 = root org, 3+ = sub-organizations)';
COMMENT ON COLUMN organizations_projection.type IS 'Organization type: platform_owner (A4C), provider (healthcare), provider_partner (VARs/families/courts)';
COMMENT ON COLUMN organizations_projection.slug IS 'URL-friendly identifier for routing';
COMMENT ON COLUMN organizations_projection.is_active IS 'Organization active status (affects authentication and role assignment)';
COMMENT ON COLUMN organizations_projection.deleted_at IS 'Logical deletion timestamp (organizations are never physically deleted)';