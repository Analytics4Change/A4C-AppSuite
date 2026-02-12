-- =============================================================================
-- Migration: Update has_platform_privilege() for JWT v4
-- Purpose: Use effective_permissions instead of deprecated permissions array
-- Part of: JWT Claims v4 Migration - Final Phase
-- =============================================================================
--
-- CONTEXT:
-- The JWT v4 hook (20260126180004_strip_deprecated_jwt_claims.sql) removed the
-- flat `permissions` array from JWT output. However, has_platform_privilege()
-- was still reading from that removed claim.
--
-- This migration updates the function to read from `effective_permissions`
-- instead, which is the v4 format: [{p: "permission", s: "scope"}, ...]
--
-- All existing callers (RLS policies, API functions) will automatically work
-- with v4 claims after this migration.
-- =============================================================================

CREATE OR REPLACE FUNCTION has_platform_privilege()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      COALESCE(
        (current_setting('request.jwt.claims', true)::jsonb)->'effective_permissions',
        '[]'::jsonb
      )
    ) ep
    WHERE ep->>'p' = 'platform.admin'
  );
$$;

COMMENT ON FUNCTION has_platform_privilege() IS
'Check if current user has platform.admin permission.

v4 implementation - reads from effective_permissions JWT claim.
Returns true if effective_permissions contains {p: "platform.admin", ...}.

Used by:
- RLS policies on domain_events (INSERT, SELECT)
- RLS policy on users (SELECT)
- API functions: api.get_bootstrap_status, api.retry_failed_bootstrap,
  api.list_bootstrap_processes, api.cleanup_old_bootstrap_failures, etc.

Note: Global scope ("") grants platform.admin to all resources.';
