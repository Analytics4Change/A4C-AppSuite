-- =============================================================================
-- Migration: User Current Org Unit (Session Context)
-- Purpose: Add user's current working OU context for user-centric workflow routing
-- Part of: Multi-Role Authorization Phase 3A-0
-- =============================================================================

-- =============================================================================
-- COLUMN: users.current_org_unit_id
-- =============================================================================

-- Add current_org_unit_id to users table for session-level OU context
-- NULL means "org-level context" (no specific OU selected)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS current_org_unit_id uuid REFERENCES organization_units_projection(id);

-- Index for lookups (sparse index - only non-NULL values)
CREATE INDEX IF NOT EXISTS idx_users_current_org_unit
ON users(current_org_unit_id) WHERE current_org_unit_id IS NOT NULL;

-- Documentation
COMMENT ON COLUMN users.current_org_unit_id IS
'Currently selected org unit context for user-centric workflows.
NULL means "all units in current org" or "org-level context".
Updated via api.switch_org_unit() or UI org unit selector.

Used by:
- Temporal workflows for notification routing (user-centric flows)
- JWT claims for scope context
- UI to filter views to specific OU

For client-centric workflows, OU context comes from client.org_unit_id instead.';

-- =============================================================================
-- FUNCTION: api.switch_org_unit(uuid)
-- =============================================================================

-- Allow user to switch their current org unit context
CREATE OR REPLACE FUNCTION api.switch_org_unit(p_org_unit_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_id uuid := get_current_org_id();
  v_ou_path ltree;
BEGIN
  -- Validate user is authenticated
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- NULL is allowed (clears OU context to org-level)
  IF p_org_unit_id IS NULL THEN
    UPDATE users SET
      current_org_unit_id = NULL,
      updated_at = now()
    WHERE id = v_user_id;
    RETURN;
  END IF;

  -- Verify org unit exists and belongs to user's current org
  SELECT path INTO v_ou_path
  FROM organization_units_projection
  WHERE id = p_org_unit_id
    AND organization_id = v_org_id
    AND is_active = true;

  IF v_ou_path IS NULL THEN
    RAISE EXCEPTION 'Invalid org unit: does not exist, is inactive, or belongs to different organization';
  END IF;

  -- Verify user has permission to view this OU (scope containment check)
  -- User must have organization.view_ou at a scope that contains this OU's path
  IF NOT has_effective_permission('organization.view_ou', v_ou_path) THEN
    RAISE EXCEPTION 'Insufficient permissions: organization.view_ou required for target OU';
  END IF;

  -- Update user's current org unit
  UPDATE users SET
    current_org_unit_id = p_org_unit_id,
    updated_at = now()
  WHERE id = v_user_id;
END;
$$;

-- Documentation
COMMENT ON FUNCTION api.switch_org_unit(uuid) IS
'Switch the current user''s working org unit context.

Parameters:
- p_org_unit_id: The org unit ID to switch to, or NULL to clear to org-level context

Validation:
1. User must be authenticated
2. Org unit must exist, be active, and belong to user''s current organization
3. User must have organization.view_ou permission at a scope containing the target OU

Used by:
- Frontend org unit selector dropdown
- API calls to set user context before workflow operations

Note: This affects JWT claims on next token refresh (current_org_unit_id, current_org_unit_path).';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION api.switch_org_unit(uuid) TO authenticated;

-- =============================================================================
-- FUNCTION: api.get_current_org_unit()
-- =============================================================================

-- Helper to get current user's org unit (for consistency with get_current_org_id pattern)
CREATE OR REPLACE FUNCTION api.get_current_org_unit()
RETURNS TABLE(
  id uuid,
  name text,
  path extensions.ltree,
  organization_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    ou.id,
    ou.name,
    ou.path,
    ou.organization_id
  FROM users u
  LEFT JOIN organization_units_projection ou ON ou.id = u.current_org_unit_id
  WHERE u.id = auth.uid();
$$;

-- Documentation
COMMENT ON FUNCTION api.get_current_org_unit() IS
'Get the current user''s selected org unit context.

Returns:
- Single row with OU details if user has current_org_unit_id set
- Single row with NULL values if user is at org-level context

Used by:
- Frontend to display current OU context
- Backend to determine workflow routing context';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION api.get_current_org_unit() TO authenticated;
