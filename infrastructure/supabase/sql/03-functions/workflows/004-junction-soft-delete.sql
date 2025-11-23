-- Junction Table Soft-Delete Functions
-- Provider Onboarding Enhancement - Phase 4.1
-- RPC functions for saga compensation activities to soft-delete junction records
-- Rationale: Workflow activities need explicit control over junction lifecycle

-- ==============================================================================
-- Overview
-- ==============================================================================
-- These functions are called by Temporal workflow compensation activities:
-- - delete-contacts.ts → soft_delete_organization_contacts()
-- - delete-addresses.ts → soft_delete_organization_addresses()
-- - delete-phones.ts → soft_delete_organization_phones()
--
-- Pattern:
-- 1. Activity calls RPC to soft-delete junctions FIRST
-- 2. Activity queries entities via get_*_by_org()
-- 3. Activity emits entity.deleted events (audit trail)

-- ==============================================================================
-- Function: soft_delete_organization_contacts
-- ==============================================================================
CREATE OR REPLACE FUNCTION soft_delete_organization_contacts(
  p_org_id UUID,
  p_deleted_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Update only active junction records (idempotent)
  UPDATE organization_contacts
  SET deleted_at = p_deleted_at
  WHERE organization_id = p_org_id
    AND deleted_at IS NULL;

  -- Return count of soft-deleted records
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION soft_delete_organization_contacts IS 'Soft-delete all organization-contact junctions for workflow compensation. Returns count of deleted records.';

-- ==============================================================================
-- Function: soft_delete_organization_addresses
-- ==============================================================================
CREATE OR REPLACE FUNCTION soft_delete_organization_addresses(
  p_org_id UUID,
  p_deleted_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Update only active junction records (idempotent)
  UPDATE organization_addresses
  SET deleted_at = p_deleted_at
  WHERE organization_id = p_org_id
    AND deleted_at IS NULL;

  -- Return count of soft-deleted records
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION soft_delete_organization_addresses IS 'Soft-delete all organization-address junctions for workflow compensation. Returns count of deleted records.';

-- ==============================================================================
-- Function: soft_delete_organization_phones
-- ==============================================================================
CREATE OR REPLACE FUNCTION soft_delete_organization_phones(
  p_org_id UUID,
  p_deleted_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Update only active junction records (idempotent)
  UPDATE organization_phones
  SET deleted_at = p_deleted_at
  WHERE organization_id = p_org_id
    AND deleted_at IS NULL;

  -- Return count of soft-deleted records
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION soft_delete_organization_phones IS 'Soft-delete all organization-phone junctions for workflow compensation. Returns count of deleted records.';

-- ==============================================================================
-- Notes
-- ==============================================================================
-- - SECURITY DEFINER: Allows service role to execute (workflows use service role)
-- - Idempotent: WHERE deleted_at IS NULL ensures safe retry
-- - Return count: Workflow activities log count for verification
-- - No events: Activities emit entity.deleted events separately
-- - No triggers: Direct UPDATE, no cascade logic
