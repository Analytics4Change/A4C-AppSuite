-- =============================================================================
-- Migration: add_get_user_target_path_helper
-- Purpose:   Introduce public.get_user_target_path(uuid, uuid) — canonical helper
--            that resolves the extensions.ltree path passed to has_effective_permission()
--            for user-targeted RPCs. Single source of truth for the column-choice
--            and fallback semantics across user-scoped operations.
--
-- Context:
--   The architect review at the start of `manage-user-delete-to-sql-rpc/`
--   identified that PR #36 (api.update_user_notification_preferences) and
--   PR #39 (api.revoke_invitation) both broke the canonical scoped-permission
--   pattern by mirroring the unscoped Edge Function helper. This migration
--   introduces the helper that subsequent migrations in this PR (M2 delete_user
--   and M3/M4 retrofits) consume.
--
-- Schema basis (verified against tmrjlswbsxmbglmaclxu, 2026-04-27):
--   - users.current_organization_id, users.current_org_unit_id (uuid columns)
--   - organization_units_projection.path (extensions.ltree) — joined via current_org_unit_id
--   - organizations_projection.path (extensions.ltree) — fallback when user has no OU
--
-- Baseline-overload audit (Rule 15):
--   - public.get_user_target_path does not exist in baseline_v4 — clean creation.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_user_target_path(
    p_user_id uuid,
    p_org_id uuid
)
RETURNS extensions.ltree
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_target_path extensions.ltree;
    v_user_org_id uuid;
    v_user_org_unit_id uuid;
BEGIN
    -- =====================================================================
    -- PRECONDITIONS
    -- =====================================================================
    IF p_user_id IS NULL OR p_org_id IS NULL THEN
        RAISE EXCEPTION 'p_user_id and p_org_id are required'
            USING ERRCODE = '22023';
    END IF;

    -- =====================================================================
    -- USER LOOKUP + TENANCY GUARD
    -- Closes the JWT/users.current_organization_id inconsistency window
    -- (per public.switch_organization at baseline_v4:11712-11763, which
    -- updates current_organization_id non-atomically with JWT re-issuance).
    -- =====================================================================
    SELECT u.current_organization_id, u.current_org_unit_id
    INTO v_user_org_id, v_user_org_unit_id
    FROM public.users u
    WHERE u.id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_user_org_id IS DISTINCT FROM p_org_id THEN
        RAISE EXCEPTION 'User not in tenant' USING ERRCODE = '42501';
    END IF;

    -- =====================================================================
    -- PATH RESOLUTION (most-specific-wins)
    -- =====================================================================

    -- 1. Try OU path (user has explicit org-unit assignment)
    IF v_user_org_unit_id IS NOT NULL THEN
        SELECT ou.path INTO v_target_path
        FROM public.organization_units_projection ou
        WHERE ou.id = v_user_org_unit_id;

        IF v_target_path IS NOT NULL THEN
            RETURN v_target_path;
        END IF;
    END IF;

    -- 2. Fallback: organization root path (user is at tenant root, or
    --    current_org_unit_id pointed to a deleted/missing OU row)
    SELECT op.path INTO v_target_path
    FROM public.organizations_projection op
    WHERE op.id = p_org_id;

    IF v_target_path IS NULL THEN
        RAISE EXCEPTION 'Organization has no path (data integrity)'
            USING ERRCODE = 'raise_exception';
    END IF;

    RETURN v_target_path;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_target_path(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.get_user_target_path(uuid, uuid) IS
$$Resolves the extensions.ltree path that should be passed to has_effective_permission()
for permission checks gating actions on a user, scoped to the calling tenant.

Preconditions:
  - p_user_id and p_org_id are non-null (raises 22023 otherwise).
  - p_org_id should be sourced from the caller's JWT
    (current_setting('request.jwt.claims', true)::jsonb ->> 'org_id').

Postconditions:
  - On success: returns extensions.ltree path. Most-specific available:
      1. organization_units_projection.path (when users.current_org_unit_id is set)
      2. organizations_projection.path (fallback when user has no OU)

Error envelope (ERRCODE):
  P0002         -- user with p_user_id does not exist.
  42501         -- user exists but current_organization_id != p_org_id
                   (tenancy violation; closes JWT/org-switch inconsistency window).
  22023         -- null arg.
  raise_exception -- organization has no path (data integrity issue).

Soft-deleted users:
  - deleted_at is NOT consulted; helper resolves path even for deleted users.
    The caller's RPC owns the lifecycle decision (whether acting on a deleted
    user is acceptable for that operation).

Multi-tenant model:
  - Uses users.current_organization_id as the tenant boundary. A user who has
    switched tenants (via public.switch_organization) will fail the tenancy
    check from the prior caller's perspective until they switch back, even if
    they hold roles in multiple tenants. Intentional - closes the JWT/
    current_organization_id inconsistency window during org-switch.

Notes:
  - STABLE: read-only and deterministic within a transaction.
  - SECURITY DEFINER: helper reads users + organization_units_projection +
    organizations_projection; permission gating belongs to the calling RPC.
  - Canonical caller pattern:
      v_target_path := public.get_user_target_path(p_user_id, v_org_id);
      IF NOT public.has_effective_permission('user.delete', v_target_path) THEN
        RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
      END IF;

References:
  - adr-edge-function-vs-sql-rpc.md - Rollout 2026-04-27 (this PR).
  - rbac-architecture.md - scoped permission model.
$$;
