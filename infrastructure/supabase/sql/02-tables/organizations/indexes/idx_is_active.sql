-- Index on is_active for filtering active organizations
CREATE INDEX IF NOT EXISTS idx_organizations_is_active ON organizations_projection(is_active);