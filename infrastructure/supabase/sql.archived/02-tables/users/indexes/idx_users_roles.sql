-- GIN index on roles array for efficient role-based filtering
CREATE INDEX IF NOT EXISTS idx_users_roles ON users USING GIN(roles);