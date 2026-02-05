-- =============================================================================
-- Migration: Drop Deprecated JWT Helper Functions
-- Purpose: Remove functions that read from removed JWT claims
-- Part of: JWT Claims v4 Migration - Cleanup
-- =============================================================================
--
-- CONTEXT:
-- These helper functions were deprecated in v3 (20260122222249_rls_helpers_v3.sql)
-- and marked for removal in Phase 4. They read from JWT claims that no longer
-- exist in v4 (user_role, scope_path, permissions flat array).
--
-- Prerequisites completed:
-- 1. RLS policies migrated to use has_effective_permission() (20260124192733)
-- 2. API functions migrated to use get_permission_scope() (20260203170442)
-- 3. has_org_admin_permission() fixed (20260203174333)
-- 4. has_platform_privilege() fixed (this migration series)
--
-- KEPT FUNCTIONS:
-- - get_current_org_id() - Still valid (user has one current org)
-- - has_platform_privilege() - Updated to use effective_permissions
-- - has_permission() - Uses effective_permissions
-- - has_effective_permission() - Uses effective_permissions
-- - get_permission_scope() - Uses effective_permissions
-- =============================================================================

-- Drop deprecated helper functions
-- These are safe to drop because all callers have been migrated

DROP FUNCTION IF EXISTS get_current_user_role();
DROP FUNCTION IF EXISTS get_current_permissions();
DROP FUNCTION IF EXISTS get_current_scope_path();

-- Verify the functions are gone by checking pg_proc
-- (This is informational - the migration will succeed either way)
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname IN ('get_current_user_role', 'get_current_permissions', 'get_current_scope_path');

  IF v_count > 0 THEN
    RAISE WARNING 'Unexpected: % deprecated functions still exist after DROP', v_count;
  ELSE
    RAISE NOTICE 'Successfully dropped all deprecated JWT helper functions';
  END IF;
END $$;
