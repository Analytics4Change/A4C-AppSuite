-- Index on zitadel_user_id for fast lookups when syncing with Zitadel
CREATE INDEX IF NOT EXISTS idx_users_zitadel_user_id ON users(zitadel_user_id);