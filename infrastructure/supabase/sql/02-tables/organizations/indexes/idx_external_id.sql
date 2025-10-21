-- Index on zitadel_org_id for fast lookups when syncing with Zitadel
CREATE INDEX IF NOT EXISTS idx_organizations_zitadel_org_id ON organizations_projection(zitadel_org_id);