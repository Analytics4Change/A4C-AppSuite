-- Zitadel ID Resolution Helper Functions
-- Provides bi-directional mapping between Zitadel IDs and internal UUIDs

-- ============================================================================
-- Organization ID Resolution
-- ============================================================================

-- Resolve Zitadel organization ID → Internal UUID
CREATE OR REPLACE FUNCTION get_internal_org_id(
  p_zitadel_org_id TEXT
) RETURNS UUID AS $$
  SELECT internal_org_id
  FROM zitadel_organization_mapping
  WHERE zitadel_org_id = p_zitadel_org_id
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- Resolve Internal UUID → Zitadel organization ID
CREATE OR REPLACE FUNCTION get_zitadel_org_id(
  p_internal_org_id UUID
) RETURNS TEXT AS $$
  SELECT zitadel_org_id
  FROM zitadel_organization_mapping
  WHERE internal_org_id = p_internal_org_id
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- Get or create organization mapping (upsert pattern)
CREATE OR REPLACE FUNCTION upsert_org_mapping(
  p_internal_org_id UUID,
  p_zitadel_org_id TEXT,
  p_org_name TEXT DEFAULT NULL
) RETURNS UUID AS $$
BEGIN
  INSERT INTO zitadel_organization_mapping (
    internal_org_id,
    zitadel_org_id,
    org_name,
    created_at
  ) VALUES (
    p_internal_org_id,
    p_zitadel_org_id,
    p_org_name,
    NOW()
  )
  ON CONFLICT (internal_org_id) DO UPDATE SET
    org_name = COALESCE(EXCLUDED.org_name, zitadel_organization_mapping.org_name),
    updated_at = NOW();

  RETURN p_internal_org_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- User ID Resolution
-- ============================================================================

-- Resolve Zitadel user ID → Internal UUID
CREATE OR REPLACE FUNCTION get_internal_user_id(
  p_zitadel_user_id TEXT
) RETURNS UUID AS $$
  SELECT internal_user_id
  FROM zitadel_user_mapping
  WHERE zitadel_user_id = p_zitadel_user_id
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- Resolve Internal UUID → Zitadel user ID
CREATE OR REPLACE FUNCTION get_zitadel_user_id(
  p_internal_user_id UUID
) RETURNS TEXT AS $$
  SELECT zitadel_user_id
  FROM zitadel_user_mapping
  WHERE internal_user_id = p_internal_user_id
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- Get or create user mapping (upsert pattern)
CREATE OR REPLACE FUNCTION upsert_user_mapping(
  p_internal_user_id UUID,
  p_zitadel_user_id TEXT,
  p_user_email TEXT DEFAULT NULL
) RETURNS UUID AS $$
BEGIN
  INSERT INTO zitadel_user_mapping (
    internal_user_id,
    zitadel_user_id,
    user_email,
    created_at
  ) VALUES (
    p_internal_user_id,
    p_zitadel_user_id,
    p_user_email,
    NOW()
  )
  ON CONFLICT (internal_user_id) DO UPDATE SET
    user_email = COALESCE(EXCLUDED.user_email, zitadel_user_mapping.user_email),
    updated_at = NOW();

  RETURN p_internal_user_id;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON FUNCTION get_internal_org_id IS
  'Resolves Zitadel organization ID (TEXT) to internal surrogate UUID';
COMMENT ON FUNCTION get_zitadel_org_id IS
  'Resolves internal surrogate UUID to Zitadel organization ID (TEXT)';
COMMENT ON FUNCTION upsert_org_mapping IS
  'Creates or updates organization ID mapping (idempotent)';
COMMENT ON FUNCTION get_internal_user_id IS
  'Resolves Zitadel user ID (TEXT) to internal surrogate UUID';
COMMENT ON FUNCTION get_zitadel_user_id IS
  'Resolves internal surrogate UUID to Zitadel user ID (TEXT)';
COMMENT ON FUNCTION upsert_user_mapping IS
  'Creates or updates user ID mapping (idempotent)';
