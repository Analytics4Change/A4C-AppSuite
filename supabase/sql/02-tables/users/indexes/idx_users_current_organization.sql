-- Index on current_organization_id for filtering by organization context
CREATE INDEX IF NOT EXISTS idx_users_current_organization ON users(current_organization_id);