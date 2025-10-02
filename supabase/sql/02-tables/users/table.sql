-- Users Table
-- Shadow table for Zitadel users, used for RLS and audit trails
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE NOT NULL, -- Zitadel User ID
  email TEXT NOT NULL,
  name TEXT,
  current_organization_id UUID REFERENCES organizations(id),
  accessible_organizations UUID[], -- Array of organization IDs
  roles TEXT[], -- Array of role names from Zitadel
  metadata JSONB DEFAULT '{}',
  last_login TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE users IS 'Shadow table for Zitadel users, used for RLS and auditing';
COMMENT ON COLUMN users.external_id IS 'Zitadel User ID for authentication integration';
COMMENT ON COLUMN users.current_organization_id IS 'Currently selected organization context';
COMMENT ON COLUMN users.accessible_organizations IS 'Array of organization IDs user can access';
COMMENT ON COLUMN users.roles IS 'Array of role names from Zitadel (super_admin, administrator, clinician, specialist, parent, youth)';