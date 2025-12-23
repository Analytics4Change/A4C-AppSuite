-- Add Partner Type and Referring Partner Columns
-- Provider Onboarding Enhancement - Phase 1.1
-- Adds partner classification and referring partner relationship tracking

-- Add partner_type column (nullable, required only for provider_partner orgs)
ALTER TABLE organizations_projection
ADD COLUMN IF NOT EXISTS partner_type partner_type;

-- Add referring_partner_id column (nullable, tracks which VAR partner referred this provider)
-- Note: No ON DELETE action - event-driven deletion required (emit organization.updated events to clear references)
ALTER TABLE organizations_projection
ADD COLUMN IF NOT EXISTS referring_partner_id UUID REFERENCES organizations_projection(id);

-- Add CHECK constraint: partner_type required for provider_partner orgs
-- Note: Using DO block for idempotency since ALTER TABLE ADD CONSTRAINT doesn't support IF NOT EXISTS
DO $$ BEGIN
  ALTER TABLE organizations_projection
    ADD CONSTRAINT chk_partner_type_required
    CHECK (
      (type != 'provider_partner') OR
      (type = 'provider_partner' AND partner_type IS NOT NULL)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Create index on partner_type for filtering (VAR partners, stakeholder partners)
CREATE INDEX IF NOT EXISTS idx_organizations_partner_type
  ON organizations_projection(partner_type)
  WHERE partner_type IS NOT NULL;

-- Create index on referring_partner_id for relationship queries
CREATE INDEX IF NOT EXISTS idx_organizations_referring_partner
  ON organizations_projection(referring_partner_id)
  WHERE referring_partner_id IS NOT NULL;

-- Update documentation comments
COMMENT ON COLUMN organizations_projection.partner_type IS 'Partner classification for provider_partner orgs: var (reseller, gets subdomain), family/court/other (stakeholders, no subdomain)';
COMMENT ON COLUMN organizations_projection.referring_partner_id IS 'UUID of referring VAR partner (nullable, tracks which partner brought this provider to platform)';
