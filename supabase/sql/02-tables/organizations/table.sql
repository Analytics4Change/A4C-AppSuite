-- Organizations Table
-- Primary table for multi-tenancy support, synced with Zitadel organizations
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE NOT NULL, -- Zitadel Organization ID
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('healthcare_facility', 'var', 'admin')),
  metadata JSONB DEFAULT '{}',
  settings JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE organizations IS 'Multi-tenant organizations synced with Zitadel';
COMMENT ON COLUMN organizations.external_id IS 'Zitadel Organization ID for integration';
COMMENT ON COLUMN organizations.type IS 'Organization type: healthcare_facility, var, or admin';
COMMENT ON COLUMN organizations.metadata IS 'Flexible JSON storage for additional organization data';
COMMENT ON COLUMN organizations.settings IS 'Organization-specific configuration settings';