-- Index on type for filtering organizations by category
CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations_projection(type);