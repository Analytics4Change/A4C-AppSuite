-- Cross-Tenant Access Grants Projection Table
-- This is a CQRS projection maintained by event processors
-- Source of truth: access_grant.created/revoked events in domain_events table

CREATE TABLE IF NOT EXISTS cross_tenant_access_grants_projection (
  id UUID PRIMARY KEY,
  consultant_org_id UUID NOT NULL,
  consultant_user_id UUID,
  provider_org_id UUID NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('full_org', 'facility', 'program', 'client_specific')),
  scope_id UUID,
  authorization_type TEXT NOT NULL CHECK (authorization_type IN ('var_contract', 'court_order', 'parental_consent', 'social_services_assignment', 'emergency_access')),
  legal_reference TEXT,
  granted_by UUID NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  permissions JSONB DEFAULT '[]'::JSONB,
  terms JSONB DEFAULT '{}'::JSONB,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired', 'suspended')),
  
  -- Revocation fields
  revoked_at TIMESTAMPTZ,
  revoked_by UUID,
  revocation_reason TEXT,
  revocation_details TEXT,
  
  -- Expiration fields  
  expired_at TIMESTAMPTZ,
  expiration_type TEXT,
  
  -- Suspension fields
  suspended_at TIMESTAMPTZ,
  suspended_by UUID,
  suspension_reason TEXT,
  suspension_details TEXT,
  expected_resolution_date TIMESTAMPTZ,
  
  -- Reactivation fields
  reactivated_at TIMESTAMPTZ,
  reactivated_by UUID,
  resolution_details TEXT,
  
  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraint: facility, program, and client scopes require scope_id
  CHECK (
    (scope = 'full_org' AND scope_id IS NULL)
    OR
    (scope IN ('facility', 'program', 'client_specific') AND scope_id IS NOT NULL)
  )
);

-- Indexes for authorization lookups
CREATE INDEX IF NOT EXISTS idx_access_grants_consultant_org ON cross_tenant_access_grants_projection(consultant_org_id);
CREATE INDEX IF NOT EXISTS idx_access_grants_consultant_user ON cross_tenant_access_grants_projection(consultant_user_id) WHERE consultant_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_access_grants_provider_org ON cross_tenant_access_grants_projection(provider_org_id);
CREATE INDEX IF NOT EXISTS idx_access_grants_scope ON cross_tenant_access_grants_projection(scope);
CREATE INDEX IF NOT EXISTS idx_access_grants_authorization_type ON cross_tenant_access_grants_projection(authorization_type);
CREATE INDEX IF NOT EXISTS idx_access_grants_status ON cross_tenant_access_grants_projection(status);

-- Composite index for common access check pattern (active grants)
CREATE INDEX IF NOT EXISTS idx_access_grants_lookup ON cross_tenant_access_grants_projection(consultant_org_id, provider_org_id, status)
  WHERE status = 'active';

-- Index for expiration cleanup and monitoring
CREATE INDEX IF NOT EXISTS idx_access_grants_expires ON cross_tenant_access_grants_projection(expires_at, status)
  WHERE expires_at IS NOT NULL AND status IN ('active', 'suspended');

-- Index for suspended grants monitoring
CREATE INDEX IF NOT EXISTS idx_access_grants_suspended ON cross_tenant_access_grants_projection(expected_resolution_date)
  WHERE status = 'suspended';

-- Index for audit queries by granter
CREATE INDEX IF NOT EXISTS idx_access_grants_granted_by ON cross_tenant_access_grants_projection(granted_by, granted_at);

-- Comments
COMMENT ON TABLE cross_tenant_access_grants_projection IS 'CQRS projection of access_grant.* events - enables provider_partner organizations to access provider data with full audit trail';
COMMENT ON COLUMN cross_tenant_access_grants_projection.consultant_org_id IS 'provider_partner organization requesting access (UUID format)';
COMMENT ON COLUMN cross_tenant_access_grants_projection.consultant_user_id IS 'Specific user within consultant org (NULL for org-wide grant)';
COMMENT ON COLUMN cross_tenant_access_grants_projection.provider_org_id IS 'Target provider organization owning the data (UUID format)';
COMMENT ON COLUMN cross_tenant_access_grants_projection.scope IS 'Access scope level: full_org, facility, program, or client_specific';
COMMENT ON COLUMN cross_tenant_access_grants_projection.scope_id IS 'Specific resource UUID for facility, program, or client scope';
COMMENT ON COLUMN cross_tenant_access_grants_projection.authorization_type IS 'Legal/business basis: var_contract, court_order, parental_consent, social_services_assignment, emergency_access';
COMMENT ON COLUMN cross_tenant_access_grants_projection.legal_reference IS 'Reference to legal document, contract number, case number, etc.';
COMMENT ON COLUMN cross_tenant_access_grants_projection.permissions IS 'JSONB array of specific permissions granted (default: standard set for grant type)';
COMMENT ON COLUMN cross_tenant_access_grants_projection.terms IS 'JSONB object with additional terms (read_only, data_retention_days, notification_required)';
COMMENT ON COLUMN cross_tenant_access_grants_projection.status IS 'Current grant status: active, revoked, expired, suspended';
COMMENT ON COLUMN cross_tenant_access_grants_projection.expires_at IS 'Expiration timestamp for time-limited access (NULL for indefinite)';
COMMENT ON COLUMN cross_tenant_access_grants_projection.revoked_at IS 'Timestamp when grant was permanently revoked';
COMMENT ON COLUMN cross_tenant_access_grants_projection.suspended_at IS 'Timestamp when grant was temporarily suspended (can be reactivated)';
