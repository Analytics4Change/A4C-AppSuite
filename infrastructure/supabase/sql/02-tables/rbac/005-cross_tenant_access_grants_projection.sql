-- Cross-Tenant Access Grants Projection Table
-- This is a CQRS projection maintained by event processors
-- Source of truth: access_grant.created/revoked events in domain_events table

CREATE TABLE IF NOT EXISTS cross_tenant_access_grants_projection (
  id UUID PRIMARY KEY,
  consultant_org_id TEXT NOT NULL,
  consultant_user_id UUID,
  provider_org_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('full_org', 'facility', 'client')),
  scope_id UUID,
  granted_by UUID NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  authorization_type TEXT NOT NULL CHECK (authorization_type IN ('court_order', 'parental_consent', 'var_contract', 'social_services')),
  legal_reference TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,

  -- Constraint: facility and client scopes require scope_id
  CHECK (
    (scope = 'full_org' AND scope_id IS NULL)
    OR
    (scope IN ('facility', 'client') AND scope_id IS NOT NULL)
  )
);

-- Indexes for authorization lookups
CREATE INDEX IF NOT EXISTS idx_access_grants_consultant_org ON cross_tenant_access_grants_projection(consultant_org_id);
CREATE INDEX IF NOT EXISTS idx_access_grants_consultant_user ON cross_tenant_access_grants_projection(consultant_user_id) WHERE consultant_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_access_grants_provider_org ON cross_tenant_access_grants_projection(provider_org_id);
CREATE INDEX IF NOT EXISTS idx_access_grants_scope ON cross_tenant_access_grants_projection(scope);
CREATE INDEX IF NOT EXISTS idx_access_grants_authorization_type ON cross_tenant_access_grants_projection(authorization_type);

-- Composite index for common access check pattern
CREATE INDEX IF NOT EXISTS idx_access_grants_lookup ON cross_tenant_access_grants_projection(consultant_org_id, provider_org_id)
  WHERE revoked_at IS NULL;

-- Index for expiration cleanup
CREATE INDEX IF NOT EXISTS idx_access_grants_expires ON cross_tenant_access_grants_projection(expires_at)
  WHERE expires_at IS NOT NULL AND revoked_at IS NULL;

-- Comments
COMMENT ON TABLE cross_tenant_access_grants_projection IS 'Projection of access_grant.* events - enables Provider Partner access to Provider data';
COMMENT ON COLUMN cross_tenant_access_grants_projection.consultant_org_id IS 'Provider Partner organization requesting access';
COMMENT ON COLUMN cross_tenant_access_grants_projection.consultant_user_id IS 'Specific user (NULL for org-wide grant)';
COMMENT ON COLUMN cross_tenant_access_grants_projection.provider_org_id IS 'Target Provider organization owning the data';
COMMENT ON COLUMN cross_tenant_access_grants_projection.scope IS 'Access scope level: full_org, facility, or client';
COMMENT ON COLUMN cross_tenant_access_grants_projection.scope_id IS 'Specific resource ID for facility or client scope';
COMMENT ON COLUMN cross_tenant_access_grants_projection.authorization_type IS 'Legal basis for cross-tenant access';
COMMENT ON COLUMN cross_tenant_access_grants_projection.legal_reference IS 'Court order #, consent form ID, contract reference, etc.';
COMMENT ON COLUMN cross_tenant_access_grants_projection.expires_at IS 'Expiration timestamp for time-limited access';
COMMENT ON COLUMN cross_tenant_access_grants_projection.revoked_at IS 'Timestamp when grant was revoked (NULL if active)';
