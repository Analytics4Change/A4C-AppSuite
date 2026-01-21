-- Migration: Make invitations_projection.role nullable
-- Purpose: Support multi-role system transition
--
-- Background:
-- - Legacy system used 'role' (text) for single role assignment
-- - New system uses 'roles' (jsonb array) for multi-role support
-- - Event processor was inserting into 'roles' but 'role' was NOT NULL
-- - This caused constraint violation errors on invitation creation
--
-- Solution:
-- - Make 'role' column nullable to support gradual migration
-- - Existing data remains unchanged
-- - New invitations may have NULL role (using 'roles' array instead)

-- Make legacy 'role' column nullable (idempotent - safe to run multiple times)
DO $$
BEGIN
  -- Check if the column is currently NOT NULL
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'invitations_projection'
      AND column_name = 'role'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE invitations_projection
      ALTER COLUMN role DROP NOT NULL;
    RAISE NOTICE 'Made invitations_projection.role nullable';
  ELSE
    RAISE NOTICE 'invitations_projection.role is already nullable or does not exist';
  END IF;
END
$$;

-- Add comment explaining the column is deprecated
COMMENT ON COLUMN invitations_projection.role IS
  'DEPRECATED: Use roles (jsonb array) instead. Kept for backward compatibility with bootstrap workflow.';
