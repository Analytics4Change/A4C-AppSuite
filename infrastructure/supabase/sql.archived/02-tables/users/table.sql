-- Users Table
-- Shadow table for Supabase Auth users, used for RLS and audit trails
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY, -- Matches auth.users.id from Supabase Auth
  email TEXT NOT NULL,
  name TEXT,
  current_organization_id UUID,
  accessible_organizations UUID[], -- Array of organization IDs
  metadata JSONB DEFAULT '{}',
  last_login TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE users IS 'Shadow table for Supabase Auth users, used for RLS and auditing';
COMMENT ON COLUMN users.id IS 'User UUID from Supabase Auth (auth.users.id)';
COMMENT ON COLUMN users.current_organization_id IS 'Currently selected organization context';
COMMENT ON COLUMN users.accessible_organizations IS 'Array of organization IDs user can access';