-- Permissions Projection Table
-- This is a CQRS projection maintained by event processors
-- Source of truth: permission.defined events in domain_events table

CREATE TABLE IF NOT EXISTS permissions_projection (
  id UUID PRIMARY KEY,
  applet TEXT NOT NULL,
  action TEXT NOT NULL,
  name TEXT GENERATED ALWAYS AS (applet || '.' || action) STORED,
  description TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'org', 'facility', 'program', 'client')),
  requires_mfa BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (applet, action)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_permissions_applet ON permissions_projection(applet);
CREATE INDEX IF NOT EXISTS idx_permissions_name ON permissions_projection(name);
CREATE INDEX IF NOT EXISTS idx_permissions_scope_type ON permissions_projection(scope_type);
CREATE INDEX IF NOT EXISTS idx_permissions_requires_mfa ON permissions_projection(requires_mfa) WHERE requires_mfa = TRUE;

-- Comments
COMMENT ON TABLE permissions_projection IS 'Projection of permission.defined events - defines atomic authorization units';
COMMENT ON COLUMN permissions_projection.name IS 'Generated permission identifier in format: applet.action';
COMMENT ON COLUMN permissions_projection.scope_type IS 'Hierarchical scope level: global, org, facility, program, or client';
COMMENT ON COLUMN permissions_projection.requires_mfa IS 'Whether MFA verification is required to use this permission';
