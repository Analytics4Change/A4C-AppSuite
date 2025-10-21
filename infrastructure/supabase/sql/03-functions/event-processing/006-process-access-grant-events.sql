-- Access Grant Event Processing Functions
-- Handles cross-tenant access grant lifecycle events with CQRS compliance
-- Source events: access_grant.* events in domain_events table

-- Main access grant event processor
CREATE OR REPLACE FUNCTION process_access_grant_event(
  p_event RECORD
) RETURNS VOID AS $$
DECLARE
  v_grant_id UUID;
BEGIN
  CASE p_event.event_type
    
    -- Handle access grant creation
    WHEN 'access_grant.created' THEN
      -- CQRS-compliant: Insert into projection (only from events)
      INSERT INTO cross_tenant_access_grants_projection (
        id,
        consultant_org_id,
        consultant_user_id,
        provider_org_id,
        scope,
        scope_id,
        authorization_type,
        legal_reference,
        granted_by,
        granted_at,
        expires_at,
        permissions,
        terms,
        status,
        created_at,
        updated_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'consultant_org_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'consultant_user_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'provider_org_id'),
        safe_jsonb_extract_text(p_event.event_data, 'scope'),
        safe_jsonb_extract_uuid(p_event.event_data, 'scope_id'),
        safe_jsonb_extract_text(p_event.event_data, 'authorization_type'),
        safe_jsonb_extract_text(p_event.event_data, 'legal_reference'),
        safe_jsonb_extract_uuid(p_event.event_data, 'granted_by'),
        p_event.created_at,
        safe_jsonb_extract_timestamp(p_event.event_data, 'expires_at'),
        COALESCE(p_event.event_data->'permissions', '[]'::jsonb),
        COALESCE(p_event.event_data->'terms', '{}'::jsonb),
        'active',
        p_event.created_at,
        p_event.created_at
      );

    -- Handle access grant revocation  
    WHEN 'access_grant.revoked' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      
      -- Update projection to revoked status
      UPDATE cross_tenant_access_grants_projection 
      SET 
        status = 'revoked',
        revoked_at = p_event.created_at,
        revoked_by = safe_jsonb_extract_uuid(p_event.event_data, 'revoked_by'),
        revocation_reason = safe_jsonb_extract_text(p_event.event_data, 'revocation_reason'),
        revocation_details = safe_jsonb_extract_text(p_event.event_data, 'revocation_details'),
        updated_at = p_event.created_at
      WHERE id = v_grant_id;

    -- Handle access grant expiration
    WHEN 'access_grant.expired' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      
      -- Update projection to expired status
      UPDATE cross_tenant_access_grants_projection 
      SET 
        status = 'expired',
        expired_at = p_event.created_at,
        expiration_type = safe_jsonb_extract_text(p_event.event_data, 'expiration_type'),
        updated_at = p_event.created_at
      WHERE id = v_grant_id;

    -- Handle access grant suspension
    WHEN 'access_grant.suspended' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      
      -- Update projection to suspended status
      UPDATE cross_tenant_access_grants_projection 
      SET 
        status = 'suspended',
        suspended_at = p_event.created_at,
        suspended_by = safe_jsonb_extract_uuid(p_event.event_data, 'suspended_by'),
        suspension_reason = safe_jsonb_extract_text(p_event.event_data, 'suspension_reason'),
        suspension_details = safe_jsonb_extract_text(p_event.event_data, 'suspension_details'),
        expected_resolution_date = safe_jsonb_extract_timestamp(p_event.event_data, 'expected_resolution_date'),
        updated_at = p_event.created_at
      WHERE id = v_grant_id;

    -- Handle access grant reactivation
    WHEN 'access_grant.reactivated' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      
      -- Update projection back to active status
      UPDATE cross_tenant_access_grants_projection 
      SET 
        status = 'active',
        suspended_at = NULL,
        suspended_by = NULL,
        suspension_reason = NULL,
        suspension_details = NULL,
        expected_resolution_date = NULL,
        reactivated_at = p_event.created_at,
        reactivated_by = safe_jsonb_extract_uuid(p_event.event_data, 'reactivated_by'),
        resolution_details = safe_jsonb_extract_text(p_event.event_data, 'resolution_details'),
        -- Update expiration if modified during reactivation
        expires_at = COALESCE(
          safe_jsonb_extract_timestamp(p_event.event_data, 'new_expires_at'),
          expires_at
        ),
        updated_at = p_event.created_at
      WHERE id = v_grant_id;

    ELSE
      RAISE WARNING 'Unknown access grant event type: %', p_event.event_type;
  END CASE;

