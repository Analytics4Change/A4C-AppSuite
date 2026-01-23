-- =============================================================================
-- Migration: Compute Effective Permissions Function
-- Purpose: Calculate deduplicated permissions with widest scope, including implications
-- Part of: Multi-Role Authorization Phase 2B
-- =============================================================================

-- This is a read-side query function (CQRS-compliant)
-- It computes effective permissions for JWT generation and permission checks

CREATE OR REPLACE FUNCTION compute_effective_permissions(p_user_id uuid, p_org_id uuid)
RETURNS TABLE(permission_name text, effective_scope extensions.ltree)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
WITH
-- Step 1: Collect all explicit grants with their scopes from user's active roles
explicit_grants AS (
  SELECT DISTINCT
    p.name AS permission_name,
    p.id AS permission_id,
    ur.scope_path
  FROM user_roles_projection ur
  JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
  JOIN permissions_projection p ON p.id = rp.permission_id
  WHERE ur.user_id = p_user_id
    -- Include roles for this org OR org-agnostic roles (platform-level)
    AND (ur.organization_id = p_org_id OR ur.organization_id IS NULL)
    -- Respect temporal validity dates on role assignments (determines "active" status)
    AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
    AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE)
),

-- Step 2: For each permission, keep only the WIDEST scope (shortest ltree path)
-- This handles the case where a user has the same permission at multiple scopes
widest_explicit AS (
  SELECT DISTINCT ON (permission_name)
    permission_name,
    permission_id,
    scope_path
  FROM explicit_grants
  ORDER BY permission_name, nlevel(scope_path) ASC  -- Shortest path = widest scope
),

-- Step 3: Expand with implications, inheriting scope from the implying permission
-- Example: If user has organization.update_ou at 'acme', they get organization.view_ou at 'acme'
with_implications AS (
  -- Start with explicit grants
  SELECT permission_name, permission_id, scope_path FROM widest_explicit
  UNION
  -- Add implied permissions with inherited scope
  SELECT
    p2.name,
    p2.id,
    we.scope_path  -- Inherit scope from the permission that implies this one
  FROM widest_explicit we
  JOIN permission_implications pi ON pi.permission_id = we.permission_id
  JOIN permissions_projection p2 ON p2.id = pi.implies_permission_id
),

-- Step 4: Re-dedupe after expansion (implications may add permissions already present)
-- Again, keep widest scope for each permission
final_effective AS (
  SELECT DISTINCT ON (permission_name)
    permission_name,
    scope_path AS effective_scope
  FROM with_implications
  ORDER BY permission_name, nlevel(scope_path) ASC
)

SELECT * FROM final_effective;
$$;

-- =============================================================================
-- Documentation
-- =============================================================================

COMMENT ON FUNCTION compute_effective_permissions(uuid, uuid) IS
'Computes effective permissions for a user within an organization.

Returns a table of (permission_name, effective_scope) pairs where:
1. Each permission appears at most once (deduplicated)
2. If a permission exists at multiple scopes, the widest scope wins
3. Implied permissions are included (e.g., update → view)
4. Implied permissions inherit scope from their implying permission

Used by:
- JWT hook (custom_access_token_hook) for building effective_permissions claim
- has_effective_permission() RLS helper for access checks

CQRS Note: This is a read-side query function that joins projections.
It does not modify state.';
