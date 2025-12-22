-- Safety-Net Trigger: Validate Role Scope Path Active
-- Prevents role assignment to deactivated organization units
--
-- Purpose:
-- When an organization unit is deactivated (is_active = false), role assignments
-- to that OU and all its descendants should be blocked. This trigger provides
-- defense-in-depth by validating at the database layer, complementing RPC validation.
--
-- Trigger fires on:
-- - INSERT into user_roles_projection (new role assignment)
-- - UPDATE of scope_path on user_roles_projection (scope change)
--
-- Validation logic:
-- 1. If scope_path depth > 2 (i.e., it's an OU, not root org)
-- 2. Check if any ancestor OU in organization_units_projection is inactive
-- 3. If inactive ancestor found, RAISE EXCEPTION to block the operation
--
-- Note: Root organizations (depth = 2) are not checked here as they're in
-- organizations_projection and have different deactivation semantics.

-- ============================================================================
-- Validation Function
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_role_scope_path_active()
RETURNS TRIGGER AS $$
DECLARE
  v_scope_path LTREE;
  v_scope_depth INTEGER;
  v_inactive_ancestor_path LTREE;
  v_inactive_ancestor_name TEXT;
BEGIN
  -- Get the scope_path being assigned
  v_scope_path := NEW.scope_path;

  -- Skip validation if scope_path is NULL (global roles)
  IF v_scope_path IS NULL THEN
    RETURN NEW;
  END IF;

  -- Calculate depth
  v_scope_depth := nlevel(v_scope_path);

  -- Only validate for OU-level scopes (depth > 2)
  -- Root org scopes (depth = 2) are handled by organization.deactivated event
  IF v_scope_depth <= 2 THEN
    RETURN NEW;
  END IF;

  -- Check for inactive ancestors in organization_units_projection
  -- This includes the target OU itself (if it's deactivated)
  SELECT ou.path, ou.name
  INTO v_inactive_ancestor_path, v_inactive_ancestor_name
  FROM organization_units_projection ou
  WHERE v_scope_path <@ ou.path  -- scope_path is descendant of or equal to ou.path
    AND ou.is_active = false
    AND ou.deleted_at IS NULL  -- Not soft-deleted (those are completely blocked)
  ORDER BY ou.depth DESC  -- Get the most specific (deepest) inactive ancestor
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Cannot assign role to inactive organization unit scope. Ancestor "%" (%) is deactivated.',
      v_inactive_ancestor_name,
      v_inactive_ancestor_path
      USING ERRCODE = 'check_violation',
            HINT = 'Reactivate the organization unit before assigning roles to it or its descendants.';
  END IF;

  -- Also check if the scope_path refers to a deleted OU
  IF EXISTS (
    SELECT 1
    FROM organization_units_projection
    WHERE path = v_scope_path
      AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot assign role to deleted organization unit scope: %',
      v_scope_path
      USING ERRCODE = 'check_violation',
            HINT = 'The organization unit has been deleted and cannot receive role assignments.';
  END IF;

  -- All checks passed
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION validate_role_scope_path_active IS
  'Safety-net validation: Blocks role assignment to deactivated or deleted organization units. Checks ancestors for inactive status.';


-- ============================================================================
-- Trigger on user_roles_projection
-- ============================================================================

-- Drop trigger if exists (idempotency)
DROP TRIGGER IF EXISTS validate_role_scope_active_trigger ON user_roles_projection;

CREATE TRIGGER validate_role_scope_active_trigger
  BEFORE INSERT OR UPDATE OF scope_path ON user_roles_projection
  FOR EACH ROW
  EXECUTE FUNCTION validate_role_scope_path_active();

COMMENT ON TRIGGER validate_role_scope_active_trigger ON user_roles_projection IS
  'Prevents role assignment to deactivated or deleted organization unit scopes. Defense-in-depth validation.';


-- ============================================================================
-- Testing
-- ============================================================================

-- Test scenario 1: Assign role to active OU (should succeed)
-- INSERT INTO domain_events (...) with role.assigned event for active OU scope
-- Verify: Role appears in user_roles_projection

-- Test scenario 2: Assign role to inactive OU (should fail)
-- 1. Deactivate an OU: emit organization_unit.deactivated event
-- 2. Attempt role assignment to that OU's scope_path
-- Verify: Trigger raises exception with "Cannot assign role to inactive organization unit"

-- Test scenario 3: Assign role to child of inactive OU (should fail)
-- 1. Deactivate parent OU
-- 2. Attempt role assignment to child OU's scope_path
-- Verify: Trigger raises exception (ancestor is inactive)

-- Test scenario 4: Reactivate OU, then assign role (should succeed)
-- 1. Reactivate the OU: emit organization_unit.reactivated event
-- 2. Attempt role assignment
-- Verify: Role assignment succeeds
