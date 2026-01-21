-- Migration: Platform Admin Permission and has_platform_privilege() Function
-- Description: Creates unified platform owner privileged access pattern
--
-- This migration establishes the canonical pattern for platform owner access:
-- 1. Adds 'platform.admin' permission to permissions_projection
-- 2. Grants it to super_admin role (and future delegate roles can get it too)
-- 3. Creates has_platform_privilege() function that checks JWT permissions array
-- 4. Drops deprecated is_super_admin() function
--
-- Design by Contract:
-- - Precondition: Valid JWT with 'permissions' claim array
-- - Postcondition: Returns true IFF 'platform.admin' in permissions array
-- - Invariant: No database queries (JWT-only for performance)
-- - Error handling: Returns false on missing/malformed claims (fail-safe)

-- ============================================================================
-- Step 1: Add platform.admin permission
-- ============================================================================

-- Note: 'name' column is a GENERATED column (applet || '.' || action), so we don't include it
INSERT INTO permissions_projection (
  id,
  applet,
  action,
  description,
  scope_type,
  requires_mfa,
  display_name,
  created_at
)
VALUES (
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  'platform',
  'admin',
  'Full platform administrative access including observability, cross-tenant operations, and system management. Required for Event Monitor, audit log access, and platform-level features.',
  'global',
  false,
  'Platform Administration',
  NOW()
)
ON CONFLICT (applet, action) DO UPDATE SET
  description = EXCLUDED.description,
  display_name = EXCLUDED.display_name;

-- ============================================================================
-- Step 2: Grant platform.admin to super_admin role
-- ============================================================================

INSERT INTO role_permissions_projection (role_id, permission_id, granted_at)
SELECT
  r.id AS role_id,
  p.id AS permission_id,
  NOW() AS granted_at
FROM roles_projection r
CROSS JOIN permissions_projection p
WHERE r.name = 'super_admin'
  AND p.name = 'platform.admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================================
-- Step 3: Create has_platform_privilege() function
-- ============================================================================
-- This function checks if the current user has 'platform.admin' permission
-- in their JWT claims. It does NOT query the database for performance.
--
-- Usage in RLS policies and functions:
--   IF NOT has_platform_privilege() THEN
--     RAISE EXCEPTION 'Access denied: platform.admin permission required';
--   END IF;
--
-- Extensibility:
-- To grant platform admin access to a new role (e.g., platform_support):
--   INSERT INTO role_permissions_projection (role_id, permission_id)
--   SELECT r.id, p.id
--   FROM roles_projection r, permissions_projection p
--   WHERE r.name = 'platform_support' AND p.name = 'platform.admin';
-- No code changes required - permission flows through JWT automatically.

CREATE OR REPLACE FUNCTION public.has_platform_privilege()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'platform.admin' = ANY(
    COALESCE(
      ARRAY(
        SELECT jsonb_array_elements_text(
          COALESCE(
            (current_setting('request.jwt.claims', true)::jsonb)->'permissions',
            '[]'::jsonb
          )
        )
      ),
      ARRAY[]::text[]
    )
  );
$$;

ALTER FUNCTION public.has_platform_privilege() OWNER TO postgres;

COMMENT ON FUNCTION public.has_platform_privilege() IS
'Checks if current user has platform.admin permission in JWT claims.
This is the canonical pattern for platform owner privileged access.
Does NOT query the database - uses JWT claims only for performance.
Returns false on missing/malformed claims (fail-safe).

Usage:
  IF NOT has_platform_privilege() THEN
    RAISE EXCEPTION ''Access denied: platform.admin permission required'';
  END IF;

To grant access to new roles, add platform.admin permission to that role.
No code changes required.';
