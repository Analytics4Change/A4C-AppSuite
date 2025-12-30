-- Simplify scope_type constraint to only allow 'global' and 'org' values
-- The 'facility', 'program', and 'client' scope_type values were never used
-- and are being removed as part of the RBAC scoping architecture simplification.
--
-- See: documentation/architecture/authorization/scoping-architecture.md

-- Step 1: Drop the existing constraint
ALTER TABLE permissions_projection
DROP CONSTRAINT IF EXISTS permissions_projection_scope_type_check;

-- Step 2: Add simplified constraint (only global and org allowed)
ALTER TABLE permissions_projection
ADD CONSTRAINT permissions_projection_scope_type_check
CHECK (scope_type IN ('global', 'org'));

-- Verify: No permissions should have the removed scope_type values
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM permissions_projection
  WHERE scope_type NOT IN ('global', 'org');

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Found % permissions with invalid scope_type values. Migration cannot proceed.', v_count;
  END IF;

  RAISE NOTICE 'Constraint simplified successfully. All % permissions have valid scope_type values.',
    (SELECT COUNT(*) FROM permissions_projection);
END $$;