END;
$$ LANGUAGE plpgsql;

-- Helper function to validate cross-tenant access requirements
CREATE OR REPLACE FUNCTION validate_cross_tenant_access(
  p_consultant_org_id UUID,
  p_provider_org_id UUID,
  p_user_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_consultant_type TEXT;
  v_provider_type TEXT;
BEGIN
  -- Get organization types
  SELECT type INTO v_consultant_type 
  FROM organizations_projection 
  WHERE id = p_consultant_org_id AND is_active = true;
  
  SELECT type INTO v_provider_type 
  FROM organizations_projection 
  WHERE id = p_provider_org_id AND is_active = true;
  
  -- Validate organizations exist and are active
  IF v_consultant_type IS NULL OR v_provider_type IS NULL THEN
    RETURN false;
  END IF;
  
  -- Consultant must be provider_partner, provider must be provider
  IF v_consultant_type != 'provider_partner' OR v_provider_type != 'provider' THEN
    RETURN false;
  END IF;
  
  -- If user-specific grant, validate user belongs to consultant org
  IF p_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_roles_projection
      WHERE user_id = p_user_id
        AND org_id = p_consultant_org_id
    ) THEN
      RETURN false;
    END IF;
  END IF;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to get active grants for consultant organization
CREATE OR REPLACE FUNCTION get_active_grants_for_consultant(
  p_consultant_org_id UUID,
  p_user_id UUID DEFAULT NULL
) RETURNS TABLE (
  grant_id UUID,
  provider_org_id UUID,
  provider_org_name TEXT,
  scope TEXT,
  authorization_type TEXT,
  expires_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ctag.id,
    ctag.provider_org_id,
    op.name,
    ctag.scope,
    ctag.authorization_type,
    ctag.expires_at
  FROM cross_tenant_access_grants_projection ctag
  JOIN organizations_projection op ON op.id = ctag.provider_org_id
  WHERE ctag.consultant_org_id = p_consultant_org_id
    AND ctag.status = 'active'
    AND (ctag.expires_at IS NULL OR ctag.expires_at > NOW())
    AND (p_user_id IS NULL OR ctag.consultant_user_id IS NULL OR ctag.consultant_user_id = p_user_id)
    AND op.is_active = true
    AND op.deleted_at IS NULL
  ORDER BY op.name, ctag.granted_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to check if specific access is granted
CREATE OR REPLACE FUNCTION has_cross_tenant_access(
  p_consultant_org_id UUID,
  p_provider_org_id UUID,
  p_user_id UUID DEFAULT NULL,
  p_scope TEXT DEFAULT 'full_org'
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM cross_tenant_access_grants_projection 
    WHERE consultant_org_id = p_consultant_org_id
      AND provider_org_id = p_provider_org_id
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > NOW())
      AND (p_user_id IS NULL OR consultant_user_id IS NULL OR consultant_user_id = p_user_id)
      AND (scope = p_scope OR scope = 'full_org') -- full_org grants access to everything
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Comments for documentation
COMMENT ON FUNCTION process_access_grant_event IS 
  'Main access grant event processor - handles cross-tenant grant lifecycle with CQRS compliance';
COMMENT ON FUNCTION validate_cross_tenant_access IS 
  'Validates that cross-tenant access grant request meets business rules';
COMMENT ON FUNCTION get_active_grants_for_consultant IS 
  'Returns all active grants for a consultant organization/user';
COMMENT ON FUNCTION has_cross_tenant_access IS 
  'Checks if specific cross-tenant access is currently granted';