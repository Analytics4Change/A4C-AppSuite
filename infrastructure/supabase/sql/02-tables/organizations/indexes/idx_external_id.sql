-- Index on external_id for fast lookups when syncing with Zitadel
CREATE INDEX IF NOT EXISTS idx_organizations_external_id ON organizations(external_id);